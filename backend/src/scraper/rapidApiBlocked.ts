import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/fetchAllRows";
import { validateScrapeResults } from "./validateScrape";
import { classifyJobLevel } from "../lib/classifyLevel";
import { ScrapedJob } from "./scraper";

// ---------------------------------------------------------------------------
// RapidAPI (Fantastic.jobs) LinkedIn feed — restore the scraping-blocked
// employers (Meta / Tesla / TikTok / Wayfair).
//
// These four employers hard-block our direct ATS scraping (Akamai 403, FB
// session-gating, Stargate gateway 2012, Workday 401/422 — see SCRAPER.md), so
// they carry `companies.scrape_blocked = true` and show a "Scraping blocked"
// badge instead of "0 roles" (PRs #130/#134). The Fantastic.jobs RapidAPI
// LinkedIn feed indexes their public LinkedIn job postings, so we can pull their
// US Product Manager roles WITHOUT touching the blocked career sites directly.
//
// Why a separate module (not a scraper.ts platform): this is a paid third-party
// aggregator with a HARD free-tier quota (250 jobs + 25 requests/month). We do
// NOT want it in the daily per-company loop hitting the API for every company.
// It is invoked once per day, gated behind RAPIDAPI_ACTIVATION_DATE, and ONLY
// for companies still flagged scrape_blocked — so it self-stops the moment a
// company is successfully restored. Nothing here changes any existing scraper or
// CUSTOM_SCRAPER_HOSTS.
//
// Verified API facts (live probes, 2026-05-30 — key on Railway as RAPIDAPI_KEY):
//   host:   linkedin-job-search-api.p.rapidapi.com
//   GET     /active-jb-7d
//   params: offset=0, title_filter="Product Manager" (quotes => exact phrase),
//           location_filter="United States", organization_filter=<CompanyName>,
//           description_type=text
//   org filter works by company display name. Confirmed 7d PM/US counts:
//     Meta 8, Tesla 22, TikTok 4, Wayfair 0 (Wayfair has nothing on LinkedIn,
//     so it simply stays scrape_blocked).
// ---------------------------------------------------------------------------

const RAPIDAPI_HOST = "linkedin-job-search-api.p.rapidapi.com";
const RAPIDAPI_BASE = `https://${RAPIDAPI_HOST}/active-jb-7d`;
const PLATFORM_TYPE = "rapidapi_linkedin";

// Raw job shape returned by the Fantastic.jobs LinkedIn feed. Only the fields we
// consume are typed; the payload carries many more. All optional/loose because
// it is a third-party response we never fully control.
interface RapidApiJob {
  id?: string | number;
  title?: string;
  organization?: string;
  url?: string;
  date_posted?: string;
  locations_derived?: string[] | null;
  cities_derived?: string[] | null;
  countries_derived?: string[] | null;
  seniority?: string | null;
  salary_raw?: unknown;
}

export interface RapidApiPullResult {
  company: string;
  jobsAdded: number;
  blockedClearedFor: string[];
  error?: string;
}

// Companies row fields we read here. Loose-typed because the rest of the codebase
// treats the companies row as `any`.
interface BlockedCompanyRow {
  id: string;
  name: string;
  min_relevant_seniority?: string | null;
}

/**
 * Derive a stable, unique seen_jobs.job_url_path from a LinkedIn apply URL.
 * seen_jobs is UNIQUE on (company_id, job_url_path), so the path must be stable
 * for the same listing across runs (idempotent upsert) and distinct per listing.
 * We keep the full normalized URL (origin + pathname; query/hash stripped) so it
 * stays a valid clickable apply link AND a stable dedupe key. LinkedIn job URLs
 * already encode the numeric job id in the pathname, so dropping the query is safe.
 */
function deriveJobUrlPath(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // Strip query + hash: LinkedIn appends tracking params that vary per fetch
    // and would otherwise make the same listing look "new" every run.
    return `${u.origin}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Pick the best human-readable location string for a job. */
function deriveLocation(job: RapidApiJob): string {
  const city = job.cities_derived?.find((c) => typeof c === "string" && c.trim());
  if (city) return city.trim();
  const loc = job.locations_derived?.find((l) => typeof l === "string" && l.trim());
  if (loc) return loc.trim();
  return "United States";
}

/**
 * Call the Fantastic.jobs LinkedIn feed for one company's US Product Manager
 * roles. Returns the raw (pre-filter) job array. Throws on a network/HTTP error
 * so the caller's per-company try/catch records it and moves on.
 *
 * Logs the quota headers and emits a Sentry "warning" (never throws) when the
 * free-tier remaining-jobs / remaining-requests counters approach zero.
 */
async function fetchCompanyJobs(companyName: string, apiKey: string): Promise<RapidApiJob[]> {
  const params = new URLSearchParams({
    offset: "0",
    // Quotes => exact-phrase match on the source. URLSearchParams URL-encodes the
    // quotes for us, so the wire value is title_filter=%22Product+Manager%22.
    title_filter: `"Product Manager"`,
    location_filter: `"United States"`,
    organization_filter: companyName,
    description_type: "text",
  });
  const url = `${RAPIDAPI_BASE}?${params.toString()}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "x-rapidapi-host": RAPIDAPI_HOST,
      "x-rapidapi-key": apiKey,
    },
  });

  // Quota headers come back on every response — log them and warn (do NOT throw)
  // when the free-tier budget is nearly spent so we notice before it hard-stops.
  const jobsRemaining = resp.headers.get("x-ratelimit-jobs-remaining");
  const requestsRemaining = resp.headers.get("x-ratelimit-requests-remaining");
  console.log(
    `[rapidapi] ${companyName}: HTTP ${resp.status}; quota jobs-remaining=${jobsRemaining ?? "?"} requests-remaining=${requestsRemaining ?? "?"}`
  );
  const jobsRemNum = jobsRemaining != null ? Number(jobsRemaining) : NaN;
  const reqRemNum = requestsRemaining != null ? Number(requestsRemaining) : NaN;
  if ((Number.isFinite(jobsRemNum) && jobsRemNum <= 5) || (Number.isFinite(reqRemNum) && reqRemNum <= 2)) {
    Sentry.captureMessage(
      `RapidAPI LinkedIn feed quota nearly exhausted (jobs-remaining=${jobsRemaining}, requests-remaining=${requestsRemaining}) — blocked-employer restore will stall until the monthly reset`,
      { level: "warning", tags: { area: "rapidapi-blocked", phase: "quota" } }
    );
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`RapidAPI ${resp.status} for ${companyName}: ${body.slice(0, 300)}`);
  }

  const data = await resp.json().catch(() => null);
  if (!Array.isArray(data)) {
    // A reachable 200 with a non-array body (rate-limit JSON object, error
    // envelope) means "no usable jobs," not a crash — treat as empty.
    console.warn(`[rapidapi] ${companyName}: 200 but response was not a job array — treating as 0 jobs`);
    return [];
  }
  return data as RapidApiJob[];
}

/**
 * For every company currently `scrape_blocked = true`, pull its US Product
 * Manager jobs from the Fantastic.jobs LinkedIn feed, run them through the SAME
 * PM + US validation the rest of the pipeline uses, and UPSERT into seen_jobs
 * (insert-or-refresh ONLY — NEVER mark missing jobs removed; the feed is a
 * rolling 7-day window, so the standard diff-removal would wrongly delist older
 * still-live roles. They age out via the existing 60-day archive instead).
 *
 * On a company that yields >=1 US PM job, flips companies.scrape_blocked=false
 * and repoints it at this feed (platform_type='rapidapi_linkedin',
 * platform_config={"orgName": <name>}) so it reads as restored everywhere.
 *
 * Never throws on a single-company failure: each is caught, recorded, and the
 * loop continues. Returns one result row per processed company.
 */
export async function pullRapidApiBlockedEmployers(): Promise<RapidApiPullResult[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    console.warn("[rapidapi] RAPIDAPI_KEY not set — skipping blocked-employer restore");
    return [];
  }

  // Companies still flagged scrape_blocked. Once one is restored below it stops
  // matching this query, so re-runs self-skip the already-restored ones and the
  // routine effectively runs each day until it succeeds, then stops touching
  // them (e.g. Wayfair, which has nothing on LinkedIn, stays flagged forever and
  // is simply retried cheaply).
  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, min_relevant_seniority")
    .eq("scrape_blocked", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("[rapidapi] failed to load scrape_blocked companies:", error);
    Sentry.captureException(error instanceof Error ? error : new Error(`load scrape_blocked: ${JSON.stringify(error)}`), {
      tags: { area: "rapidapi-blocked", phase: "load-companies" },
    });
    return [];
  }

  const blocked = (companies ?? []) as BlockedCompanyRow[];
  if (blocked.length === 0) {
    console.log("[rapidapi] no scrape_blocked companies to restore");
    return [];
  }

  console.log(`[rapidapi] restoring ${blocked.length} scrape_blocked company(ies): ${blocked.map((c) => c.name).join(", ")}`);

  const results: RapidApiPullResult[] = [];

  for (const company of blocked) {
    const result: RapidApiPullResult = { company: company.name, jobsAdded: 0, blockedClearedFor: [] };
    try {
      const rawJobs = await fetchCompanyJobs(company.name, apiKey);

      // Map the feed payload to our ScrapedJob shape, dropping entries without a
      // usable apply URL (no stable dedupe key possible).
      const mapped: ScrapedJob[] = [];
      for (const job of rawJobs) {
        if (!job.url || typeof job.url !== "string") continue;
        const urlPath = deriveJobUrlPath(job.url);
        if (!urlPath) continue;
        const title = (job.title || "").trim();
        if (!title) continue;
        mapped.push({ title, location: deriveLocation(job), urlPath });
      }

      // SAME PM_KEYWORDS + US-location filter every other scraper runs through.
      // validateScrapeResults returns filteredJobs already narrowed to US PM roles.
      const validation = validateScrapeResults(mapped, company.name);
      // De-dup within THIS response by urlPath before the batch insert. The
      // LinkedIn feed can surface one listing under multiple derived cities (or
      // tracking-param variants that strip to the same origin+pathname); both
      // would collide on the (company_id, job_url_path) UNIQUE constraint and make
      // the single batched insert throw, failing the company's entire restore.
      const byPath = new Map<string, ScrapedJob>();
      for (const j of validation.filteredJobs) byPath.set(j.urlPath, j); // last wins
      const jobs = [...byPath.values()];
      console.log(`[rapidapi] ${company.name}: ${rawJobs.length} raw → ${mapped.length} mapped → ${validation.filteredJobs.length} US PM → ${jobs.length} after de-dup`);

      if (jobs.length === 0) {
        // No US PM roles right now (e.g. Wayfair). Leave scrape_blocked as-is so
        // the next run retries; do NOT touch seen_jobs.
        results.push(result);
        continue;
      }

      // --- INSERT-or-refresh ONLY. No removal. ---
      // Load existing seen_jobs for this company so we know what to insert vs
      // refresh. Paginate past the 1000-row cap (same pattern as dailyCheck).
      type ExistingJobRow = { id: string; job_url_path: string; status: string; job_title: string | null; job_location: string | null };
      const existingJobs = await fetchAllRows<ExistingJobRow>((from, to) =>
        supabase
          .from("seen_jobs")
          .select("id, job_url_path, status, job_title, job_location")
          .eq("company_id", company.id)
          .order("id", { ascending: true })
          .range(from, to)
      );
      const existingByPath = new Map<string, ExistingJobRow>();
      for (const j of existingJobs) existingByPath.set(j.job_url_path, j);

      // 1. Brand-new listings → INSERT active.
      const toInsert = jobs.filter((j) => !existingByPath.has(j.urlPath));
      if (toInsert.length > 0) {
        const { error: insertErr } = await supabase.from("seen_jobs").insert(
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
        if (insertErr) {
          throw new Error(`insert seen_jobs for ${company.name}: ${JSON.stringify(insertErr)}`);
        }
        result.jobsAdded = toInsert.length;
      }

      // 2. Listings already known but currently removed/archived → flip back to
      //    active and refresh title/location (re-posted). Listings already active
      //    just get their title/location refreshed if they changed. We never mark
      //    anything removed here.
      const toUpdate = jobs
        .map((j) => ({ scraped: j, existing: existingByPath.get(j.urlPath) }))
        .filter((p): p is { scraped: ScrapedJob; existing: ExistingJobRow } => {
          if (!p.existing) return false;
          const reactivate = p.existing.status !== "active";
          const changed = p.existing.job_title !== p.scraped.title || p.existing.job_location !== p.scraped.location;
          return reactivate || changed;
        });
      const nowIso = new Date().toISOString();
      const updateResults = await Promise.all(
        toUpdate.map((p) => {
          const patch: Record<string, unknown> = {
            job_title: p.scraped.title,
            job_location: p.scraped.location,
          };
          if (p.existing.status !== "active") {
            patch.status = "active";
            patch.status_changed_at = nowIso;
          }
          return supabase.from("seen_jobs").update(patch).eq("id", p.existing.id);
        })
      );
      for (const r of updateResults) {
        if (r.error) {
          console.error(`[rapidapi] ${company.name}: refresh/reactivate failed:`, r.error);
        }
      }

      // --- Restore the company: clear the block + repoint at this feed. ---
      const { error: restoreErr } = await supabase
        .from("companies")
        .update({
          scrape_blocked: false,
          platform_type: PLATFORM_TYPE,
          platform_config: { orgName: company.name },
        })
        .eq("id", company.id);
      if (restoreErr) {
        throw new Error(`clear scrape_blocked for ${company.name}: ${JSON.stringify(restoreErr)}`);
      }
      result.blockedClearedFor.push(company.name);
      console.log(`[rapidapi] ${company.name}: RESTORED — ${toInsert.length} new + ${toUpdate.length} refreshed; scrape_blocked cleared, repointed to ${PLATFORM_TYPE}`);
      Sentry.captureMessage(`RapidAPI restored blocked employer ${company.name} (${jobs.length} US PM jobs, ${toInsert.length} new)`, {
        level: "info",
        tags: { area: "rapidapi-blocked", phase: "restore", company: company.name },
      });

      results.push(result);
    } catch (err) {
      // Never let one company's failure break the rest — record and continue.
      // scrape_blocked is left UNCHANGED on failure (no DB mutation in the catch).
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[rapidapi] ${company.name}: failed —`, errMsg);
      Sentry.captureMessage(`RapidAPI blocked-employer pull failed for ${company.name}: ${errMsg}`, {
        level: "warning",
        tags: { area: "rapidapi-blocked", phase: "pull", company: company.name },
      });
      result.error = errMsg;
      results.push(result);
    }
  }

  return results;
}

/**
 * Date-gate helper: is the RapidAPI restore allowed to run today?
 * Returns true only when RAPIDAPI_KEY is set AND today's UTC date is >= the
 * activation date (RAPIDAPI_ACTIVATION_DATE env, default "2026-07-01" — when the
 * free RapidAPI monthly quota resets). Exported so the daily cron and any test
 * can share the exact same gate.
 */
export function isRapidApiActivationDue(now: Date = new Date()): boolean {
  if (!process.env.RAPIDAPI_KEY) return false;
  const activation = process.env.RAPIDAPI_ACTIVATION_DATE || "2026-07-01";
  // Compare YYYY-MM-DD lexicographically in UTC — both sides are ISO date
  // strings, so string comparison is correct and avoids timezone drift.
  const todayUtc = now.toISOString().slice(0, 10);
  return todayUtc >= activation;
}
