import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import companiesRouter from "./routes/companies";
import favoritesRouter from "./routes/favorites";
import issuesRouter from "./routes/issues";
import compensationRouter from "./routes/compensation";
import jobsRouter from "./routes/jobs";
import subscriptionsRouter from "./routes/subscriptions";
import catalogRouter from "./routes/catalog";
import preferencesRouter from "./routes/preferences";
import adminRouter from "./routes/admin";
import { runDailyCheck } from "./jobs/dailyCheck";
import { requireAuth } from "./middleware/auth";
import { supabase } from "./lib/supabase";
import { scrapeCompanyCareers } from "./scraper/scraper";
import { detectPlatform } from "./scraper/detectPlatform";
import { validateScrapeResults } from "./scraper/validateScrape";
import { classifyJobLevel } from "./lib/classifyLevel";
import { ADMIN_EMAIL } from "./lib/constants";


dotenv.config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV || "production",
});

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

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again after 15 minutes — and if you think this is a bug, use the help button (bottom-right) to let us know." },
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again after 15 minutes — and if you think this is a bug, use the help button (bottom-right) to let us know." },
});

app.use("/api/", generalLimiter);
app.post("/api/companies", strictLimiter);
app.post("/api/help", strictLimiter);

// Routes (protected by auth)
app.use("/api/companies", requireAuth, companiesRouter);
app.use("/api/favorites", requireAuth, favoritesRouter);
app.use("/api/issues", requireAuth, issuesRouter);
app.use("/api/compensation", requireAuth, compensationRouter);
app.use("/api/jobs", requireAuth, jobsRouter);
app.use("/api/subscriptions", requireAuth, subscriptionsRouter);
app.use("/api/catalog", requireAuth, catalogRouter);
app.use("/api/preferences", requireAuth, preferencesRouter);
app.use("/api/admin", requireAuth, adminRouter);

// HTML-escape user input to prevent XSS in emails
function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Help/feedback endpoint (sends email to admin + stores in DB)
app.post("/api/help", requireAuth, async (req, res) => {
  try {
    const { issue_type, message, page_url } = req.body;
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }
    if (message.length > 5000) {
      res.status(400).json({ error: "Message too long (max 5000 characters)" });
      return;
    }
    const validHelpTypes = ["bug", "missing_data", "other"];
    const safeType = validHelpTypes.includes(issue_type) ? issue_type : "other";

    // Store in DB for admin dashboard visibility
    const { error: dbError } = await supabase.from("help_submissions").insert({
      user_id: req.userId!,
      user_email: req.userEmail || null,
      issue_type: safeType,
      message: message.slice(0, 5000),
      page_url: typeof page_url === "string" ? page_url.slice(0, 2000) : null,
    });
    if (dbError) console.error("Failed to store help submission:", dbError);

    // Send email to admin via Resend
    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "NewPMJobs <alerts@newpmjobs.com>",
        to: ADMIN_EMAIL,
        subject: `[NewPMJobs Feedback] ${safeType}`,
        html: `<p><strong>From:</strong> ${escapeHtml(req.userEmail || req.userId || "unknown")}</p>
               <p><strong>Type:</strong> ${escapeHtml(safeType)}</p>
               <p><strong>Page:</strong> ${escapeHtml(typeof page_url === "string" ? page_url : "unknown")}</p>
               <p><strong>Message:</strong></p>
               <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`,
      });
    }

    res.json({ success: true });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/help error:", err);
    res.status(500).json({ error: "Failed to send feedback" });
  }
});

// Manual trigger for daily check (protected by secret)
app.get("/api/cron/trigger", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!secret || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const skipEmails = req.query.skipEmails === "true";
    await runDailyCheck({ skipEmails });
    res.json({ message: "Daily check completed", skipEmails });
  } catch (err) {
    Sentry.captureException(err);
    console.error("Daily check failed:", err);
    res.status(500).json({ error: "Daily check failed" });
  }
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
    // Find admin user by email
    const { data: users } = await supabase.auth.admin.listUsers();
    const adminUser = users?.users?.find((u) => u.email === ADMIN_EMAIL);
    const adminUserId = adminUser?.id;

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

    // Insert company into shared catalog
    const { data: company, error: insertErr } = await supabase
      .from("companies")
      .insert({
        name,
        careers_url,
        user_id: adminUserId || null,
        platform_type: platformType,
        platform_config: platformConfig,
        is_active: true,
        subscriber_count: adminUserId ? 1 : 0,
      })
      .select()
      .single();

    if (insertErr || !company) {
      throw insertErr || new Error("Failed to insert");
    }

    // Auto-subscribe admin user if found
    if (adminUserId) {
      await supabase.from("user_subscriptions").upsert(
        { user_id: adminUserId, company_id: company.id },
        { onConflict: "user_id,company_id" }
      );
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
    Sentry.captureException(err);
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


Sentry.setupExpressErrorHandler(app);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
