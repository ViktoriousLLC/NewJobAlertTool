import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { scrapeCompanyCareers } from "../scraper/scraper";
import { detectPlatform, broadATSDiscovery } from "../scraper/detectPlatform";
import { detectCompanyName } from "../scraper/detectCompanyName";
import { validateScrapeResults } from "../scraper/validateScrape";
import { classifyJobLevel } from "../lib/classifyLevel";
import { getCompData } from "../lib/levelsFyi";
import { ADMIN_EMAIL } from "../lib/constants";
import { extractKeywordsFromFeedback } from "../lib/extractKeywords";

const router = Router();

// Rate limiter for /check — admin bypasses
const checkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many check requests. Please try again after 15 minutes — and if you think this is a bug, use the help button (bottom-right) to let us know." },
});

function checkLimiterWithAdminBypass(req: Request, res: Response, next: NextFunction) {
  if (req.userEmail === ADMIN_EMAIL) return next();
  checkLimiter(req, res, next);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ATS hostnames where multiple companies share the same domain
const ATS_HOSTS = [
  "greenhouse.io", "boards.greenhouse.io",
  "lever.co", "jobs.lever.co",
  "ashbyhq.com", "jobs.ashbyhq.com",
  "myworkdayjobs.com",
  "eightfold.ai",
];

/**
 * Extract a dedup key from a careers URL.
 * For ATS-hosted URLs, returns "hostname/slug" (e.g. "greenhouse.io/discord").
 * For direct company domains, returns the hostname without "www." prefix.
 */
function extractDedupKey(url: string): string {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();

  // Check if this is an ATS-hosted URL
  for (const ats of ATS_HOSTS) {
    if (hostname === ats || hostname.endsWith(`.${ats}`)) {
      const slug = parsed.pathname.split("/").filter(Boolean)[0] || "";
      return slug ? `${ats}/${slug.toLowerCase()}` : hostname;
    }
  }

  return hostname;
}

/**
 * Validate a careers URL: HTTPS check, LinkedIn block, SSRF protection.
 * Returns parsedUrl on success, or an error message on failure.
 */
function validateCareersUrl(url: string): { valid: true; parsedUrl: URL } | { valid: false; error: string } {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (parsedUrl.protocol !== "https:") {
    return { valid: false, error: "Only HTTPS URLs are allowed" };
  }

  if (parsedUrl.hostname.includes("linkedin.com")) {
    return {
      valid: false,
      error: "LinkedIn blocks automated scraping, so we can't track jobs there. Please use the company's direct careers page instead.",
    };
  }

  const hostname = parsedUrl.hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === "[::1]" ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local")
  ) {
    return { valid: false, error: "URLs pointing to private/internal networks are not allowed" };
  }

  return { valid: true, parsedUrl };
}

/**
 * Check for an existing company by dedup key.
 * Returns the matching company or null.
 */
async function findExistingCompany(careersUrl: string): Promise<{ id: string; name: string; total_product_jobs: number } | null> {
  const newDedupKey = extractDedupKey(careersUrl);
  const { data: allCompanies } = await supabase
    .from("companies")
    .select("id, name, careers_url, total_product_jobs");

  if (!allCompanies) return null;

  const match = allCompanies.find((c) => {
    try {
      return extractDedupKey(c.careers_url) === newDedupKey;
    } catch {
      return false;
    }
  });

  return match ? { id: match.id, name: match.name, total_product_jobs: match.total_product_jobs ?? 0 } : null;
}

// GET /api/companies — list user's subscribed companies
router.get("/", async (req: Request, res: Response) => {
  try {
    // Get user's subscribed company IDs
    const { data: subs, error: subError } = await supabase
      .from("user_subscriptions")
      .select("company_id")
      .eq("user_id", req.userId!);

    if (subError) throw subError;

    const subscribedIds = (subs || []).map((s) => s.company_id);
    if (subscribedIds.length === 0) {
      res.json([]);
      return;
    }

    const { data: companies, error } = await supabase
      .from("companies")
      .select("*")
      .in("id", subscribedIds)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const companyIds = (companies || []).map((c) => c.id);

    // Compute new-jobs-today and latest non-baseline job per company
    const statsMap = new Map<string, { new_jobs_today: number; latest_new_job_at: string | null }>();

    if (companyIds.length > 0) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayISO = todayStart.toISOString();

      // Two parallel queries: today's new jobs (DB-filtered) + latest non-baseline per company
      const [todayResult, latestResult] = await Promise.all([
        supabase
          .from("seen_jobs")
          .select("company_id")
          .in("company_id", companyIds)
          .eq("is_baseline", false)
          .gte("first_seen_at", todayISO),
        supabase
          .from("seen_jobs")
          .select("company_id, first_seen_at")
          .in("company_id", companyIds)
          .eq("is_baseline", false)
          .order("first_seen_at", { ascending: false }),
      ]);

      if (todayResult.error) console.error("Today jobs query failed:", todayResult.error);
      if (latestResult.error) console.error("Latest jobs query failed:", latestResult.error);

      // Count today's new jobs per company
      for (const job of todayResult.data || []) {
        const existing = statsMap.get(job.company_id) || { new_jobs_today: 0, latest_new_job_at: null };
        existing.new_jobs_today++;
        statsMap.set(job.company_id, existing);
      }

      // Set latest non-baseline job per company (ordered DESC, first per company wins)
      for (const job of latestResult.data || []) {
        const existing = statsMap.get(job.company_id);
        if (existing && !existing.latest_new_job_at) {
          existing.latest_new_job_at = job.first_seen_at;
        } else if (!existing) {
          statsMap.set(job.company_id, { new_jobs_today: 0, latest_new_job_at: job.first_seen_at });
        }
      }
    }

    const result = (companies || []).map((c) => ({
      ...c,
      new_jobs_today: statsMap.get(c.id)?.new_jobs_today || 0,
      latest_new_job_at: statsMap.get(c.id)?.latest_new_job_at || null,
    }));

    res.json(result);
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/companies error:", err);
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

// GET /api/companies/:id — company detail with jobs + next company (subscription-based nav)
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!UUID_REGEX.test(id)) {
      res.status(400).json({ error: "Invalid company ID format" });
      return;
    }

    // Get user's subscribed company IDs for next-company nav
    const { data: subs } = await supabase
      .from("user_subscriptions")
      .select("company_id")
      .eq("user_id", req.userId!);

    const subscribedIds = (subs || []).map((s) => s.company_id);

    // Parallel: fetch company (shared, no user filter), its jobs, and sibling companies
    const [companyResult, jobsResult, siblingsResult] = await Promise.all([
      supabase
        .from("companies")
        .select("*")
        .eq("id", id)
        .single(),
      supabase
        .from("seen_jobs")
        .select("id, job_title, job_location, job_url_path, first_seen_at, is_baseline, job_level, status")
        .eq("company_id", id)
        .order("first_seen_at", { ascending: false }),
      subscribedIds.length > 0
        ? supabase
            .from("companies")
            .select("id, name")
            .in("id", subscribedIds)
            .order("name", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (companyResult.error || !companyResult.data) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    // Compute next company alphabetically
    let next_company: { id: string; name: string } | null = null;
    const siblings = siblingsResult.data || [];
    if (siblings.length > 1) {
      const idx = siblings.findIndex((c) => c.id === id);
      if (idx !== -1) {
        next_company = siblings[(idx + 1) % siblings.length];
      }
    }

    res.json({
      ...companyResult.data,
      jobs: jobsResult.data || [],
      next_company,
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/companies/:id error:", err);
    res.status(500).json({ error: "Failed to fetch company" });
  }
});

// POST /api/companies/check — preview scrape results without saving
router.post("/check", checkLimiterWithAdminBypass, async (req: Request, res: Response) => {
  try {
    const { careers_url, feedback } = req.body;
    if (!careers_url) {
      res.status(400).json({ error: "careers_url is required" });
      return;
    }

    // Parse natural-language feedback into job-title keywords
    const extraKeywords = typeof feedback === "string"
      ? extractKeywordsFromFeedback(feedback)
      : undefined;
    if (extraKeywords?.length) {
      console.log(`Check: custom keywords from feedback: ${JSON.stringify(extraKeywords)}`);
    }

    // Validate URL
    const urlCheck = validateCareersUrl(careers_url);
    if (!urlCheck.valid) {
      res.status(400).json({ error: urlCheck.error });
      return;
    }

    // Dedup check — if match found, return existing company info
    const existing = await findExistingCompany(careers_url);
    if (existing) {
      res.json({
        status: "exists",
        existing_company: existing,
      });
      return;
    }

    // Detect ATS platform
    let platformType: string | null = null;
    let platformConfig: Record<string, string> = {};
    try {
      const detection = await detectPlatform(careers_url);
      platformType = detection.platformType;
      platformConfig = detection.platformConfig;
    } catch (err) {
      console.error("Platform detection failed during check:", err);
    }

    // Auto-detect company name
    const companyName = detectCompanyName(careers_url, platformType, platformConfig);

    // Run the scrape (does NOT save to DB)
    let rawJobs: { title: string; location: string; urlPath: string }[] = [];
    try {
      rawJobs = await scrapeCompanyCareers(careers_url, platformType, platformConfig);
    } catch (err) {
      console.error("Scrape failed during check:", err);
      res.json({
        status: "error",
        company_name: companyName,
        error: `Scrape failed: ${err instanceof Error ? err.message : "unknown error"}`,
      });
      return;
    }

    // If scraper returned 0 jobs and detection was generic/low-confidence,
    // try broad ATS discovery before giving up
    if (rawJobs.length === 0) {
      if (platformType === "generic" || !platformType) {
        console.log(`Check: 0 jobs with generic detection, trying broad ATS discovery for ${companyName}`);
        try {
          const discovery = await broadATSDiscovery(careers_url, companyName);
          if (discovery) {
            console.log(`Check: Broad discovery found ${discovery.platformType} (${JSON.stringify(discovery.platformConfig)})`);
            platformType = discovery.platformType;
            platformConfig = discovery.platformConfig;

            // Re-scrape with the discovered platform
            try {
              rawJobs = await scrapeCompanyCareers(careers_url, platformType, platformConfig);
              console.log(`Check: Re-scrape found ${rawJobs.length} raw jobs`);
            } catch (err) {
              console.error("Re-scrape after broad discovery failed:", err);
            }
          }
        } catch (err) {
          console.error("Broad ATS discovery failed:", err);
        }
      }

      // If still 0 jobs after fallback, return error
      if (rawJobs.length === 0) {
        res.json({
          status: "error",
          company_name: companyName,
          error: "No job listings found on this page. The URL might be wrong, or the page format isn't supported yet. You can report this using the help button (bottom-right) so we can add support.",
        });
        return;
      }
    }

    // Validate + filter PM roles (include custom keywords if provided)
    const validation = validateScrapeResults(rawJobs, companyName, extraKeywords);
    const filteredJobs = validation.filteredJobs;

    // Build sample jobs (up to 5)
    const sampleJobs = filteredJobs.slice(0, 5).map((j) => ({
      title: j.title,
      location: j.location,
    }));

    res.json({
      status: "preview",
      company_name: companyName,
      platform_type: platformType,
      platform_config: platformConfig,
      job_count: filteredJobs.length,
      total_jobs_found: rawJobs.length,
      sample_jobs: sampleJobs,
      quality_score: validation.qualityScore,
      warnings: validation.warnings,
      jobs: filteredJobs,
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/companies/check error:", err);
    res.status(500).json({ error: "Failed to check company" });
  }
});

// POST /api/companies — add a new company + initial scrape
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, careers_url, jobs: preCheckedJobs, platform_type: preCheckedPlatformType, platform_config: preCheckedPlatformConfig } = req.body;

    if (!name || !careers_url) {
      res.status(400).json({ error: "name and careers_url are required" });
      return;
    }

    // Validate URL
    const urlCheck = validateCareersUrl(careers_url);
    if (!urlCheck.valid) {
      res.status(400).json({ error: urlCheck.error });
      return;
    }

    // Dedup check
    const existing = await findExistingCompany(careers_url);
    if (existing) {
      res.status(409).json({
        error: `A company with this domain already exists: "${existing.name}". You can subscribe to it from the catalog instead.`,
        existing_company: { id: existing.id, name: existing.name },
      });
      return;
    }

    // Check submission limit (10 per user, admin bypass)
    const isAdmin = req.userEmail === ADMIN_EMAIL;

    if (!isAdmin) {
      const { count: submissionCount } = await supabase
        .from("user_new_company_submissions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", req.userId!);

      if ((submissionCount ?? 0) >= 10) {
        res.status(429).json({
          error: "You've reached the limit of 10 company submissions. Contact support for more.",
        });
        return;
      }
    }

    // Determine if we have pre-checked data from POST /check
    const hasPreCheckedData = Array.isArray(preCheckedJobs) && preCheckedJobs.length >= 0;

    // Validate pre-checked jobs structure if provided
    if (hasPreCheckedData && preCheckedJobs.length > 0) {
      const valid = preCheckedJobs.every(
        (j: unknown) =>
          typeof j === "object" && j !== null &&
          typeof (j as Record<string, unknown>).title === "string" &&
          typeof (j as Record<string, unknown>).location === "string" &&
          typeof (j as Record<string, unknown>).urlPath === "string"
      );
      if (!valid) {
        res.status(400).json({ error: "Invalid jobs data structure" });
        return;
      }
    }

    // Use pre-checked platform info or detect fresh
    let platformType: string | null = hasPreCheckedData ? (preCheckedPlatformType || null) : null;
    let platformConfig: Record<string, string> = hasPreCheckedData ? (preCheckedPlatformConfig || {}) : {};

    // Insert company
    const { data: company, error: insertError } = await supabase
      .from("companies")
      .insert({ name, careers_url, is_active: true, subscriber_count: 1 })
      .select()
      .single();

    if (insertError || !company) {
      throw insertError || new Error("Failed to insert company");
    }

    // Auto-subscribe the creating user + record submission
    await Promise.all([
      supabase.from("user_subscriptions").upsert(
        { user_id: req.userId!, company_id: company.id },
        { onConflict: "user_id,company_id" }
      ),
      supabase.from("user_new_company_submissions").insert({
        user_id: req.userId!,
        company_id: company.id,
      }),
    ]);

    let jobs: { title: string; location: string; urlPath: string }[] = [];
    let scrapeStatus = "success";

    if (hasPreCheckedData) {
      // Use pre-checked data — skip detection + scrape + validation
      jobs = preCheckedJobs as { title: string; location: string; urlPath: string }[];
    } else {
      // Legacy flow: detect + scrape + validate
      try {
        const detection = await detectPlatform(careers_url);
        platformType = detection.platformType;
        platformConfig = detection.platformConfig;
        console.log(`Platform detected for ${name}: ${platformType} (${detection.confidence})`);
      } catch (err) {
        console.error("Platform detection failed:", err);
      }

      try {
        const rawJobs = await scrapeCompanyCareers(careers_url, platformType, platformConfig);
        const validation = validateScrapeResults(rawJobs, name);
        jobs = validation.filteredJobs;

        if (validation.warnings.length > 0) {
          console.log(`Quality warnings for ${name}:`, validation.warnings);
          scrapeStatus = `success (quality: ${validation.qualityScore}/100)`;
        }
      } catch (err) {
        scrapeStatus = `error: ${err instanceof Error ? err.message : "unknown"}`;
        console.error("Initial scrape failed:", err);
      }
    }

    // Insert all found jobs as baseline
    if (jobs.length > 0) {
      await supabase.from("seen_jobs").insert(
        jobs.map((j) => ({
          company_id: company.id,
          job_url_path: j.urlPath,
          job_title: j.title,
          job_location: j.location,
          is_baseline: true,
          job_level: classifyJobLevel(j.title),
        }))
      );
    }

    // Update company with scrape results + platform info
    const updateData: Record<string, unknown> = {
      last_checked_at: new Date().toISOString(),
      last_check_status: scrapeStatus,
      total_product_jobs: jobs.length,
    };

    if (platformType) {
      updateData.platform_type = platformType;
      updateData.platform_config = platformConfig;
    }

    await supabase
      .from("companies")
      .update(updateData)
      .eq("id", company.id);

    res.json({
      ...company,
      last_checked_at: new Date().toISOString(),
      last_check_status: scrapeStatus,
      total_product_jobs: jobs.length,
      platform_type: platformType,
    });

    // Preload compensation data in background
    getCompData(name).catch((err) =>
      console.error(`Comp preload failed for ${name}:`, err)
    );
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/companies error:", err);
    res.status(500).json({ error: "Failed to add company" });
  }
});

// DELETE /api/companies/:id — unsubscribe (or admin-only true delete with ?hard=true)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!UUID_REGEX.test(id)) {
      res.status(400).json({ error: "Invalid company ID format" });
      return;
    }
    const isAdmin = req.userEmail === ADMIN_EMAIL;
    const hardDelete = req.query.hard === "true" && isAdmin;

    if (hardDelete) {
      // Admin hard delete: actually remove the company (cascades to jobs)
      const { error } = await supabase
        .from("companies")
        .delete()
        .eq("id", id);

      if (error) throw error;
      res.json({ success: true, action: "deleted" });
      return;
    }

    // Normal user: unsubscribe
    const { error: deleteError } = await supabase
      .from("user_subscriptions")
      .delete()
      .eq("user_id", req.userId!)
      .eq("company_id", id);

    if (deleteError) throw deleteError;

    // Update subscriber count
    const { count } = await supabase
      .from("user_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", id);

    const newCount = count ?? 0;

    await supabase
      .from("companies")
      .update({
        subscriber_count: newCount,
        is_active: newCount > 0,
      })
      .eq("id", id);

    res.json({ success: true, action: "unsubscribed", subscriber_count: newCount });
  } catch (err) {
    Sentry.captureException(err);
    console.error("DELETE /api/companies/:id error:", err);
    res.status(500).json({ error: "Failed to remove company" });
  }
});

export default router;
