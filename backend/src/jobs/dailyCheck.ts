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

// Log a self-healing event to the scraper_events table. Used to power the
// Monday weekly digest. Best-effort: failures are swallowed so they never
// break the cron run.
async function logScraperEvent(
  companyId: string,
  companyName: string,
  eventType: "auto_remediation" | "stealth_recovery" | "auto_disabled" | "auto_re_enabled",
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

export async function runDailyCheck(options?: { skipEmails?: boolean; forceMondayDigest?: boolean }): Promise<void> {
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

async function runDailyCheckInner(options?: { skipEmails?: boolean; forceMondayDigest?: boolean }): Promise<void> {
  console.log(`Starting daily job check...${options?.skipEmails ? " (skipEmails mode)" : ""}`);

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

  // Collect quality data for daily eval
  const qualityData: Map<string, CompanyQualityData> = new Map();

  // Self-healing: companies auto-disabled after AUTO_DISABLE_THRESHOLD consecutive
  // failures. Skipped from scraping until probe day (Monday) gives them another chance.
  const AUTO_DISABLE_THRESHOLD = 7;
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
      const CUSTOM_SCRAPER_HOSTS = ["ea.com", "atlassian.com", "netflix.net", "netflix.com", "uber.com", "google.com", "amazon.jobs", "intuit.com", "rivian.com", "costco.com", "coinbase.com", "apple.com", "metacareers.com", "tiktok.com", "tesla.com", "wayfair.com", "shopify.com", "ebayinc.com", "higher.gs.com", "gs.com", "jobs.deel.com", "kpmguscareers.com", "revolut.com", "bcg.com", "careers.ey.com"];
      const companyHost = new URL(company.careers_url).hostname;
      const isCustomScraper = CUSTOM_SCRAPER_HOSTS.some((h) => companyHost.includes(h));
      if (sourceEmpty && !isCustomScraper) {
        const prevPlatform = company.platform_type || "generic";
        console.log(`${company.name}: 0 jobs with ${prevPlatform} scraper, trying broad ATS discovery...`);
        try {
          const discovery = await broadATSDiscovery(company.careers_url, company.name);
          if (discovery && discovery.platformType !== company.platform_type) {
            console.log(`${company.name}: Broad discovery found NEW platform ${discovery.platformType} (was: ${prevPlatform})`);
            // Re-scrape with discovered platform, reusing same stats out-param
            scrapeStats.totalScanned = 0;
            rawJobs = await scrapeCompanyCareers(company.careers_url, discovery.platformType, discovery.platformConfig, scrapeStats);
            console.log(`${company.name}: Re-scrape with ${discovery.platformType} found ${rawJobs.length} raw jobs (scanned ${scrapeStats.totalScanned})`);

            // Auto-update platform_type + platform_config so future scrapes work directly
            if (rawJobs.length > 0) {
              await supabase
                .from("companies")
                .update({
                  platform_type: discovery.platformType,
                  platform_config: discovery.platformConfig,
                })
                .eq("id", company.id);
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
                  await supabase
                    .from("companies")
                    .update({
                      platform_type: inferred.platformType,
                      platform_config: inferred.platformConfig,
                    })
                    .eq("id", company.id);
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

      // Get existing active jobs for this company
      const { data: existingJobs } = await supabase
        .from("seen_jobs")
        .select("id, job_url_path, status, job_title, job_location, last_removed_at")
        .eq("company_id", company.id);

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

      // Safety: if scrape returns 0 for a company with existing active jobs, skip removal marking
      const existingActiveCount = (existingJobs || []).filter((j) => j.status === "active").length;
      const scrapeReturnedZero = jobs.length === 0 && existingActiveCount > 0;
      if (scrapeReturnedZero) {
        console.warn(`SAFETY: ${company.name} scrape returned 0 jobs but has ${existingActiveCount} active. Skipping removal marking.`);
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
        if (insertError) {
          console.error(`Failed to insert jobs for ${company.name}:`, insertError);
        }

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
          await supabase
            .from("seen_jobs")
            .update({
              status: "active",
              status_changed_at: new Date().toISOString(),
              job_title: job.title,
              job_location: job.location,
            })
            .eq("id", existing.id);
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
        await Promise.all(
          toRefresh.map((r) =>
            supabase
              .from("seen_jobs")
              .update({ job_title: r.title, job_location: r.location })
              .eq("id", r.id)
          )
        );
      }

      // 3. Missing jobs: in DB as 'active', not in scrape → mark 'removed'
      //    Also stamp last_removed_at so the 2-week return rule above can
      //    distinguish real re-posts from scraper jitter when this job
      //    eventually comes back.
      if (!scrapeReturnedZero) {
        const toRemove = (existingJobs || []).filter(
          (j) => j.status === "active" && !scrapedPaths.has(j.job_url_path)
        );
        if (toRemove.length > 0) {
          const removeIds = toRemove.map((j) => j.id);
          const nowIso = new Date().toISOString();
          await supabase
            .from("seen_jobs")
            .update({ status: "removed", status_changed_at: nowIso, last_removed_at: nowIso })
            .in("id", removeIds);
          console.log(`${company.name}: ${toRemove.length} jobs marked as removed`);
        }
      }

      // Count actual active jobs in DB (after inserts/removals above)
      const { count: activeJobCount } = await supabase
        .from("seen_jobs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .eq("status", "active");

      // Update company status. Successful scrape (any jobs found, even 0) resets
      // the consecutive_failure_count and clears auto_disabled — a probe-day success
      // re-enables the company automatically.
      const checkStatus = validation.warnings.length > 0
        ? `success (quality: ${validation.qualityScore}/100)`
        : "success";
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
      // Once a company returns >0 PMs, it's verified for life. Never flip back to
      // false from a daily scrape — admin verification of legit zeros is preserved.
      const updates: Record<string, unknown> = {
        last_checked_at: new Date().toISOString(),
        last_check_status: checkStatus,
        total_product_jobs: activeJobCount ?? 0,
        consecutive_failure_count: 0,
        auto_disabled: false,
      };
      if ((activeJobCount ?? 0) > 0) {
        updates.is_verified = true;
      }
      await supabase.from("companies").update(updates).eq("id", company.id);

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

      await supabase
        .from("companies")
        .update({
          last_checked_at: new Date().toISOString(),
          last_check_status: `error: ${errMsg}`,
          consecutive_failure_count: newFailureCount,
          auto_disabled: shouldAutoDisable,
        })
        .eq("id", company.id);

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
    autoDisabled,
    reEnabled,
    qualityData,
    emailBatchResult,
    forceMondayDigest: options?.forceMondayDigest ?? false,
  });

  // Refresh compensation data for all active companies
  console.log("Refreshing compensation data...");
  const companyNames = companies.map((c) => c.name);
  const COMP_BATCH = 3;
  for (let i = 0; i < companyNames.length; i += COMP_BATCH) {
    const batch = companyNames.slice(i, i + COMP_BATCH);
    await Promise.allSettled(batch.map((name) => getCompData(name)));
    if (i + COMP_BATCH < companyNames.length) await delay(2000);
  }
  console.log(`Compensation data refreshed for ${companyNames.length} companies.`);

  // Archive: mark jobs older than 60 days as 'archived' (replaces old 30-day DELETE)
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  await supabase
    .from("seen_jobs")
    .update({ status: "archived", status_changed_at: new Date().toISOString() })
    .eq("is_baseline", false)
    .neq("status", "archived")
    .lt("first_seen_at", sixtyDaysAgo.toISOString());

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

async function sendPerUserAlerts(
  companyAlerts: Map<string, { companyName: string; careersUrl: string; newJobs: { title: string; urlPath: string }[] }>
): Promise<BatchSendResult> {
  // Get all users
  const { data: usersData } = await supabase.auth.admin.listUsers();
  const users = usersData?.users || [];

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

  // Get all subscriptions (batched for all users)
  const { data: allSubs } = await supabase
    .from("user_subscriptions")
    .select("user_id, company_id");

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
  const [allCompaniesResult, recentJobsResult, recentShownResult] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, careers_url, industry, min_relevant_seniority")
      .not("industry", "is", null),
    supabase
      .from("seen_jobs")
      .select("company_id, job_title, job_url_path, job_level, first_seen_at")
      .eq("is_baseline", false)
      .eq("status", "active")
      .gte("first_seen_at", sevenDaysAgo.toISOString())
      .order("first_seen_at", { ascending: false }),
    supabase
      .from("recommendation_history")
      .select("company_id")
      .gte("shown_date", new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)),
  ]);

  const recentlyShownIds = new Set<string>();
  for (const row of recentShownResult.data || []) {
    recentlyShownIds.add(row.company_id as string);
  }
  const allCompaniesWithIndustry: CompanyWithIndustry[] = (allCompaniesResult.data || []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    careersUrl: c.careers_url as string,
    industry: c.industry as string,
    minRelevantSeniority: (c.min_relevant_seniority as string | null) ?? null,
  }));
  const recentJobsByCompany = new Map<string, RecentJobRow[]>();
  for (const row of recentJobsResult.data || []) {
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
      await supabase.from("recommendation_history").insert(rows);
    }
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    await supabase.from("recommendation_history").delete().lt("shown_date", thirtyDaysAgo);
  } catch (err) {
    console.error("recommendation_history write/cleanup failed (non-fatal):", err);
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

  // Unverified zeros: every company currently at 0 PMs without admin sign-off.
  // Silent-zero failures look identical to legitimate zeros at the scraper level,
  // so this section forces every 0-PM company through human eyes once.
  // Subscribed companies come first; suppress the row by setting is_verified_zero=true.
  const { data: unverifiedZeroRows } = await supabase
    .from("companies")
    .select("name, subscriber_count, last_checked_at")
    .eq("total_product_jobs", 0)
    .eq("is_verified_zero", false)
    .or("auto_disabled.is.null,auto_disabled.eq.false")
    .order("subscriber_count", { ascending: false })
    .order("name", { ascending: true });

  const unverifiedZeros = (unverifiedZeroRows || []).map((c) => ({
    name: c.name,
    subscribers: c.subscriber_count ?? 0,
    lastCheckedAt: c.last_checked_at,
  }));

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
    unverifiedZeros: unverifiedZeros.slice(0, 25), // cap to bound the IN query
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
      unverifiedZeros,
      autoRemediated: input.autoRemediated,
      stealthRecovered: input.stealthRecovered,
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
    console.error("Failed to send admin digest:", err);
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
  unverifiedZeros: { name: string }[];
}): Promise<{
  perCompanyTrends: Map<string, string>;
  crossCuttingPatterns: { kind: string; description: string; companies: string[] }[];
}> {
  const flaggedSet = new Set<string>();
  for (const c of input.failedCompanies) flaggedSet.add(c.name);
  for (const c of input.watchList) flaggedSet.add(c.name);
  for (const c of input.subscribedZeroDrops) flaggedSet.add(c.name);
  for (const c of input.unverifiedZeros) flaggedSet.add(c.name);

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
  // Pattern 2: ≥5 unverified zeros share a platform_type. Could mean the
  // platform-specific filter (e.g., Ashby title-keyword) is over-filtering.
  const zeroPlatformGroups = new Map<string, string[]>();
  for (const z of input.unverifiedZeros) {
    const platform = companyByName.get(z.name)?.platform_type;
    if (!platform || platform === "generic") continue;
    const list = zeroPlatformGroups.get(platform) || [];
    list.push(z.name);
    zeroPlatformGroups.set(platform, list);
  }
  for (const [platform, companies] of zeroPlatformGroups) {
    if (companies.length >= 5) {
      crossCuttingPatterns.push({
        kind: "platform_zero_cluster",
        description: `${companies.length} unverified-zero companies share platform ${platform}. Could mean the ${platform} filter is over-rejecting — sanity-check the scraper's filtering logic.`,
        companies,
      });
    }
  }

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
