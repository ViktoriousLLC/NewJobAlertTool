import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import companiesRouter from "./routes/companies";
import favoritesRouter from "./routes/favorites";
import issuesRouter from "./routes/issues";
import compensationRouter from "./routes/compensation";
import { runDailyCheck } from "./jobs/dailyCheck";
import { requireAuth } from "./middleware/auth";
import { supabase } from "./lib/supabase";
import { scrapeCompanyCareers } from "./scraper/scraper";
import { detectPlatform } from "./scraper/detectPlatform";
import { validateScrapeResults } from "./scraper/validateScrape";
import { classifyJobLevel } from "./lib/classifyLevel";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  // Also allow www variant for Vercel domain redirect
  (process.env.FRONTEND_URL || "").replace("https://", "https://www."),
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
  })
);
app.use(express.json());

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Routes (protected by auth)
app.use("/api/companies", requireAuth, companiesRouter);
app.use("/api/favorites", requireAuth, favoritesRouter);
app.use("/api/issues", requireAuth, issuesRouter);
app.use("/api/compensation", requireAuth, compensationRouter);

// Manual trigger for daily check (protected by secret)
app.get("/api/cron/trigger", async (req, res) => {
  // Primary: read secret from Authorization header
  const authHeader = req.headers.authorization;
  const headerSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  // Fallback: query param (deprecated)
  const querySecret = req.query.secret as string | undefined;
  if (querySecret) {
    console.warn("DEPRECATED: cron secret via query param. Use Authorization: Bearer <secret> header instead.");
  }

  const secret = headerSecret || querySecret;
  if (secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Run in background so the request doesn't timeout
  runDailyCheck().catch((err) =>
    console.error("Manual daily check failed:", err)
  );

  res.json({ message: "Daily check triggered" });
});

// Admin: add company (protected by CRON_SECRET, for CLI/automation use)
app.post("/api/admin/add-company", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { name, careers_url } = req.body;
  if (!name || !careers_url) {
    res.status(400).json({ error: "name and careers_url are required" });
    return;
  }

  try {
    // Get first user (single-user app)
    const { data: users } = await supabase.auth.admin.listUsers();
    const userId = users?.users?.[0]?.id;
    if (!userId) {
      res.status(500).json({ error: "No users found" });
      return;
    }

    // Detect platform
    let platformType: string | null = null;
    let platformConfig: Record<string, string> = {};
    try {
      const detection = await detectPlatform(careers_url);
      platformType = detection.platformType;
      platformConfig = detection.platformConfig;
      console.log(`Admin add: ${name} → ${platformType} (${detection.confidence})`);
    } catch (err) {
      console.error("Platform detection failed:", err);
    }

    // Insert company
    const { data: company, error: insertErr } = await supabase
      .from("companies")
      .insert({
        name,
        careers_url,
        user_id: userId,
        platform_type: platformType,
        platform_config: platformConfig,
      })
      .select()
      .single();

    if (insertErr || !company) {
      throw insertErr || new Error("Failed to insert");
    }

    // Scrape in background (respond immediately so curl doesn't timeout)
    res.json({
      message: `Added ${name}. Scraping in background...`,
      company_id: company.id,
      platform_type: platformType,
    });

    // Scrape + validate + save
    try {
      const rawJobs = await scrapeCompanyCareers(careers_url, platformType, platformConfig);
      const validation = validateScrapeResults(rawJobs, name);
      const jobs = validation.filteredJobs;

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

      const status = validation.warnings.length > 0
        ? `success (quality: ${validation.qualityScore}/100)`
        : "success";

      await supabase.from("companies").update({
        last_checked_at: new Date().toISOString(),
        last_check_status: status,
        total_product_jobs: jobs.length,
      }).eq("id", company.id);

      console.log(`Admin add complete: ${name} — ${jobs.length} PM jobs (quality: ${validation.qualityScore})`);
    } catch (err) {
      console.error(`Admin add scrape failed for ${name}:`, err);
      await supabase.from("companies").update({
        last_checked_at: new Date().toISOString(),
        last_check_status: `error: ${err instanceof Error ? err.message : "unknown"}`,
      }).eq("id", company.id);
    }
  } catch (err) {
    console.error("Admin add-company error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to add company" });
    }
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
