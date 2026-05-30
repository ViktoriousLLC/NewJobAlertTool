import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { scrapeCompanyCareers, stealthFallbackScrape, inferPlatformFromSniffedUrl, ScrapeStats } from "../scraper/scraper";
import { validateScrapeResults } from "../scraper/validateScrape";
import { broadATSDiscovery } from "../scraper/detectPlatform";
import { sendBatchAlerts, buildAlertEmailPayload, sendAdminDigest, NewJobAlert, EmailPayload, BatchSendResult, RecommendedCompany } from "../email/sendAlert";
import { classifyJobLevel } from "../lib/classifyLevel";
import { getCompData } from "../lib/levelsFyi";
import { CompanyQualityData } from "../scraper/dailyEval";
import { runSecurityCheck } from "./securityCheck";
import { listAllUsers } from "../lib/listAllUsers";
import { fetchAllRows } from "../lib/fetchAllRows";
import { tryProactiveAutoFix, AutoFixResult } from "./autoFixRules";

// Log a self-healing event to the scraper_events table. Used to power the
// Monday weekly digest. Best-effort: failures are swallowed so they never
// break the cron run.
async function logScraperEvent(
  companyId: string,
  companyName: string,
  eventType: "auto_remediation" | "stealth_recovery" | "auto_disabled" | "auto_re_enabled" | "auto_fix_applied" | "auto_verified_zero" | "auto_unverified_zero",
  details: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("scraper_events").insert({
      company_id: companyId,
      company_name: companyName,
      event_type: eventType,
      details,
    });
  } catch (err) {
    console.error(`Failed to log scraper_event (${eventType} for ${companyName}):`, err);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// DEV-37: supabase-js does NOT throw on a database error — it resolves with an
// `{ error }` object that is easy to silently ignore. Several writes in the daily
// cron dropped their error on the floor, so a failed platform auto-remediation,
// status update, or removal looked exactly like a success in the logs. This logs
// the failure and reports it to Sentry (which the boot/daily probe now guarantees
// is actually receiving events — DEV-27/DEV-47). Returns true when an error was
// present so callers can branch if they need to. Best-effort: never throws, so a
// single bad write can't abort the whole per-company loop.
function reportWriteError(
  error: unknown,
  context: string,
  tags?: Record<string, string>
): boolean {
  if (!error) return false;
  console.error(`DB write failed (${context}):`, error);
  Sentry.captureException(error instanceof Error ? error : new Error(`DB write failed (${context}): ${JSON.stringify(error)}`), {
    tags: { area: "dailyCheck.write", ...tags },
  });
  return true;
}

// Per-company seniority floor (companies.min_relevant_seniority). Used by
// both the daily alert path and the recommendation picker. Job title → level
// classifier reused so the filter stays consistent with seen_jobs.job_level.
const SENIORITY_RANK: Record<string, number> = { early: 0, mid: 1, director: 2 };
function passesSeniorityThreshold(jobTitle: string, threshold: string | null | undefined): boolean {
  if (!threshold) return true;
  const level = classifyJobLevel(jobTitle);
  if (!level) return true; // uncategorized → over-show, don't over-filter
  return (SENIORITY_RANK[level] ?? 0) >= (SENIORITY_RANK[threshold] ?? 0);
}

// ---- Recommendation engine (PR #1b) -----------------------------------------
// Per-user "Companies you may find interesting" picker for alert emails.
// Pure function: takes the user's subscriptions + a cached catalog snapshot
// and returns 3 recommendations drawn from industries the user shows
// affinity for. Behavior:
//   - >=40% subs in one industry  →  3 from that industry
//   - else if top 2 cover >=60%   →  2 + 1 split across those industries
//   - else                        →  1 + 1 + 1 across top 3 industries
// Within an industry: prefer companies with the most new PM jobs this week
// (excluding ones the user already subscribes to). Within a company: pick
// the 2 most-senior roles (director > mid > early > unknown).

type CompanyWithIndustry = {
  id: string;
  name: string;
  careersUrl: string;
  industry: string;
  minRelevantSeniority: string | null;
};
type RecentJobRow = { title: string; urlPath: string; level: "early" | "mid" | "director" | null };

// Reverse ordering for "most senior first" picking inside a company.
const RECOMMENDATION_SENIORITY_RANK: Record<"director" | "mid" | "early", number> = { director: 0, mid: 1, early: 2 };

function pickRecommendations(
  userCompanyIds: string[],
  allCompanies: CompanyWithIndustry[],
  jobsByCompany: Map<string, RecentJobRow[]>,
  recentlyShownCompanyIds: Set<string>
): RecommendedCompany[] {
  if (userCompanyIds.length === 0) return [];

  const subscribedSet = new Set(userCompanyIds);
  const userCompanies = allCompanies.filter((c) => subscribedSet.has(c.id));
  if (userCompanies.length === 0) return [];

  // Industry distribution of the user's subscriptions.
  const industryCounts = new Map<string, number>();
  for (const c of userCompanies) {
    industryCounts.set(c.industry, (industryCounts.get(c.industry) || 0) + 1);
  }
  const sorted = Array.from(industryCounts.entries()).sort((a, b) => b[1] - a[1]);
  const totalSubs = userCompanies.length;

  // Allocate the 3 recommendation slots based on dominance.
  let allocation: { industry: string; count: number }[] = [];
  const topPct = sorted[0][1] / totalSubs;
  const topTwoPct = sorted.length >= 2 ? (sorted[0][1] + sorted[1][1]) / totalSubs : topPct;
  if (topPct >= 0.4) {
    allocation = [{ industry: sorted[0][0], count: 3 }];
  } else if (sorted.length >= 2 && topTwoPct >= 0.6) {
    allocation = [
      { industry: sorted[0][0], count: 2 },
      { industry: sorted[1][0], count: 1 },
    ];
  } else {
    allocation = sorted.slice(0, 3).map((s) => ({ industry: s[0], count: 1 }));
  }

  const recommendations: RecommendedCompany[] = [];
  const usedCompanyIds = new Set<string>();

  // Rotation: skip companies featured in the last 7 days (tracked in
  // recommendation_history). No fixed pool — each day's eligible set is
  // "all unsubscribed companies in industry, minus recently-shown,
  // ranked by job count." First-pass picks the top by ranking; if the
  // unseen pool runs out, allow recently-shown re-fills so the section
  // doesn't go empty for tiny industries.
  for (const { industry, count } of allocation) {
    const allRanked = allCompanies
      .filter((c) => c.industry === industry)
      .filter((c) => !subscribedSet.has(c.id) && !usedCompanyIds.has(c.id))
      .map((c) => {
        const rawJobs = jobsByCompany.get(c.id) || [];
        const eligibleJobs = c.minRelevantSeniority
          ? rawJobs.filter((j) => {
              if (!j.level) return true;
              const tRank = RECOMMENDATION_SENIORITY_RANK[c.minRelevantSeniority as "early" | "mid" | "director"] ?? 99;
              const jRank = RECOMMENDATION_SENIORITY_RANK[j.level] ?? 99;
              return jRank <= tRank;
            })
          : rawJobs;
        return { company: c, jobs: eligibleJobs };
      })
      .filter((entry) => entry.jobs.length > 0)
      .sort((a, b) => b.jobs.length - a.jobs.length);

    const unseen = allRanked.filter((e) => !recentlyShownCompanyIds.has(e.company.id));
    const candidates: typeof allRanked = unseen.slice(0, count);
    if (candidates.length < count) {
      // Fallback: backfill from recently-shown so the slot isn't empty
      const seenPool = allRanked.filter((e) => recentlyShownCompanyIds.has(e.company.id));
      for (const entry of seenPool) {
        if (candidates.length >= count) break;
        if (!candidates.includes(entry)) candidates.push(entry);
      }
    }

    for (let i = 0; i < candidates.length; i++) {
      const { company, jobs } = candidates[i];
      usedCompanyIds.add(company.id);

      // Top 2 by seniority. Tie-break by recency (first_seen_at sort was
      // applied at fetch time, so the array is already most-recent-first).
      const topJobs = [...jobs]
        .sort((a, b) => {
          const ra = a.level ? RECOMMENDATION_SENIORITY_RANK[a.level] : 3;
          const rb = b.level ? RECOMMENDATION_SENIORITY_RANK[b.level] : 3;
          return ra - rb;
        })
        .slice(0, 2)
        .map((j) => ({ title: j.title, urlPath: j.urlPath }));

      recommendations.push({
        companyName: company.name,
        careersUrl: company.careersUrl,
        industry: company.industry,
        totalNewThisWeek: jobs.length,
        topRoles: topJobs,
      });
    }
  }

  return recommendations;
}
// -----------------------------------------------------------------------------

// Overlap guard: prevent concurrent daily check runs
let dailyCheckRunning = false;

export async function runDailyCheck(options?: { skipEmails?: boolean; forceMondayDigest?: boolean; forceWeeklyDigest?: boolean }): Promise<void> {
  if (dailyCheckRunning) {
    console.warn("Daily check already running — skipping this trigger to prevent overlap");
    return;
  }
  dailyCheckRunning = true;

  try {
    await runDailyCheckInner(options);
  } finally {
    dailyCheckRunning = false;
  }
}

async function runDailyCheckInner(options?: { skipEmails?: boolean; forceMondayDigest?: boolean; forceWeeklyDigest?: boolean }): Promise<void> {
  console.log(`Starting daily job check...${options?.skipEmails ? " (skipEmails mode)" : ""}`);

  // DEV-27: verify Sentry is actually ingesting events before anything else.
  // Sentry fails silent on a bad DSN, so without this the backend can be blind
  // to errors for months (as it was Feb-May 2026) with zero signal. Runs daily
  // here (boot probe lives in index.ts); on failure, email admin via PostHog's
  // sibling channel (email), never via Sentry itself.
  //
  // DEV-47: gate on the Railway-injected RAILWAY_ENVIRONMENT_NAME, not NODE_ENV.
  // NODE_ENV was unset on Railway for months, which made this probe dead code in
  // prod (the very silent-failure class it guards against). The platform-injected
  // var is always present on a Railway service and can't be silently cleared.
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
    try {
      const { reportSentryHealth } = await import("../lib/sentryHealth");
      const sentryHealth = await reportSentryHealth("daily");
      if (!sentryHealth.ok) {
        const { sendAdminEmail } = await import("../email/sendAlert");
        await sendAdminEmail(
          "NewPMJobs alert: Sentry is not receiving events",
          `<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; color: #1f2937;">
            <h2 style="color: #b91c1c; margin-bottom: 8px;">Sentry is not receiving events</h2>
            <p>The daily liveness probe could not push an event to Sentry. Backend error reporting is currently blind: errors are being thrown into a void, not captured.</p>
            <p style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px;">
              <strong>Reason:</strong> ${sentryHealth.reason}<br/>
              <strong>Detail:</strong> ${sentryHealth.detail}
            </p>
            <p>Check that <code>SENTRY_DSN</code> is set correctly on Railway (it must be the full Default DSN of the javascript-nextjs Sentry project; a truncated value points at a nonexistent project and is silently dropped).</p>
          </div>`,
        );
      }
    } catch (err) {
      console.error("Sentry liveness check failed to run:", err);
    }
  }

  // Scrape all companies so the catalog stays fresh (even with 0 subscribers)
  const { data: companies, error } = await supabase
    .from("companies")
    .select("*");

  if (error || !companies) {
    console.error("Failed to fetch companies:", error);
    return;
  }

  console.log(`Checking ${companies.length} companies...`);

  // Collect alerts per company for later per-user email distribution
  const companyAlerts: Map<
    string,
    { companyName: string; careersUrl: string; newJobs: { title: string; urlPath: string }[] }
  > = new Map();

  // Track failures and auto-remediations for the admin digest
  const failedCompanies: { name: string; error: string; consecutiveFailures: number }[] = [];
  const autoRemediated: { name: string; from: string; to: string }[] = [];
  const stealthRecovered: { name: string; jobCount: number }[] = [];
  const autoDisabled: { name: string; reason: string }[] = [];
  const reEnabled: { name: string; jobCount: number }[] = [];
  // DEV-19: proactive auto-fix layer. Each entry = a rule that fired this run.
  // Surfaces in the daily digest's "🤖 Auto-fixed today" section.
  const autoFixed: { name: string; ruleId: string; description: string; message: string }[] = [];

  // Collect quality data for daily eval
  const qualityData: Map<string, CompanyQualityData> = new Map();

  // Self-healing: companies auto-disabled after AUTO_DISABLE_THRESHOLD consecutive
  // failures. Skipped from scraping until probe day (Monday) gives them another chance.
  const AUTO_DISABLE_THRESHOLD = 7;
  // Silent-zero handling (replaces the manual "Unverified zeros" admin email):
  //   * A previously-verified scraper that returns 0 PMs for AUTO_VERIFY_ZERO_DAYS
  //     in a row gets auto-marked is_verified_zero=true. Trusted scraper + sustained
  //     zero = real zero. Reverses automatically when >0 PMs reappear.
  //   * A never-verified company that stays at 0 for SILENT_ZERO_DISABLE_DAYS gets
  //     auto_disabled=true — scraper is probably broken from day one.
  const AUTO_VERIFY_ZERO_DAYS = 7;
  const SILENT_ZERO_DISABLE_DAYS = 14;
  // Watch list: every Monday (UTC), probe all auto-disabled companies once. Successful
  // probes auto-re-enable; still-broken probes don't increment the counter further.
  const PROBE_DAY_OF_WEEK = 1; // 0=Sunday, 1=Monday
  const isProbeDay = new Date().getUTCDay() === PROBE_DAY_OF_WEEK;

  for (const company of companies) {
    const isProbing = company.auto_disabled && isProbeDay;
    if (company.auto_disabled && !isProbing) {
      console.log(`Skipping ${company.name} (auto-disabled, next probe Monday UTC)`);
      continue;
    }
    if (isProbing) {
      console.log(`PROBING auto-disabled ${company.name} (Monday watch-list check)`);
    }

    try {
      // DEV-19: proactive auto-fix layer — check the company's stored config
      // against known-broken patterns BEFORE scraping. If a rule applies, the
      // fix updates the DB and we refresh local state so the scrape this run
      // uses the corrected config. Skipped when probing (auto-disabled
      // companies need a real attempt to verify the probe; auto-fix masks that).
      let autoFixApplied: AutoFixResult | null = null;
      if (!isProbing) {
        autoFixApplied = await tryProactiveAutoFix(company, supabase);
      }
      if (autoFixApplied?.ok) {
        autoFixed.push({
          name: company.name,
          ruleId: autoFixApplied.ruleId,
          description: autoFixApplied.description,
          message: autoFixApplied.message,
        });
        await logScraperEvent(company.id, company.name, "auto_fix_applied", {
          ruleId: autoFixApplied.ruleId,
          message: autoFixApplied.message,
          before: autoFixApplied.before,
          after: autoFixApplied.after,
        });
        // Refresh local company state so the rest of this iteration uses the
        // fixed config. The fix() implementation has already written to the DB;
        // local merge is just a mirror so we don't re-fetch the row.
        if (autoFixApplied.after) {
          company.platform_config = { ...(company.platform_config || {}), ...autoFixApplied.after };
          company.consecutive_failure_count = 0;
          company.auto_disabled = false;
        }
        Sentry.captureMessage(`Auto-fix applied to ${company.name}: ${autoFixApplied.message}`, {
          level: "info",
          tags: { company: company.name, phase: "auto-fix", ruleId: autoFixApplied.ruleId },
        });
      }

      console.log(`Scraping: ${company.name} (${company.careers_url})`);
      // Filter-heavy scrapers (Greenhouse/Workday/Ashby) write their pre-PM-filter
      // job count into stats. Lets us distinguish "API returned 50 jobs, 0 PMs"
      // (legit zero — skip stealth fallback) from "API broken, returned nothing"
      // (genuine zero — try recovery tiers).
      const scrapeStats: ScrapeStats = { totalScanned: 0 };
      let rawJobs = await scrapeCompanyCareers(
        company.careers_url,
        company.platform_type || null,
        company.platform_config || null,
        scrapeStats
      );

      // Source was empty if the scraper saw zero raw jobs AND returned zero PMs.
      // If totalScanned > 0, the source worked, there just weren't any PM matches.
      const sourceEmpty = rawJobs.length === 0 && scrapeStats.totalScanned === 0;

      // Zero-result fallback: try broad ATS discovery to auto-remediate
      // Covers both generic companies AND companies whose known platform broke (e.g., Ashby → Greenhouse)
      // Never run broadATSDiscovery on custom scraper companies — their URLs don't map to standard ATS
      const CUSTOM_SCRAPER_HOSTS = ["ea.com", "atlassian.com", "netflix.net", "netflix.com", "uber.com", "google.com", "amazon.jobs", "intuit.com", "rivian.com", "costco.com", "coinbase.com", "apple.com", "metacareers.com", "tiktok.com", "tesla.com", "wayfair.com", "shopify.com", "ebayinc.com", "higher.gs.com", "gs.com", "jobs.deel.com", "kpmguscareers.com", "revolut.com", "bcg.com", "careers.ey.com", "careers.lilly.com"];
      const companyHost = new URL(company.careers_url).hostname;
      const isCustomScraper = CUSTOM_SCRAPER_HOSTS.some((h) => companyHost.includes(h));
      if (sourceEmpty && !isCustomScraper) {
        const prevPlatform = company.platform_type || "generic";
        console.log(`${company.name}: 0 jobs with ${prevPlatform} scraper, trying broad ATS discovery...`);
        try {
          const discovery = await broadATSDiscovery(company.careers_url, company.name);
          if (discovery && discovery.platformType !== company.platform_type) {
            console.log(`${company.name}: Broad discovery found NEW platform ${discovery.platformType} (was: ${prevPlatform})`);
            // Re-scrape with discovered platform, reusing same stats out-param.
            // Reset BOTH reachability signals: the first (failed) scrape may have
            // set sourceReachable=true (e.g. a keyword-search API that 200'd with
            // 0 PMs); leaving it set would let the re-scrape's stale "healthy" flag
            // green-light stale-removal even if the new platform never proves reachable.
            scrapeStats.totalScanned = 0;
            scrapeStats.sourceReachable = undefined;
            rawJobs = await scrapeCompanyCareers(company.careers_url, discovery.platformType, discovery.platformConfig, scrapeStats);
            console.log(`${company.name}: Re-scrape with ${discovery.platformType} found ${rawJobs.length} raw jobs (scanned ${scrapeStats.totalScanned})`);

            // Auto-update platform_type + platform_config so future scrapes work directly
            if (rawJobs.length > 0) {
              const { error: remediateErr } = await supabase
                .from("companies")
                .update({
                  platform_type: discovery.platformType,
                  platform_config: discovery.platformConfig,
                })
                .eq("id", company.id);
              reportWriteError(remediateErr, `auto-remediate platform for ${company.name}`, { company: company.name });
              console.log(`${company.name}: AUTO-REMEDIATED platform ${prevPlatform} → ${discovery.platformType}`);
              autoRemediated.push({ name: company.name, from: prevPlatform, to: discovery.platformType });
              await logScraperEvent(company.id, company.name, "auto_remediation", {
                from: prevPlatform,
                to: discovery.platformType,
                jobCount: rawJobs.length,
              });
              Sentry.captureMessage(`Auto-remediated ${company.name}: ${prevPlatform} → ${discovery.platformType}`, {
                level: "info",
                tags: { company: company.name, phase: "auto-remediation" },
              });
            }
          }
        } catch (err) {
          console.error(`${company.name}: Broad ATS discovery failed:`, err);
        }
      }

      // Final tier: stealth Puppeteer fallback when everything else returns 0.
      // Only fires when the SOURCE was empty — not when the API returned data
      // that just happened to contain zero PM matches. After Layer 2 (2026-05-11),
      // companies like Block/Wiz/Confluent (50+ raw jobs, 0 PMs) no longer trigger
      // Puppeteer-with-stealth — that was burning ~10 min of cron time daily for
      // no benefit. Custom scrapers (Coinbase etc.) still trigger because they
      // typically return [] on capture failure, which counts as source-empty.
      if (rawJobs.length === 0 && scrapeStats.totalScanned === 0) {
        const lastStatus = company.last_check_status || "";
        const isTransientFailure = /timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(lastStatus);
        if (!isTransientFailure) {
          console.log(`${company.name}: 0 jobs after primary + discovery, trying stealth fallback...`);
          try {
            const stealthResult = await stealthFallbackScrape(company.careers_url, company.name);
            if (stealthResult.jobs.length > 0) {
              rawJobs = stealthResult.jobs;
              stealthRecovered.push({ name: company.name, jobCount: stealthResult.jobs.length });

              // Layer 1 auto-fix: if the sniffed URL maps to a known ATS,
              // update the company's platform config so next run skips stealth.
              let autoFixApplied: { from: string; to: string } | null = null;
              if (stealthResult.sniffedUrl) {
                const inferred = inferPlatformFromSniffedUrl(stealthResult.sniffedUrl);
                const currentPlatform = company.platform_type || "generic";
                const currentConfig = JSON.stringify(company.platform_config || {});
                const inferredConfig = inferred ? JSON.stringify(inferred.platformConfig) : "";
                if (
                  inferred &&
                  (inferred.platformType !== company.platform_type ||
                    inferredConfig !== currentConfig)
                ) {
                  const { error: stealthFixErr } = await supabase
                    .from("companies")
                    .update({
                      platform_type: inferred.platformType,
                      platform_config: inferred.platformConfig,
                    })
                    .eq("id", company.id);
                  reportWriteError(stealthFixErr, `stealth auto-fix platform for ${company.name}`, { company: company.name });
                  autoFixApplied = { from: currentPlatform, to: `${inferred.platformType}/${inferred.platformConfig.boardName || inferred.platformConfig.handle || inferred.platformConfig.orgName || inferred.platformConfig.company}` };
                  console.log(`${company.name}: STEALTH AUTO-FIX → ${autoFixApplied.to} (from sniffed URL ${stealthResult.sniffedUrl})`);
                }
              }

              await logScraperEvent(company.id, company.name, "stealth_recovery", {
                jobCount: stealthResult.jobs.length,
                sniffedUrl: stealthResult.sniffedUrl,
                via: stealthResult.via,
                autoFixApplied,
              });

              // If we managed to auto-fix the platform, also surface it as an
              // auto-remediation so it shows up in the green section.
              if (autoFixApplied) {
                autoRemediated.push({ name: company.name, from: autoFixApplied.from, to: autoFixApplied.to });
                await logScraperEvent(company.id, company.name, "auto_remediation", {
                  from: autoFixApplied.from,
                  to: autoFixApplied.to,
                  source: "stealth_sniffed_url",
                });
              }

              Sentry.captureMessage(`Stealth fallback recovered ${company.name}: ${stealthResult.jobs.length} jobs${autoFixApplied ? ` (auto-fixed to ${autoFixApplied.to})` : ""}`, {
                level: "info",
                tags: { company: company.name, phase: "stealth-fallback" },
              });
              console.log(`${company.name}: STEALTH RECOVERED ${stealthResult.jobs.length} jobs${stealthResult.sniffedUrl ? ` via ${stealthResult.sniffedUrl}` : ""}`);
            } else {
              console.log(`${company.name}: stealth fallback also returned 0`);
            }
          } catch (err) {
            console.error(`${company.name}: Stealth fallback failed:`, err);
            Sentry.captureException(err, {
              tags: { company: company.name, phase: "stealth-fallback" },
            });
          }
        }
      }

      // Run quality validation to filter non-PM jobs
      const validation = validateScrapeResults(rawJobs, company.name);
      const jobs = validation.filteredJobs;
      if (validation.warnings.length > 0) {
        console.log(`Quality warnings for ${company.name}:`, validation.warnings);
      }
      console.log(`Found ${jobs.length} product jobs for ${company.name} (${rawJobs.length} raw)`);

      // Note: most scrapers pre-filter by PM_KEYWORDS internally, so rawJobs.length === 0
      // often means "no PM roles" rather than "scraper broken". Actual scraper failures
      // throw exceptions and are caught by the catch block below. No need to alert here.

      // Get ALL existing seen_jobs for this company (active + removed + archived).
      // DEV-36: paginate — a high-volume company (e.g. Amazon) accumulates jobs
      // across the 60-day archive window and can cross PostgREST's silent 1000-row
      // cap. A truncated read here would corrupt the diff: rows beyond 1000 would
      // be invisible to existingByPath, so the insert step would re-INSERT them
      // (hitting the company_id+job_url_path UNIQUE) and the removal/refresh steps
      // would skip them. Order by the stable unique key `id` so paging is safe.
      type ExistingJobRow = {
        id: string;
        job_url_path: string;
        status: string;
        job_title: string | null;
        job_location: string | null;
        last_removed_at: string | null;
      };
      const existingJobs = await fetchAllRows<ExistingJobRow>((from, to) =>
        supabase
          .from("seen_jobs")
          .select("id, job_url_path, status, job_title, job_location, last_removed_at")
          .eq("company_id", company.id)
          .order("id", { ascending: true })
          .range(from, to)
      );

      const existingByPath = new Map<string, { id: string; status: string; title: string; location: string; lastRemovedAt: string | null }>();
      for (const j of existingJobs || []) {
        existingByPath.set(j.job_url_path, {
          id: j.id,
          status: j.status,
          title: j.job_title || "",
          location: j.job_location || "",
          lastRemovedAt: j.last_removed_at || null,
        });
      }

      const scrapedPaths = new Set(jobs.map((j) => j.urlPath));
      const newJobs: { title: string; urlPath: string }[] = [];

      // Decide whether to skip removal marking when this scrape found 0 PM jobs
      // for a company that still has active listings. Two distinct cases, told
      // apart by scrapeStats.totalScanned (the source-alive signal the recovery
      // tier already uses — see SCRAPER.md):
      //   - Source failed / returned nothing (totalScanned === 0): a transient or
      //     broken scrape. PRESERVE the existing active jobs indefinitely — never
      //     let a broken scrape wipe real listings. (Original safety guard.)
      //   - Source healthy but 0 PMs (totalScanned > 0): the company genuinely has
      //     no PM roles right now, so its active rows are stale. Remove them, but
      //     only after STALE_REMOVAL_BUFFER_DAYS consecutive healthy-zero days, so
      //     one odd scrape can't briefly drop real jobs from feeds. Without this,
      //     delisted roles were preserved forever as "active" (zombie listings) and
      //     also kept the active count > 0, which defeated the is_verified_zero
      //     self-heal (consecutive_zero_days could never increment).
      //
      // Coverage: totalScanned is a reliable "source alive" signal only for
      // full-board scrapers that throw on failure (greenhouse, ashby, workday,
      // lever, smartrecruiters). DEV-33 closed the keyword-search gap: amazon,
      // icims-api, oracle_hcm and the DOM-in-JSON intuit scraper never see the
      // full board (totalScanned stays 0 even on a healthy 0-PM result), so they
      // now set scrapeStats.sourceReachable=true once they reach + parse a 200.
      // Either signal means "source healthy, just 0 PMs" → eligible for stale
      // removal after the buffer. Error-swallowing scrapers that return [] on a
      // bad page (eightfold) and the generic puppeteer fallback set neither, so
      // they still fall through to the safe "preserve" branch. See JOBS.md.
      const STALE_REMOVAL_BUFFER_DAYS = 2;
      const existingActiveCount = (existingJobs || []).filter((j) => j.status === "active").length;
      const sourceHealthy = scrapeStats.totalScanned > 0 || scrapeStats.sourceReachable === true;
      const currentHealthyZeroStreak =
        (company as { consecutive_healthy_zero_days?: number }).consecutive_healthy_zero_days ?? 0;

      // Persisted in the companies update below. Stays 0 unless we're mid-buffer on
      // a healthy-source-but-zero-PM run; any other outcome resets it.
      let healthyZeroStreak = 0;
      let skipRemoval = false;
      if (jobs.length === 0 && existingActiveCount > 0) {
        if (sourceHealthy) {
          healthyZeroStreak = currentHealthyZeroStreak + 1;
          if (healthyZeroStreak < STALE_REMOVAL_BUFFER_DAYS) {
            skipRemoval = true;
            console.warn(`ANTI-FLAP: ${company.name} source healthy but 0 PMs (day ${healthyZeroStreak}/${STALE_REMOVAL_BUFFER_DAYS}). Preserving ${existingActiveCount} active job(s) one more cycle.`);
          } else {
            console.warn(`${company.name}: source healthy, 0 PMs for ${healthyZeroStreak} consecutive days, removing ${existingActiveCount} now-stale active job(s).`);
          }
        } else {
          // Source empty/failed: preserve, and do NOT count toward the staleness buffer.
          skipRemoval = true;
          console.warn(`SAFETY: ${company.name} scrape returned 0 jobs and source appears empty/failed (scanned ${scrapeStats.totalScanned}). Skipping removal marking.`);
        }
      }

      // 1. New jobs: in scrape, not in DB → INSERT with status='active'
      const toInsert = jobs.filter((j) => !existingByPath.has(j.urlPath));
      if (toInsert.length > 0) {
        const { error: insertError } = await supabase.from("seen_jobs").insert(
          toInsert.map((j) => ({
            company_id: company.id,
            job_url_path: j.urlPath,
            job_title: j.title,
            job_location: j.location,
            is_baseline: false,
            job_level: classifyJobLevel(j.title),
            status: "active",
          }))
        );
        reportWriteError(insertError, `insert new jobs for ${company.name}`, { company: company.name });

        // Per-company seniority filter for alerts: jobs still land in seen_jobs
        // (so the feed shows them with the same filter), but emails skip them.
        // For Google etc. (min_relevant_seniority='mid'), the "Senior PM, Ads"
        // role goes through; "Associate PM, Ads" doesn't.
        const alertable = toInsert.filter((j) =>
          passesSeniorityThreshold(j.title, company.min_relevant_seniority)
        );
        newJobs.push(...alertable.map((j) => ({ title: j.title, urlPath: j.urlPath })));
      }

      // 2. Returned jobs: in DB as 'removed' OR 'archived', back in scrape → flip to 'active'
      // and refresh title/location (the listing may have been re-posted with edits).
      // Without including 'archived' here, an old URL that comes back is silently dropped:
      // it can't INSERT (already in seen_jobs UNIQUE), the 'removed' branch skips it, the
      // refresh branch skips it (status !== 'active'). Observed at EA where URLs from Feb
      // re-appeared in May with new titles/locations and never showed up in the catalog.
      // 2-week return rule (PR adding last_removed_at):
      // A job that's been absent <14d is almost certainly scraper jitter —
      // don't treat its return as "new" in the email.
      // A job absent >=14d is plausibly a real re-post by the company —
      // count it as new so the user sees it.
      const RETURN_REPOST_DAYS = 14;
      const REPOST_THRESHOLD_MS = RETURN_REPOST_DAYS * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const returnedJobs: { title: string; urlPath: string }[] = [];
      const realReposts: { title: string; urlPath: string }[] = [];
      for (const job of jobs) {
        const existing = existingByPath.get(job.urlPath);
        if (existing && (existing.status === "removed" || existing.status === "archived")) {
          const { error: returnErr } = await supabase
            .from("seen_jobs")
            .update({
              status: "active",
              status_changed_at: new Date().toISOString(),
              job_title: job.title,
              job_location: job.location,
            })
            .eq("id", existing.id);
          reportWriteError(returnErr, `flip returned job to active for ${company.name}`, { company: company.name });
          returnedJobs.push({ title: job.title, urlPath: job.urlPath });
          // Decide if it qualifies as a real re-post for the email
          if (existing.lastRemovedAt) {
            const removedMs = new Date(existing.lastRemovedAt).getTime();
            if (Number.isFinite(removedMs) && (nowMs - removedMs) >= REPOST_THRESHOLD_MS) {
              realReposts.push({ title: job.title, urlPath: job.urlPath });
            }
          }
          // No last_removed_at → legacy data without the timestamp; skip from
          // email (conservative — better to miss than to spam). Future data
          // populated by the removal-marking step below will give us proper signal.
        }
      }
      if (returnedJobs.length > 0) {
        console.log(`${company.name}: ${returnedJobs.length} job(s) returned (${realReposts.length} as real re-posts ≥${RETURN_REPOST_DAYS}d absent)`);
      }
      if (realReposts.length > 0) {
        const alertable = realReposts.filter((j) =>
          passesSeniorityThreshold(j.title, company.min_relevant_seniority)
        );
        newJobs.push(...alertable);
      }

      // 2.5. Refresh stale title/location on currently-active jobs. EA renames jobs
      // in-place (same URL, new title or new location — e.g., adding "- Cosmetics" or
      // moving from Orlando → Redwood City). Without this, users see the old strings
      // forever.
      const toRefresh: { id: string; title: string; location: string }[] = [];
      for (const job of jobs) {
        const existing = existingByPath.get(job.urlPath);
        if (
          existing &&
          existing.status === "active" &&
          (existing.title !== job.title || existing.location !== job.location)
        ) {
          toRefresh.push({ id: existing.id, title: job.title, location: job.location });
        }
      }
      if (toRefresh.length > 0) {
        console.log(`${company.name}: refreshing title/location for ${toRefresh.length} active job(s)`);
        const refreshResults = await Promise.all(
          toRefresh.map((r) =>
            supabase
              .from("seen_jobs")
              .update({ job_title: r.title, job_location: r.location })
              .eq("id", r.id)
          )
        );
        for (const r of refreshResults) {
          reportWriteError(r.error, `refresh title/location for ${company.name}`, { company: company.name });
        }
      }

      // 3. Missing jobs: in DB as 'active', not in scrape → mark 'removed'
      //    Also stamp last_removed_at so the 2-week return rule above can
      //    distinguish real re-posts from scraper jitter when this job
      //    eventually comes back.
      if (!skipRemoval) {
        const toRemove = (existingJobs || []).filter(
          (j) => j.status === "active" && !scrapedPaths.has(j.job_url_path)
        );
        if (toRemove.length > 0) {
          const removeIds = toRemove.map((j) => j.id);
          const nowIso = new Date().toISOString();
          const { error: removeErr } = await supabase
            .from("seen_jobs")
            .update({ status: "removed", status_changed_at: nowIso, last_removed_at: nowIso })
            .in("id", removeIds);
          reportWriteError(removeErr, `mark ${toRemove.length} stale jobs removed for ${company.name}`, { company: company.name });
          console.log(`${company.name}: ${toRemove.length} jobs marked as removed`);
        }
      }

      // Count actual active jobs in DB (after inserts/removals above).
      // DEV-37: this is a read, but a swallowed error here is dangerous — it
      // yields count=null → currentJobCount=0, which would falsely flag a hiring
      // company as zero-PM and could trip the auto-verify-zero / auto-disable
      // logic below. Surface it. (We still proceed with 0 as before; the error
      // signal is what was missing.)
      const { count: activeJobCount, error: activeCountErr } = await supabase
        .from("seen_jobs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .eq("status", "active");
      reportWriteError(activeCountErr, `count active jobs for ${company.name}`, { company: company.name });

      // Update company status. Successful scrape (any jobs found, even 0) resets
      // the consecutive_failure_count and clears auto_disabled — a probe-day success
      // re-enables the company automatically.
      // A 0-job scrape used to be stamped "success (quality: 0/100)" because
      // validateScrapeResults floors the score at 0 on empty input. That read as a
      // quality failure and tripped the session-start health-check grep on perfectly
      // healthy companies. Label the empty cases honestly instead.
      let checkStatus: string;
      if (jobs.length === 0) {
        checkStatus = sourceHealthy ? "success (0 PMs)" : "success (0 jobs from source)";
      } else if (validation.warnings.length > 0) {
        checkStatus = `success (quality: ${validation.qualityScore}/100)`;
      } else {
        checkStatus = "success";
      }

      // DEV-38: a "success" that returned 0 jobs from a REACHABLE source — or a
      // quality score far below normal — must not vanish into the success count.
      // Sentry.init no-ops on a broken DSN, but DEV-27/DEV-47 now guarantee the
      // pipeline is live, so these signals actually land. Routine zeros get a
      // breadcrumb (cheap context on any later error); a SURPRISING zero — the
      // company had jobs yesterday and a healthy source returned 0 PMs today,
      // the classic silent-scraper-break — gets escalated to a warning message.
      const prevJobCount = company.total_product_jobs ?? 0;
      if (jobs.length === 0 && sourceHealthy) {
        Sentry.addBreadcrumb({
          category: "scrape",
          level: "info",
          message: `${company.name}: source reachable but 0 PMs (prev ${prevJobCount})`,
          data: { company: company.name, prevJobCount, totalScanned: scrapeStats.totalScanned, sourceReachable: scrapeStats.sourceReachable ?? false },
        });
        if (prevJobCount > 0) {
          Sentry.captureMessage(
            `${company.name}: healthy source returned 0 PMs but had ${prevJobCount} active job(s) previously — possible silent scraper break`,
            { level: "warning", tags: { company: company.name, phase: "zero-from-reachable" } }
          );
          console.warn(`DEV-38: ${company.name} healthy-source zero after ${prevJobCount} prior jobs — surfaced to Sentry.`);
        }
      }
      // Abnormally-low quality score on a non-empty scrape: jobs came back but the
      // validator flagged them as low-confidence (lots of non-US / non-PM noise).
      // 50 is conservative — validateScrapeResults floors at 0, and a normal clean
      // board scores high; below 50 with jobs present is worth a look.
      const LOW_QUALITY_THRESHOLD = 50;
      if (jobs.length > 0 && validation.qualityScore < LOW_QUALITY_THRESHOLD) {
        Sentry.captureMessage(
          `${company.name}: quality score ${validation.qualityScore}/100 is far below normal (${jobs.length} jobs kept) — scraper may be returning noise`,
          { level: "warning", tags: { company: company.name, phase: "low-quality-score" } }
        );
        console.warn(`DEV-38: ${company.name} low quality score ${validation.qualityScore}/100 — surfaced to Sentry.`);
      }
      if (isProbing && jobs.length > 0) {
        reEnabled.push({ name: company.name, jobCount: jobs.length });
        await logScraperEvent(company.id, company.name, "auto_re_enabled", {
          jobCount: jobs.length,
        });
        Sentry.captureMessage(`Auto-re-enabled ${company.name} via Monday probe (${jobs.length} jobs)`, {
          level: "info",
          tags: { company: company.name, phase: "auto-re-enable" },
        });
        console.log(`${company.name}: AUTO-RE-ENABLED via Monday probe (${jobs.length} jobs)`);
      }
      // Once a company returns >0 PMs, it's verified for life. Never flip is_verified
      // back to false from a daily scrape. is_verified_zero is the OTHER direction —
      // we DO auto-flip that one as job counts change, see logic below.
      const currentJobCount = activeJobCount ?? 0;
      const currentZeroStreak = (company as { consecutive_zero_days?: number }).consecutive_zero_days ?? 0;
      const updates: Record<string, unknown> = {
        last_checked_at: new Date().toISOString(),
        last_check_status: checkStatus,
        total_product_jobs: currentJobCount,
        consecutive_failure_count: 0,
        auto_disabled: false,
        consecutive_healthy_zero_days: healthyZeroStreak,
      };
      if (currentJobCount > 0) {
        // PMs present: reset zero streak, mark scraper verified, and unmark any
        // prior is_verified_zero so the data accurately reflects "this company
        // is hiring again." Log the auto-flip-back for the Monday self-heal roll-up.
        updates.is_verified = true;
        updates.consecutive_zero_days = 0;
        if (company.is_verified_zero === true) {
          updates.is_verified_zero = false;
          await logScraperEvent(company.id, company.name, "auto_unverified_zero", {
            jobCount: currentJobCount,
          });
        }
      } else {
        // Zero PMs today. Increment streak and auto-act once thresholds cross.
        const newZeroStreak = currentZeroStreak + 1;
        updates.consecutive_zero_days = newZeroStreak;
        if (company.is_verified === true && company.is_verified_zero !== true && newZeroStreak >= AUTO_VERIFY_ZERO_DAYS) {
          updates.is_verified_zero = true;
          await logScraperEvent(company.id, company.name, "auto_verified_zero", {
            consecutiveZeroDays: newZeroStreak,
          });
          console.log(`${company.name}: AUTO-VERIFIED ZERO after ${newZeroStreak} consecutive zero days (scraper was previously verified)`);
        } else if (company.is_verified !== true && newZeroStreak >= SILENT_ZERO_DISABLE_DAYS) {
          updates.auto_disabled = true;
          await logScraperEvent(company.id, company.name, "auto_disabled", {
            reason: `${newZeroStreak} consecutive silent-zero days, scraper never produced a PM job`,
            consecutiveZeroDays: newZeroStreak,
          });
          console.warn(`${company.name}: AUTO-DISABLED after ${newZeroStreak} silent-zero days with no prior verification`);
        }
      }
      const { error: statusUpdateErr } = await supabase.from("companies").update(updates).eq("id", company.id);
      reportWriteError(statusUpdateErr, `persist scrape status for ${company.name}`, { company: company.name });

      companyAlerts.set(company.id, {
        companyName: company.name,
        careersUrl: company.careers_url,
        newJobs,
      });

      // Collect quality data for daily eval
      qualityData.set(company.id, {
        companyName: company.name,
        prevJobCount: company.total_product_jobs ?? 0,
        currentJobCount: activeJobCount ?? 0,
        nonUsFiltered: validation.nonUsFilteredCount,
        totalPmJobs: validation.totalPmJobs,
        qualityScore: validation.qualityScore,
        subscriberCount: company.subscriber_count ?? 0,
        isFirstScrape: !company.last_checked_at,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "unknown";
      console.error(`Error scraping ${company.name}:`, err);

      Sentry.captureException(err, {
        tags: { company: company.name, phase: "scrape" },
      });

      // If this was a probe-day re-attempt, the company stays disabled but we don't
      // ratchet the counter higher (it's already past the threshold).
      // Otherwise, increment and auto-disable at the threshold.
      let newFailureCount: number;
      let shouldAutoDisable: boolean;
      if (isProbing) {
        newFailureCount = company.consecutive_failure_count ?? AUTO_DISABLE_THRESHOLD;
        shouldAutoDisable = true;
        console.log(`${company.name}: probe failed — staying auto-disabled`);
      } else {
        newFailureCount = (company.consecutive_failure_count ?? 0) + 1;
        shouldAutoDisable = newFailureCount >= AUTO_DISABLE_THRESHOLD;
        if (shouldAutoDisable) {
          autoDisabled.push({ name: company.name, reason: errMsg });
          await logScraperEvent(company.id, company.name, "auto_disabled", {
            reason: errMsg,
            consecutiveFailures: newFailureCount,
          });
          Sentry.captureMessage(`Auto-disabled ${company.name} after ${newFailureCount} consecutive failures`, {
            level: "warning",
            tags: { company: company.name, phase: "auto-disable" },
          });
          console.warn(`${company.name}: AUTO-DISABLED after ${newFailureCount} consecutive failures`);
        }
      }

      failedCompanies.push({ name: company.name, error: errMsg, consecutiveFailures: newFailureCount });

      const { error: failUpdateErr } = await supabase
        .from("companies")
        .update({
          last_checked_at: new Date().toISOString(),
          last_check_status: `error: ${errMsg}`,
          consecutive_failure_count: newFailureCount,
          auto_disabled: shouldAutoDisable,
        })
        .eq("id", company.id);
      reportWriteError(failUpdateErr, `persist failure status for ${company.name}`, { company: company.name });

      companyAlerts.set(company.id, {
        companyName: company.name,
        careersUrl: company.careers_url,
        newJobs: [],
      });
    }

    // Delay between companies to avoid rate limiting
    await delay(5000);
  }

  // --- Per-user email alerts ---
  let emailBatchResult: BatchSendResult = { sent: 0, failed: 0, errors: [] };
  if (options?.skipEmails) {
    console.log("skipEmails=true — skipping per-user email alerts");
  } else {
    try {
      emailBatchResult = await sendPerUserAlerts(companyAlerts);
    } catch (err) {
      console.error("Failed to send per-user alerts:", err);
      // A total pipeline crash must NOT look like a quiet day. Report to Sentry
      // and force the admin digest by recording a synthetic send failure with
      // the error surfaced (digest fires on emailBatchResult.failed > 0).
      Sentry.captureException(err, { tags: { area: "sendPerUserAlerts" } });
      emailBatchResult = {
        sent: 0,
        failed: 1,
        errors: [`Per-user alert pipeline threw before sending: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  // --- Consolidated admin digest ---
  // Daily: fires only if there's something the admin needs to act on.
  // Monday (UTC): always fires with system health snapshot + past-7-days self-heal log.
  // forceMondayDigest=true overrides the day check (useful for manual triggers
  // when you want a Monday-style report on a non-Monday).
  await sendConsolidatedAdminDigest({
    totalCompanies: companies.length,
    failedCompanies,
    autoRemediated,
    stealthRecovered,
    autoFixed,
    autoDisabled,
    reEnabled,
    qualityData,
    emailBatchResult,
    forceMondayDigest: options?.forceMondayDigest ?? false,
  });

  // --- Weekly LinkedIn-draft digest (Fridays) ---
  // Fires after the daily run on Friday UTC so the freshly-scraped jobs are
  // included. Owned by Railway's daily cron — no separate Friday schedule
  // needed. forceWeeklyDigest=true allows ad-hoc test sends.
  const isFridayUtc = new Date().getUTCDay() === 5;
  if (isFridayUtc || options?.forceWeeklyDigest) {
    try {
      const { sendWeeklyDigest } = await import("./weeklyDigest");
      await sendWeeklyDigest();
    } catch (err) {
      // DEV-40: a swallowed weekly-digest failure means the Friday LinkedIn draft
      // silently never arrives. Report to Sentry; still non-fatal to the cron.
      console.error("Failed to send weekly digest:", err);
      Sentry.captureException(err, { tags: { area: "dailyCheck.weeklyDigest" } });
    }
  }

  // Refresh compensation data for all active companies
  console.log("Refreshing compensation data...");
  const companyNames = companies.map((c) => c.name);
  const COMP_BATCH = 3;
  for (let i = 0; i < companyNames.length; i += COMP_BATCH) {
    const batch = companyNames.slice(i, i + COMP_BATCH);
    // DEV-40: Promise.allSettled silently swallows rejections — a broken
    // levels.fyi refresh used to vanish without a trace. Inspect the settled
    // results and surface failures to Sentry (per-company tagged) so a
    // comp-pipeline outage is visible. Still non-fatal: comp data is enrichment,
    // not core, so we never abort the cron on it.
    const settled = await Promise.allSettled(batch.map((name) => getCompData(name)));
    settled.forEach((result, idx) => {
      if (result.status === "rejected") {
        const name = batch[idx];
        console.error(`Compensation refresh failed for ${name}:`, result.reason);
        Sentry.captureException(
          result.reason instanceof Error ? result.reason : new Error(`Comp refresh failed for ${name}: ${String(result.reason)}`),
          { tags: { area: "dailyCheck.compRefresh", company: name } }
        );
      }
    });
    if (i + COMP_BATCH < companyNames.length) await delay(2000);
  }
  console.log(`Compensation data refreshed for ${companyNames.length} companies.`);

  // Archive: mark jobs older than 60 days as 'archived' (replaces old 30-day DELETE)
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const { error: archiveErr } = await supabase
    .from("seen_jobs")
    .update({ status: "archived", status_changed_at: new Date().toISOString() })
    .eq("is_baseline", false)
    .neq("status", "archived")
    .lt("first_seen_at", sixtyDaysAgo.toISOString());
  reportWriteError(archiveErr, "archive jobs older than 60 days");

  console.log("Daily check complete.");

  // Failure threshold: if >25% of companies failed, throw so cron returns 500
  if (companies.length > 0 && failedCompanies.length / companies.length > 0.25) {
    const pct = Math.round((failedCompanies.length / companies.length) * 100);
    throw new Error(
      `Daily check failure rate too high: ${failedCompanies.length}/${companies.length} (${pct}%) companies failed. ` +
      `Failed: ${failedCompanies.map((f) => f.name).join(", ")}`
    );
  }
}

// Tripwire floor: if at least this many subscribers are eligible for an email
// and we still build zero emails on a day when companies DID post new jobs,
// treat it as a silent data bug (truncation / mapping) rather than a quiet day.
const EMAIL_TRIPWIRE_MIN_ELIGIBLE = 25;

async function sendPerUserAlerts(
  companyAlerts: Map<string, { companyName: string; careersUrl: string; newJobs: { title: string; urlPath: string }[] }>
): Promise<BatchSendResult> {
  // Get ALL users via proper pagination. The earlier `{ perPage: 1000 }`
  // bump fixed the immediate bug but would re-break at 1001 users. listAllUsers
  // iterates pages until exhausted.
  const users = await listAllUsers();
  console.log(`sendPerUserAlerts: fetched ${users.length} total users`);

  if (users.length === 0) {
    console.log("No users found — skipping email alerts");
    return { sent: 0, failed: 0, errors: [] };
  }

  // Get all user preferences
  const { data: allPrefs } = await supabase
    .from("user_preferences")
    .select("user_id, email_frequency");

  const prefsMap = new Map<string, string>();
  for (const pref of allPrefs || []) {
    prefsMap.set(pref.user_id, pref.email_frequency);
  }

  // Get all subscriptions (batched for all users). PostgREST silently caps
  // any single select at 1000 rows, so we MUST paginate — an unbounded
  // .select() returned only the oldest 1000 rows once the table crossed 1000
  // (2026-05), which dropped ~43% of subscribed users (all recent signups)
  // out of the email loop entirely: they were treated as having 0 companies
  // and skipped. Order by a stable unique key (id) so range pagination can't
  // skip or duplicate rows. Same footgun class as the listUsers() perPage bug.
  const allSubs: { user_id: string; company_id: string }[] = [];
  const SUBS_PAGE_SIZE = 1000;
  for (let from = 0; ; from += SUBS_PAGE_SIZE) {
    const { data: page, error: subsErr } = await supabase
      .from("user_subscriptions")
      .select("user_id, company_id")
      .order("id", { ascending: true })
      .range(from, from + SUBS_PAGE_SIZE - 1);
    if (subsErr) throw subsErr;
    if (!page || page.length === 0) break;
    allSubs.push(...page);
    if (page.length < SUBS_PAGE_SIZE) break;
  }
  console.log(`sendPerUserAlerts: fetched ${allSubs.length} total subscription rows`);

  const userSubsMap = new Map<string, string[]>();
  for (const sub of allSubs || []) {
    const existing = userSubsMap.get(sub.user_id) || [];
    existing.push(sub.company_id);
    userSubsMap.set(sub.user_id, existing);
  }

  const isMonday = new Date().getUTCDay() === 1;

  // Recommendation data: fetched once for the whole batch, reused per-user.
  // Picks from the pool of companies the user does NOT subscribe to that
  // posted PM jobs in the past 7 days. Recently-shown companies (last 7d)
  // are excluded so the email feels fresh each day.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  // DEV-36: both the recommendation candidate pool (companies-with-industry) and
  // the recent-jobs pool (every active PM job posted in the last 7 days across
  // the WHOLE catalog) are global selects with no row cap. The recent-jobs query
  // in particular fans out across ~250 companies and routinely exceeds PostgREST's
  // silent 1000-row cap — once truncated, whole industries silently vanish from
  // everyone's recommendations. Paginate both via fetchAllRows ordered by the
  // stable unique key `id`. The picker relies on most-recent-first ordering within
  // a company, which the id-order pagination destroys, so we re-sort by
  // first_seen_at DESC in Node afterward (same fetch-and-sort-in-Node pattern the
  // feed uses for nested ordering — see CLAUDE.md PostgREST gotcha).
  type RecentJobDbRow = {
    company_id: string;
    job_title: string;
    job_url_path: string;
    job_level: string | null;
    first_seen_at: string;
  };
  type CompanyIndustryDbRow = {
    id: string;
    name: string;
    careers_url: string;
    industry: string;
    min_relevant_seniority: string | null;
  };
  type RecommendationHistoryRow = { company_id: string };
  const [allCompaniesRows, recentJobsRows, recentShownRows] = await Promise.all([
    fetchAllRows<CompanyIndustryDbRow>((from, to) =>
      supabase
        .from("companies")
        .select("id, name, careers_url, industry, min_relevant_seniority")
        .not("industry", "is", null)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<RecentJobDbRow>((from, to) =>
      supabase
        .from("seen_jobs")
        .select("company_id, job_title, job_url_path, job_level, first_seen_at")
        .eq("is_baseline", false)
        .eq("status", "active")
        .gte("first_seen_at", sevenDaysAgo.toISOString())
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<RecommendationHistoryRow>((from, to) =>
      supabase
        .from("recommendation_history")
        .select("company_id")
        .gte("shown_date", new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))
        .order("company_id", { ascending: true })
        .range(from, to)
    ),
  ]);

  // Restore the most-recent-first ordering pickRecommendations expects (the
  // id-keyed pagination above does not preserve it).
  recentJobsRows.sort((a, b) => (a.first_seen_at < b.first_seen_at ? 1 : a.first_seen_at > b.first_seen_at ? -1 : 0));

  const recentlyShownIds = new Set<string>();
  for (const row of recentShownRows) {
    recentlyShownIds.add(row.company_id);
  }
  const allCompaniesWithIndustry: CompanyWithIndustry[] = allCompaniesRows.map((c) => ({
    id: c.id,
    name: c.name,
    careersUrl: c.careers_url,
    industry: c.industry,
    minRelevantSeniority: c.min_relevant_seniority ?? null,
  }));
  const recentJobsByCompany = new Map<string, RecentJobRow[]>();
  for (const row of recentJobsRows) {
    const list = recentJobsByCompany.get(row.company_id) || [];
    list.push({
      title: row.job_title,
      urlPath: row.job_url_path,
      level: (row.job_level as RecentJobRow["level"]) ?? null,
    });
    recentJobsByCompany.set(row.company_id, list);
  }

  // Collect all email payloads first, then batch-send via Resend batch API
  const emailPayloads: EmailPayload[] = [];
  // Track which companies got recommended in this batch so we can record
  // them in recommendation_history at the end (rotation will exclude them
  // for the next 7 days).
  const recommendedThisRun = new Map<string, string | null>(); // companyId -> industry

  for (const user of users) {
    if (!user.email) continue;

    // Check preference: default to 'daily' if not set
    const freq = prefsMap.get(user.id) || "daily";
    if (freq === "off") {
      console.log(`Skipping email for user ${user.id.slice(0, 8)}... (preference: off)`);
      continue;
    }

    // Weekly users only get emails on Mondays
    if (freq === "weekly" && !isMonday) {
      continue;
    }

    // Get this user's subscribed company IDs
    const userCompanyIds = userSubsMap.get(user.id) || [];
    if (userCompanyIds.length === 0) continue;

    // Compute recommendations for this user. Reused for daily + weekly.
    const recommendations = pickRecommendations(
      userCompanyIds,
      allCompaniesWithIndustry,
      recentJobsByCompany,
      recentlyShownIds
    );

    // Record what got recommended so the next 7 days' rotation excludes them.
    for (const rec of recommendations) {
      const companyRow = allCompaniesWithIndustry.find((c) => c.name === rec.companyName);
      if (companyRow) recommendedThisRun.set(companyRow.id, rec.industry);
    }

    if (freq === "weekly") {
      // Weekly digest: fetch jobs from the past 7 days for this user's subscriptions
      const weeklyAlerts = await getWeeklyAlerts(userCompanyIds);
      if (weeklyAlerts.length === 0) continue;

      emailPayloads.push(buildAlertEmailPayload(user.email, weeklyAlerts, "weekly", recommendations));
    } else {
      // Daily: use today's scrape results
      const userAlerts: NewJobAlert[] = [];
      for (const companyId of userCompanyIds) {
        const alert = companyAlerts.get(companyId);
        if (alert) {
          userAlerts.push(alert);
        }
      }

      if (userAlerts.length === 0) continue;

      emailPayloads.push(buildAlertEmailPayload(user.email, userAlerts, "daily", recommendations));
    }
  }

  // Batch send all emails (100 per API call, 1s delay between batches)
  console.log(`Sending ${emailPayloads.length} alert emails via batch API...`);
  const sendResult = await sendBatchAlerts(emailPayloads);
  console.log(`Per-user alerts: ${sendResult.sent} sent, ${sendResult.failed} failed`);

  // Record today's recommendations + age out old history (>30d).
  // Wrapped in try so a history-table failure can't block the cron from
  // returning the email send result.
  try {
    if (recommendedThisRun.size > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const rows = Array.from(recommendedThisRun.entries()).map(([company_id, industry]) => ({
        company_id,
        shown_date: today,
        industry,
      }));
      // DEV-37: supabase-js returns the error rather than throwing, so the catch
      // below would never see a DB-level failure here — check the returned error.
      const { error: recInsertErr } = await supabase.from("recommendation_history").insert(rows);
      reportWriteError(recInsertErr, "insert recommendation_history");
    }
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const { error: recDeleteErr } = await supabase.from("recommendation_history").delete().lt("shown_date", thirtyDaysAgo);
    reportWriteError(recDeleteErr, "age out recommendation_history (>30d)");
  } catch (err) {
    // DEV-40: also report the unexpected-throw path to Sentry (network blip,
    // serialization error). Non-fatal — the email send result still returns.
    console.error("recommendation_history write/cleanup failed (non-fatal):", err);
    Sentry.captureException(err, { tags: { area: "dailyCheck.recommendationHistory" } });
  }

  // Observability tripwire. A healthy day with new jobs should build emails for
  // a meaningful fraction of eligible subscribers. If a non-trivial eligible
  // pool produces ZERO emails while companies DID post new jobs, something
  // silently dropped users (the 1000-row truncation, a mis-keyed map, a bad
  // filter). This is the exact blind spot that hid the truncation bug for weeks
  // (PR #97): the run logged a healthy-looking "sent N" the whole time. Surface
  // it loudly via Sentry and force the admin digest instead of staying quiet.
  const eligibleSubscribed = users.filter((u) => {
    if (!u.email) return false;
    const freq = prefsMap.get(u.id) || "daily";
    if (freq === "off") return false;
    if (freq === "weekly" && !isMonday) return false;
    return (userSubsMap.get(u.id)?.length ?? 0) > 0;
  }).length;
  console.log(
    `sendPerUserAlerts: eligibleSubscribed=${eligibleSubscribed}, payloadsBuilt=${emailPayloads.length}, companiesWithNewJobs=${companyAlerts.size}`
  );

  if (
    eligibleSubscribed >= EMAIL_TRIPWIRE_MIN_ELIGIBLE &&
    emailPayloads.length === 0 &&
    companyAlerts.size > 0
  ) {
    const msg = `Email tripwire: ${eligibleSubscribed} eligible subscribers but 0 emails built, despite ${companyAlerts.size} companies posting new jobs today. Likely a silent data bug (truncation / mapping), not a quiet day.`;
    console.error(msg);
    sendResult.errors.push(msg);
    if (sendResult.failed === 0) sendResult.failed = eligibleSubscribed; // force the admin digest to fire
    Sentry.captureMessage(msg, "error");
  }

  // Email-send failures are surfaced in the admin digest (built at end of run).
  return sendResult;
}

/**
 * Build the inputs for sendAdminDigest, then call it.
 *
 * Decides whether today is a Monday weekly digest day. On Mondays, queries the
 * scraper_events table for the past 7 days and the companies table for current
 * system health. Otherwise, only computes the action-required inputs and lets
 * sendAdminDigest decide whether to actually send (silent days = no email).
 */
async function sendConsolidatedAdminDigest(input: {
  totalCompanies: number;
  failedCompanies: { name: string; error: string; consecutiveFailures: number }[];
  autoRemediated: { name: string; from: string; to: string }[];
  stealthRecovered: { name: string; jobCount: number }[];
  autoFixed: { name: string; ruleId: string; description: string; message: string }[];
  autoDisabled: { name: string; reason: string }[];
  reEnabled: { name: string; jobCount: number }[];
  qualityData: Map<string, CompanyQualityData>;
  emailBatchResult: BatchSendResult;
  forceMondayDigest: boolean;
}): Promise<void> {
  // Weekly digest fires Monday UTC. The Tuesday safety-net duplicate was
  // dropped 2026-05-18 — the daily self-check agent now surfaces anything
  // worth re-reviewing without waiting for the next email cycle.
  // forceMondayDigest=true overrides for ad-hoc manual triggers.
  const dayOfWeek = new Date().getUTCDay();
  const isMondayDigest = input.forceMondayDigest || dayOfWeek === 1;

  // Watch list: companies that have failed 3+ days in a row but aren't auto-disabled yet.
  // Snapshot AFTER the loop completes, since consecutive_failure_count was updated above.
  const { data: watchListRows } = await supabase
    .from("companies")
    .select("name, consecutive_failure_count")
    .gte("consecutive_failure_count", 3)
    .lte("consecutive_failure_count", 6)
    .eq("auto_disabled", false);

  const watchList = (watchListRows || []).map((c) => ({
    name: c.name,
    consecutiveFailures: c.consecutive_failure_count,
  }));

  // Subscribed-company-dropped-to-zero: had jobs yesterday, has none today, has subscribers.
  // This is the only daily-eval signal worth surfacing — it usually means a scraper broke.
  const subscribedZeroDrops: { name: string; prevCount: number; subscribers: number }[] = [];
  for (const data of input.qualityData.values()) {
    if (
      data.subscriberCount > 0 &&
      data.prevJobCount > 0 &&
      data.currentJobCount === 0
    ) {
      subscribedZeroDrops.push({
        name: data.companyName,
        prevCount: data.prevJobCount,
        subscribers: data.subscriberCount,
      });
    }
  }

  // Unverified-zeros email section retired 2026-05-28 — the daily cron now
  // auto-confirms zeros (is_verified_zero=true) after AUTO_VERIFY_ZERO_DAYS
  // for previously-verified scrapers and auto-disables never-verified ones
  // after SILENT_ZERO_DISABLE_DAYS. Both actions log to scraper_events and
  // surface in the Monday self-heal roll-up.

  // ---- Analysis layer (PR #19) ----------------------------------------------
  // For every company that landed in an action-required section, pull the past
  // 7 days of scraper_events + their current health columns. We use these to
  // (a) render a per-company "trend" annotation in the email (so the admin sees
  // "3rd consecutive failure" not just "failed today"), and (b) detect
  // cross-cutting patterns (e.g. "3 failures today are all on Ashby — possible
  // platform-wide regression").
  const { perCompanyTrends, crossCuttingPatterns } = await buildDigestAnalysis({
    failedCompanies: input.failedCompanies,
    watchList,
    subscribedZeroDrops,
  });

  // Monday-only: weekly health snapshot + past-7-days self-heal log + security check
  let weeklyHealth: { healthy: number; disabled: number; watchListCount: number } | undefined;
  let weeklyEvents:
    | { event_type: string; company_name: string; created_at: string; details: Record<string, unknown> | null }[]
    | undefined;
  let securityFindings: Awaited<ReturnType<typeof runSecurityCheck>> = null;

  if (isMondayDigest) {
    const [healthCounts, eventsRows, security] = await Promise.all([
      supabase
        .from("companies")
        .select("auto_disabled, consecutive_failure_count")
        .eq("is_active", true),
      (async () => {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return supabase
          .from("scraper_events")
          .select("event_type, company_name, created_at, details")
          .gte("created_at", sevenDaysAgo.toISOString())
          .order("created_at", { ascending: false });
      })(),
      runSecurityCheck(),
    ]);

    const rows = healthCounts.data || [];
    const disabled = rows.filter((r) => r.auto_disabled).length;
    const onWatch = rows.filter((r) => !r.auto_disabled && (r.consecutive_failure_count ?? 0) >= 3).length;
    const healthy = rows.length - disabled - onWatch;
    weeklyHealth = { healthy, disabled, watchListCount: onWatch };
    weeklyEvents = eventsRows.data || [];
    securityFindings = security;
  }

  try {
    await sendAdminDigest({
      totalCompanies: input.totalCompanies,
      failedCompanies: input.failedCompanies,
      watchList,
      autoDisabled: input.autoDisabled,
      subscribedZeroDrops,
      autoRemediated: input.autoRemediated,
      stealthRecovered: input.stealthRecovered,
      autoFixed: input.autoFixed,
      reEnabled: input.reEnabled,
      emailBatchResult: input.emailBatchResult,
      isMondayDigest,
      weeklyHealth,
      weeklyEvents,
      securityFindings,
      perCompanyTrends,
      crossCuttingPatterns,
    });
  } catch (err) {
    // DEV-40: surface a swallowed admin-digest failure to Sentry — otherwise the
    // admin simply stops getting the daily/Monday health email with no trace.
    console.error("Failed to send admin digest:", err);
    Sentry.captureException(err, { tags: { area: "dailyCheck.adminDigest" } });
  }
}

/**
 * Build the per-company trend annotations + cross-cutting pattern detections
 * that the admin digest renders alongside its raw lists. Two DB queries total
 * (scraper_events + companies, both narrowed by IN clause to the flagged set)
 * so DB load is bounded regardless of how many companies are in the catalog.
 */
async function buildDigestAnalysis(input: {
  failedCompanies: { name: string }[];
  watchList: { name: string }[];
  subscribedZeroDrops: { name: string }[];
}): Promise<{
  perCompanyTrends: Map<string, string>;
  crossCuttingPatterns: { kind: string; description: string; companies: string[] }[];
}> {
  const flaggedSet = new Set<string>();
  for (const c of input.failedCompanies) flaggedSet.add(c.name);
  for (const c of input.watchList) flaggedSet.add(c.name);
  for (const c of input.subscribedZeroDrops) flaggedSet.add(c.name);

  const perCompanyTrends = new Map<string, string>();
  const crossCuttingPatterns: { kind: string; description: string; companies: string[] }[] = [];
  if (flaggedSet.size === 0) return { perCompanyTrends, crossCuttingPatterns };

  const flaggedNames = Array.from(flaggedSet);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [eventsResult, companiesResult] = await Promise.all([
    supabase
      .from("scraper_events")
      .select("company_name, event_type, created_at")
      .in("company_name", flaggedNames)
      .gte("created_at", sevenDaysAgo.toISOString()),
    supabase
      .from("companies")
      .select("name, consecutive_failure_count, platform_type, total_product_jobs, last_check_status")
      .in("name", flaggedNames),
  ]);

  const events = eventsResult.data || [];
  const companyRows = companiesResult.data || [];
  const companyByName = new Map(companyRows.map((c) => [c.name, c]));

  // Group events per company per type for annotation building.
  const eventsByCompany = new Map<string, Map<string, number>>();
  for (const ev of events) {
    const m = eventsByCompany.get(ev.company_name) || new Map<string, number>();
    m.set(ev.event_type, (m.get(ev.event_type) || 0) + 1);
    eventsByCompany.set(ev.company_name, m);
  }

  // ---- Per-company trend annotations ----
  for (const name of flaggedNames) {
    const company = companyByName.get(name);
    const evCounts = eventsByCompany.get(name) || new Map<string, number>();
    const parts: string[] = [];

    const streak = company?.consecutive_failure_count ?? 0;
    if (streak >= 2) {
      parts.push(`day ${streak} of failure streak`);
    } else if (streak === 1) {
      parts.push("first failure today");
    }

    const stealth = evCounts.get("stealth_recovery") || 0;
    if (stealth > 0) parts.push(`stealth recovered ${stealth}× this week`);
    const remediated = evCounts.get("auto_remediation") || 0;
    if (remediated > 0) parts.push(`auto-fixed ${remediated}× this week`);
    const disabled = evCounts.get("auto_disabled") || 0;
    if (disabled > 0) parts.push(`auto-disabled this week`);
    const reEnabled = evCounts.get("auto_re_enabled") || 0;
    if (reEnabled > 0) parts.push(`re-enabled this week`);

    if (parts.length > 0) {
      perCompanyTrends.set(name, parts.join(" · "));
    } else if (streak === 0 && company?.total_product_jobs === 0) {
      // Unverified zero with no failure activity — boring background row.
      perCompanyTrends.set(name, "no recent self-heal activity");
    }
  }

  // ---- Cross-cutting patterns ----
  // Pattern 1: ≥3 of today's failures share a platform_type. Likely a
  // platform-wide regression (e.g., Ashby GraphQL endpoint dropped, all our
  // Ashby companies fail simultaneously). Worth surfacing so admin doesn't
  // chase each one separately.
  const failedPlatformGroups = new Map<string, string[]>();
  for (const f of input.failedCompanies) {
    const platform = companyByName.get(f.name)?.platform_type;
    if (!platform || platform === "generic") continue;
    const list = failedPlatformGroups.get(platform) || [];
    list.push(f.name);
    failedPlatformGroups.set(platform, list);
  }
  for (const [platform, companies] of failedPlatformGroups) {
    if (companies.length >= 3) {
      crossCuttingPatterns.push({
        kind: "platform_failure_cluster",
        description: `${companies.length} failed scrapes today are all on ${platform}. Possible platform-wide regression — check the platform's status before chasing each company.`,
        companies,
      });
    }
  }
  // (Pattern 2 — unverified-zeros platform clusters — retired 2026-05-28 along
  // with the unverified-zeros email section. The auto-verify/auto-disable cron
  // logic handles them silently now.)

  return { perCompanyTrends, crossCuttingPatterns };
}

/**
 * Fetch new jobs from the past 7 days for a set of companies.
 * Used for weekly digest emails.
 */
async function getWeeklyAlerts(companyIds: string[]): Promise<NewJobAlert[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Parallel: fetch companies + recent jobs
  const [companiesResult, jobsResult] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, careers_url")
      .in("id", companyIds),
    supabase
      .from("seen_jobs")
      .select("company_id, job_title, job_url_path")
      .in("company_id", companyIds)
      .eq("is_baseline", false)
      .eq("status", "active")
      .gte("first_seen_at", sevenDaysAgo.toISOString())
      .order("first_seen_at", { ascending: false }),
  ]);

  const companies = companiesResult.data || [];
  const jobs = jobsResult.data || [];

  const companyMap = new Map(companies.map((c) => [c.id, c]));

  // Group jobs by company
  const jobsByCompany = new Map<string, { title: string; urlPath: string }[]>();
  for (const job of jobs) {
    const list = jobsByCompany.get(job.company_id) || [];
    list.push({ title: job.job_title, urlPath: job.job_url_path });
    jobsByCompany.set(job.company_id, list);
  }

  const alerts: NewJobAlert[] = [];
  for (const companyId of companyIds) {
    const company = companyMap.get(companyId);
    if (!company) continue;
    alerts.push({
      companyName: company.name,
      careersUrl: company.careers_url,
      newJobs: jobsByCompany.get(companyId) || [],
    });
  }

  return alerts;
}
