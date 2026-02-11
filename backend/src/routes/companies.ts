import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";
import { scrapeCompanyCareers } from "../scraper/scraper";
import { detectPlatform } from "../scraper/detectPlatform";
import { validateScrapeResults } from "../scraper/validateScrape";
import { classifyJobLevel } from "../lib/classifyLevel";

const router = Router();

// GET /api/companies — list user's companies
router.get("/", async (req: Request, res: Response) => {
  try {
    const { data: companies, error } = await supabase
      .from("companies")
      .select("*")
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const companyIds = (companies || []).map((c) => c.id);

    // Single RPC call replaces 2 sequential queries for job stats
    const statsMap = new Map<string, { new_jobs_today: number; latest_new_job_at: string | null }>();

    if (companyIds.length > 0) {
      const { data: stats } = await supabase.rpc("get_company_job_stats", {
        company_ids: companyIds,
      });

      for (const row of stats || []) {
        statsMap.set(row.company_id, {
          new_jobs_today: Number(row.new_jobs_today) || 0,
          latest_new_job_at: row.latest_new_job_at,
        });
      }
    }

    const result = (companies || []).map((c) => ({
      ...c,
      new_jobs_today: statsMap.get(c.id)?.new_jobs_today || 0,
      latest_new_job_at: statsMap.get(c.id)?.latest_new_job_at || null,
    }));

    res.json(result);
  } catch (err) {
    console.error("GET /api/companies error:", err);
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

// GET /api/companies/:id — company detail with jobs (user-scoped)
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: company, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.userId!)
      .single();

    if (error || !company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    // Get all jobs, sorted newest first
    const { data: allJobs } = await supabase
      .from("seen_jobs")
      .select("*")
      .eq("company_id", id)
      .order("first_seen_at", { ascending: false });

    res.json({ ...company, jobs: allJobs || [] });
  } catch (err) {
    console.error("GET /api/companies/:id error:", err);
    res.status(500).json({ error: "Failed to fetch company" });
  }
});

// POST /api/companies — add a new company + initial scrape
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, careers_url } = req.body;

    if (!name || !careers_url) {
      res.status(400).json({ error: "name and careers_url are required" });
      return;
    }

    // Validate URL to prevent SSRF
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(careers_url);
    } catch {
      res.status(400).json({ error: "Invalid URL format" });
      return;
    }

    if (parsedUrl.protocol !== "https:") {
      res.status(400).json({ error: "Only HTTPS URLs are allowed" });
      return;
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
      res.status(400).json({ error: "URLs pointing to private/internal networks are not allowed" });
      return;
    }

    // Insert company with user_id
    const { data: company, error: insertError } = await supabase
      .from("companies")
      .insert({ name, careers_url, user_id: req.userId! })
      .select()
      .single();

    if (insertError || !company) {
      throw insertError || new Error("Failed to insert company");
    }

    // Detect ATS platform
    let platformType: string | null = null;
    let platformConfig: Record<string, string> = {};
    try {
      const detection = await detectPlatform(careers_url);
      platformType = detection.platformType;
      platformConfig = detection.platformConfig;
      console.log(`Platform detected for ${name}: ${platformType} (${detection.confidence})`);
    } catch (err) {
      console.error("Platform detection failed:", err);
    }

    // Run initial scrape (with detected platform info if available)
    let jobs: { title: string; location: string; urlPath: string }[] = [];
    let scrapeStatus = "success";
    let qualityWarnings: string[] = [];

    try {
      jobs = await scrapeCompanyCareers(careers_url, platformType, platformConfig);

      // Run quality validation
      const validation = validateScrapeResults(jobs, name);
      jobs = validation.filteredJobs; // Use filtered (PM-only) jobs
      qualityWarnings = validation.warnings;

      if (validation.warnings.length > 0) {
        console.log(`Quality warnings for ${name}:`, validation.warnings);
        scrapeStatus = `success (quality: ${validation.qualityScore}/100)`;
      }
    } catch (err) {
      scrapeStatus = `error: ${err instanceof Error ? err.message : "unknown"}`;
      console.error("Initial scrape failed:", err);
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

    // Save platform info if columns exist (graceful — won't fail if columns not yet added)
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
  } catch (err) {
    console.error("POST /api/companies error:", err);
    res.status(500).json({ error: "Failed to add company" });
  }
});

// DELETE /api/companies/:id — remove company and its jobs (user-scoped)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // seen_jobs will cascade delete due to FK constraint
    const { error } = await supabase
      .from("companies")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId!);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/companies/:id error:", err);
    res.status(500).json({ error: "Failed to delete company" });
  }
});

export default router;
