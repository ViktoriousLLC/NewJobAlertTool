import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { timingSafeEqual } from "crypto";
import companiesRouter from "./routes/companies";
import favoritesRouter from "./routes/favorites";
import issuesRouter from "./routes/issues";
import compensationRouter from "./routes/compensation";
import jobsRouter from "./routes/jobs";
import subscriptionsRouter from "./routes/subscriptions";
import catalogRouter from "./routes/catalog";
import feedRouter from "./routes/feed";
import preferencesRouter from "./routes/preferences";
import adminRouter from "./routes/admin";
import interviewsRouter, { interviewsDiagnosticsHandler } from "./routes/interviews";
import { resendWebhookHandler } from "./routes/resendWebhook";
import { runDailyCheck, scrapeAndRecordCompany, createScrapeContext, PerCompanyScrapeResult, currentRun, recordRunInterrupted, sendEmailOnlyFromToday } from "./jobs/dailyCheck";
import { requireAuth } from "./middleware/auth";
import { supabase } from "./lib/supabase";
import { fetchAllRows } from "./lib/fetchAllRows";
import { scrapeCompanyCareers } from "./scraper/scraper";
import { detectPlatform } from "./scraper/detectPlatform";
import { validateScrapeResults } from "./scraper/validateScrape";
import { classifyJobLevel } from "./lib/classifyLevel";
import { ADMIN_EMAIL } from "./lib/constants";
import { createUserFeedbackIssue, type TypeLabel } from "./lib/linear";
import { renderFeedbackEmail } from "./lib/feedbackEmail";


dotenv.config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV || "production",
});

// DEV-27: Sentry.init() no-ops SILENTLY on a missing/malformed/wrong-project
// DSN, so a dead error pipeline looks identical to a healthy one (this is how
// backend reporting sat blind Feb-May 2026). Actively verify ingestion at boot
// by pushing a real event through and checking it's accepted. Fire-and-forget;
// never blocks startup. The daily cron re-runs this and emails on failure.
//
// DEV-47: gate on RAILWAY_ENVIRONMENT_NAME (auto-injected by Railway on every
// service) instead of NODE_ENV. NODE_ENV was unset on Railway for months, which
// silently turned this probe into dead code — the exact failure class this probe
// exists to catch. A manually-set var that can be cleared can't guard the thing
// that detects silent breakage; the platform-injected var can't be cleared.
const isProdRuntime = process.env.RAILWAY_ENVIRONMENT_NAME === "production";
// Log the resolved guard value at boot so a future env rename that silently
// disables the prod-only guards (Sentry probes, auth fail-closed, JWKS probe)
// is visible in deploy logs immediately — the exact silent-failure class DEV-47
// exists to prevent.
console.log(`[boot] RAILWAY_ENVIRONMENT_NAME=${process.env.RAILWAY_ENVIRONMENT_NAME ?? "(unset)"} → prod-only guards ${isProdRuntime ? "ACTIVE" : "INACTIVE"}`);
if (isProdRuntime) {
  import("./lib/sentryHealth")
    .then(({ reportSentryHealth }) => reportSentryHealth("boot"))
    .catch((err) => console.error("[observability] Sentry boot probe crashed:", err));
}

const app = express();
const PORT = process.env.PORT || 4000;

// Railway sits behind a reverse proxy that sets X-Forwarded-For. Trust 1 hop
// so express-rate-limit can identify clients accurately. Without this:
//   ValidationError: ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on startup.
app.set("trust proxy", 1);

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
// Resend email-engagement webhook (DEV-65). MUST be registered BEFORE the
// global express.json() below: Svix signature verification runs over the EXACT
// raw bytes Resend signed, and express.json() would consume + re-shape the body
// so the HMAC would never match. express.raw() leaves req.body as a Buffer for
// this one path only; every other route still gets parsed JSON. Mounted before
// the generalLimiter too, so a legitimate burst of webhook deliveries isn't
// 429'd — the route is signature-gated, not auth-gated. NO JWT (server-to-server).
app.post(
  "/api/webhooks/resend",
  express.raw({ type: "application/json", limit: "1mb" }),
  resendWebhookHandler,
);

// 100kb cap on JSON bodies. The check-then-add path can send a preCheckedJobs
// array which is the largest legitimate payload; bumped to 256kb to cover
// companies with many jobs. Per-route input length caps still apply.
app.use(express.json({ limit: "256kb" }));

// Constant-time comparison of a request-supplied secret against an env var.
// Use this for any shared-secret bearer token (cron, future Stripe/Twilio
// webhooks). Plain === leaks the secret byte-by-byte over time.
function safeCompareSecret(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
  message: { error: "Too many requests. Please try again after 15 minutes. If you think this is a bug, use the help button (bottom-right) to let us know." },
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again after 15 minutes. If you think this is a bug, use the help button (bottom-right) to let us know." },
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
// Public feed — drives the job-first landing page. NO requireAuth.
// Read-only catalog data; the Track action goes through auth-protected
// /api/subscriptions instead.
app.use("/api/feed", feedRouter);
app.use("/api/preferences", requireAuth, preferencesRouter);
app.use("/api/admin", requireAuth, adminRouter);
// Mount /api/interviews/diagnostics BEFORE the auth chain so env-var
// presence can be verified externally without admin auth.
app.get("/api/interviews/diagnostics", interviewsDiagnosticsHandler);
app.use("/api/interviews", requireAuth, interviewsRouter);

// Help/feedback endpoint. Creates a Linear issue in the User Feedback team
// (status=Inbox) and emails ADMIN_EMAIL. Linear is the source of truth for
// new feedback; legacy help_submissions / scrape_issues rows are preserved
// in Supabase as historical backup but no new rows are written there.
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
    const validHelpTypes = ["bug", "feature_request", "missing_data", "other"];
    const safeType = validHelpTypes.includes(issue_type) ? issue_type : "other";

    const helpTypeToLinearLabel: Record<string, TypeLabel | undefined> = {
      "bug": "bug-report",
      "feature_request": "feature-request",
      "missing_data": "scraper-issue",
      "other": undefined,
    };
    const typeLabel = helpTypeToLinearLabel[safeType];

    const submitterIdent = req.userEmail || req.userId || "unknown";
    const safePageUrl = typeof page_url === "string" ? page_url.slice(0, 2000) : null;
    const trimmedMessage = message.slice(0, 5000);
    const titleSnippet = trimmedMessage.split("\n")[0].slice(0, 80).trim();

    const issueDescription = `**From:** ${submitterIdent}
**Submitted:** ${new Date().toISOString()} via \`POST /api/help\`
**Page:** ${safePageUrl || "unknown"}
**Original issue_type:** ${safeType}

---

${trimmedMessage}`;

    let linearIssueUrl: string | null = null;
    let linearIssueIdent: string | null = null;
    try {
      const issue = await createUserFeedbackIssue({
        title: `[${safeType}] ${titleSnippet || "(empty)"}`,
        description: issueDescription,
        typeLabel,
        sourceLabel: "in-app",
      });
      linearIssueUrl = issue?.url ?? null;
      linearIssueIdent = issue?.identifier ?? null;
    } catch (linearErr) {
      // Don't block the user-facing flow on a Linear outage — log and continue
      // so the email path still delivers the feedback to admin.
      Sentry.captureException(linearErr);
      console.error("[/api/help] Linear createUserFeedbackIssue failed:", linearErr);
    }

    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "NewPMJobs <alerts@newpmjobs.com>",
        to: ADMIN_EMAIL,
        subject: `[NewPMJobs Feedback] ${safeType}: ${titleSnippet || "(empty)"}`.slice(0, 120),
        html: renderFeedbackEmail({
          category: "User Feedback",
          headline: `[${safeType}] ${titleSnippet || "(empty)"}`,
          metadata: [
            { label: "From", value: submitterIdent },
            { label: "Type", value: safeType },
            { label: "Page", value: safePageUrl || "unknown" },
          ],
          linearUrl: linearIssueUrl,
          linearIdentifier: linearIssueIdent,
          message: trimmedMessage,
          adminEmail: ADMIN_EMAIL,
        }),
      });
    }

    res.json({ success: true });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/help error:", err);
    res.status(500).json({ error: "Failed to send feedback" });
  }
});

// Weekly digest cron endpoint (Friday 14:15 UTC, set in Railway).
// Same CRON_SECRET pattern as /api/cron/trigger. Idempotent — safe to fire
// manually for test sends. Always sends (no Friday gate in code) so Railway
// schedule owns the cadence.
app.get("/api/cron/weekly-digest", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!safeCompareSecret(secret, process.env.CRON_SECRET)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { sendWeeklyDigest } = await import("./jobs/weeklyDigest");
    const result = await sendWeeklyDigest();
    res.json({ message: "Weekly digest complete", ...result });
  } catch (err) {
    Sentry.captureException(err);
    console.error("Weekly digest failed:", err);
    res.status(500).json({ error: "Weekly digest failed" });
  }
});

// Manual trigger for daily check (protected by secret)
app.get("/api/cron/trigger", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!safeCompareSecret(secret, process.env.CRON_SECRET)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const skipEmails = req.query.skipEmails === "true";
    const forceMondayDigest = req.query.forceMondayDigest === "true";
    const forceWeeklyDigest = req.query.forceWeeklyDigest === "true";
    await runDailyCheck({ skipEmails, forceMondayDigest, forceWeeklyDigest });
    res.json({ message: "Daily check completed", skipEmails, forceMondayDigest, forceWeeklyDigest });
  } catch (err) {
    Sentry.captureException(err);
    console.error("Daily check failed:", err);
    res.status(500).json({ error: "Daily check failed" });
  }
});

// Scrape-on-demand (DEV-52). Scrapes companies and reconciles seen_jobs WITHOUT
// running ANY email-distribution step — the daily 14:00 UTC cron couples
// scraping with the per-user email + admin digest, so adding a company means
// waiting for the daily run to surface its jobs. This decouples the two: it
// reuses the EXACT per-company scrape + seen_jobs upsert logic the daily cron
// runs (scrapeAndRecordCompany), but never calls sendPerUserAlerts /
// sendConsolidatedAdminDigest / sendWeeklyDigest. CRON_SECRET-gated, same
// constant-time pattern as /api/cron/trigger.
//
// Body: { companyIds?: string[] }
//   - companyIds present → scrape exactly those companies (validated as UUIDs).
//   - omitted           → scrape is_active companies that currently have ZERO
//                          seen_jobs rows (i.e. freshly added, never scraped).
// Idempotent: re-running just re-reconciles seen_jobs (insert-new / flip-returned
// / refresh / mark-removed) and re-stamps last_check_status. No duplicate rows
// (company_id+job_url_path is UNIQUE) and no emails, ever.
// Returns: { scraped, jobsAdded, perCompany: [{ id, name, status, jobsAdded, totalActive, error? }] }
app.post("/api/cron/scrape-only", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!safeCompareSecret(secret, process.env.CRON_SECRET)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawIds = req.body?.companyIds;
  if (rawIds !== undefined) {
    if (!Array.isArray(rawIds)) {
      res.status(400).json({ error: "companyIds must be an array of UUID strings" });
      return;
    }
    if (rawIds.length > 250) {
      res.status(400).json({ error: "companyIds too long (max 250)" });
      return;
    }
    if (!rawIds.every((id) => typeof id === "string" && UUID_REGEX.test(id))) {
      res.status(400).json({ error: "companyIds must all be valid UUIDs" });
      return;
    }
  }
  const companyIds: string[] | undefined = rawIds;

  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let companies: any[];

    if (companyIds && companyIds.length > 0) {
      // Targeted: scrape exactly the requested companies (de-duped). Chunk the
      // .in() filter so a large id list can't blow past PostgREST limits.
      const uniqueIds = Array.from(new Set(companyIds));
      companies = [];
      const CHUNK = 100;
      for (let i = 0; i < uniqueIds.length; i += CHUNK) {
        const slice = uniqueIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("companies")
          .select("*")
          .in("id", slice);
        if (error) throw error;
        if (data) companies.push(...data);
      }
    } else {
      // Default: is_active companies that currently have ZERO seen_jobs rows —
      // i.e. freshly added companies that have never been scraped. Pull all
      // active companies (paginate past the 1000-row cap) and the set of
      // company_ids that already have seen_jobs, then keep the difference.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activeCompanies = await fetchAllRows<any>((from, to) =>
        supabase
          .from("companies")
          .select("*")
          .eq("is_active", true)
          .order("id", { ascending: true })
          .range(from, to)
      );

      // Collect the distinct company_ids that already have at least one seen_jobs
      // row. seen_jobs can far exceed 1000 rows, so paginate; we only need the id.
      const seenCompanyIds = new Set<string>();
      const seenRows = await fetchAllRows<{ company_id: string }>((from, to) =>
        supabase
          .from("seen_jobs")
          .select("company_id")
          .order("company_id", { ascending: true })
          .range(from, to)
      );
      for (const r of seenRows) seenCompanyIds.add(r.company_id);

      companies = activeCompanies.filter((c) => !seenCompanyIds.has(c.id));
    }

    console.log(`[scrape-only] Scraping ${companies.length} company(ies)${companyIds ? " (targeted)" : " (freshly-added, zero seen_jobs)"} — NO email`);

    // Force isProbeDay=true so an auto-disabled target is still actually scraped
    // (the daily loop would skip it on a non-Monday). For freshly-added companies
    // this is a no-op; for a manual re-scrape of a broken company it's what the
    // caller wants — a real attempt now, not "wait for Monday."
    const ctx = createScrapeContext(true);
    const perCompany: PerCompanyScrapeResult[] = [];

    for (let i = 0; i < companies.length; i++) {
      const result = await scrapeAndRecordCompany(companies[i], ctx);
      perCompany.push(result);
      // Same inter-company spacing the daily loop uses, to be gentle on sources.
      if (i < companies.length - 1) await delay(5000);
    }

    const jobsAdded = perCompany.reduce((sum, r) => sum + r.jobsAdded, 0);
    res.json({
      scraped: perCompany.length,
      jobsAdded,
      perCompany,
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("Scrape-only failed:", err);
    res.status(500).json({ error: "Scrape-only failed" });
  }
});

// RapidAPI blocked-employer restore (DEV-51). On-demand trigger for the same
// pull the daily cron runs automatically on/after RAPIDAPI_ACTIVATION_DATE —
// pulls the still-blocked employers (Meta/Tesla/TikTok/Wayfair) from the
// Fantastic.jobs LinkedIn feed and restores any that yield >=1 US PM job. Exists
// so the restore can be exercised manually once the monthly RapidAPI quota
// resets, without waiting for the next 14:00 UTC daily run. Unlike the daily
// auto-trigger this is NOT date-gated (a deliberate manual override for
// testing) but still no-ops cleanly when RAPIDAPI_KEY is unset or there are no
// scrape_blocked companies. Idempotent + non-destructive (insert-or-refresh
// only; never marks jobs removed; leaves scrape_blocked unchanged on failure).
// CRON_SECRET-gated, same constant-time pattern as /api/cron/trigger. No email.
// Returns the per-company summary.
app.post("/api/cron/rapidapi-blocked", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!safeCompareSecret(secret, process.env.CRON_SECRET)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { pullRapidApiBlockedEmployers } = await import("./scraper/rapidApiBlocked");
    const results = await pullRapidApiBlockedEmployers();
    const restored = results.filter((r) => r.blockedClearedFor.length > 0).map((r) => r.company);
    const jobsAdded = results.reduce((sum, r) => sum + r.jobsAdded, 0);
    res.json({
      checked: results.length,
      restored,
      jobsAdded,
      perCompany: results,
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("RapidAPI blocked-employer restore failed:", err);
    res.status(500).json({ error: "RapidAPI blocked-employer restore failed" });
  }
});

// Out-of-band cron-completion probe (DEV-57). Reports whether TODAY's daily run
// reached completion, read from the cron_runs lifecycle table. The GitHub-Actions
// watchdog hits this on its own schedule (outside Railway) and emails the admin if
// the run is missing/incomplete — the alarm that finally lives OUTSIDE the process
// that can die. CRON_SECRET-gated. `healthy` = a 'completed' daily run exists today.
app.get("/api/cron/run-health", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!safeCompareSecret(secret, process.env.CRON_SECRET)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("cron_runs")
    .select("run_date, kind, started_at, completed_at, status, companies_total, companies_scraped, emails_sent, emails_skipped, note")
    .eq("run_date", today)
    .eq("kind", "daily")
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: "cron_runs query failed" });
    return;
  }
  const healthy = !!data && data.status === "completed";
  res.json({ healthy, date: today, run: data ?? null });
});

// Email-only recovery (DEV-58). Sends the daily alert from already-scraped data
// (today's new jobs in seen_jobs) WITHOUT re-scraping — for "scrape finished but the
// email step failed/was skipped -> just send it." CRON_SECRET-gated. SAFE BY DEFAULT:
// it is a dry-run (returns what it WOULD send, sends nothing) UNLESS ?dryRun=false,
// and a real send refuses if today's daily run already emailed (?force=true overrides).
// No scraping happens here.
app.post("/api/cron/email-only", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!safeCompareSecret(secret, process.env.CRON_SECRET)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const dryRun = req.query.dryRun !== "false"; // default TRUE; must pass ?dryRun=false to actually send
  const force = req.query.force === "true";
  try {
    const result = await sendEmailOnlyFromToday({ dryRun, force });
    res.json(result);
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "cron.email-only" } });
    console.error("email-only failed:", err);
    res.status(500).json({ error: "email-only failed" });
  }
});

// Self-check suspect feed (DEV-41). The daily-self-check workflow runs in a
// remote routine (Anthropic cloud) that has no Supabase access, so it pulls
// today's suspect set from here over HTTPS. CRON_SECRET-gated, same pattern as
// /api/cron/trigger. "Suspects" = looks-broken-but-not-already-explained,
// EXCLUDING is_verified_zero (auto-managed, known-zero). Mirrors the suspect
// filter documented in JOBS.md "Daily Self-Check Agent".
app.get("/api/cron/self-check-suspects", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  // Accept the scoped read-only SELF_CHECK_TOKEN (held by the daily self-check
  // cloud routine, which only needs to READ the suspect list) OR the full
  // CRON_SECRET. Least privilege: the routine's config holds only
  // SELF_CHECK_TOKEN, so a leak can't trigger the email pipeline
  // (/api/cron/trigger). safeCompareSecret returns false on an unset expected
  // value, so this stays backward-compatible if SELF_CHECK_TOKEN isn't set.
  const authed =
    safeCompareSecret(secret, process.env.SELF_CHECK_TOKEN) ||
    safeCompareSecret(secret, process.env.CRON_SECRET);
  if (!authed) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  type CompanyRow = {
    id: string;
    name: string;
    platform_type: string | null;
    platform_config: unknown;
    careers_url: string | null;
    last_check_status: string | null;
    subscriber_count: number | null;
    consecutive_failure_count: number | null;
    consecutive_healthy_zero_days: number | null;
    total_product_jobs: number | null;
    auto_disabled: boolean | null;
    is_verified_zero: boolean | null;
  };

  try {
    // Catalog is growing toward 1000 companies — paginate so the suspect feed
    // can't silently truncate at the PostgREST 1000-row cap.
    const companies = await fetchAllRows<CompanyRow>((from, to) =>
      supabase
        .from("companies")
        .select(
          "id, name, platform_type, platform_config, careers_url, last_check_status, subscriber_count, consecutive_failure_count, consecutive_healthy_zero_days, total_product_jobs, auto_disabled, is_verified_zero",
        )
        .order("id", { ascending: true })
        .range(from, to),
    );

    const isSuspect = (c: CompanyRow): boolean => {
      if (c.is_verified_zero === true) return false; // auto-managed, known-zero — not a real suspect
      const status = c.last_check_status || "";
      return (
        /error/i.test(status) ||
        /0 jobs from source/i.test(status) ||
        /quality: 0\/100/i.test(status) ||
        c.auto_disabled === true ||
        // >= 3 matches the watch-list threshold used elsewhere (dailyCheck.ts);
        // a single transient scrape blip self-resolves and isn't worth a diagnose+verify.
        (c.consecutive_failure_count || 0) >= 3 ||
        ((c.consecutive_healthy_zero_days || 0) > 0 && (c.subscriber_count || 0) > 0)
      );
    };

    const suspects = companies.filter(isSuspect).map((c) => ({
      id: c.id,
      name: c.name,
      platform_type: c.platform_type,
      platform_config: c.platform_config,
      careers_url: c.careers_url,
      last_check_status: c.last_check_status,
      subscriber_count: c.subscriber_count,
      consecutive_failure_count: c.consecutive_failure_count,
      consecutive_healthy_zero_days: c.consecutive_healthy_zero_days,
      total_product_jobs: c.total_product_jobs,
    }));

    res.json({
      generatedAt: new Date().toISOString(),
      total: companies.length,
      count: suspects.length,
      suspects,
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/cron/self-check-suspects error:", err);
    res.status(500).json({ error: "Failed to compute suspect set" });
  }
});

// Admin: add company (protected by CRON_SECRET, for CLI/automation use)
app.post("/api/admin/add-company", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!safeCompareSecret(secret, process.env.CRON_SECRET)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { name, careers_url } = req.body;
  if (!name || !careers_url) {
    res.status(400).json({ error: "name and careers_url are required" });
    return;
  }

  try {
    // Find admin user by email via paginated fetch.
    const { listAllUsers } = await import("./lib/listAllUsers");
    const allUsers = await listAllUsers();
    const adminUser = allUsers.find((u) => u.email === ADMIN_EMAIL);
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

// DEV-57 graceful-shutdown alert. When Railway redeploys (or otherwise stops the
// container) mid daily-run, the process receives SIGTERM. That is NOT a JS throw,
// so every in-process alarm is bypassed and the run dies silently — exactly the
// 2026-05-31 incident. This turns the silent kill into an explicit, attributed
// alert (Sentry already emails on new issues) and marks the cron_runs row
// interrupted, best-effort within Railway's grace window, before exiting.
let shuttingDown = false;
async function handleCronAwareShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (currentRun.active && currentRun.runDate) {
    const msg = `Daily cron INTERRUPTED by ${signal} (likely a Railway redeploy) at company ${currentRun.scraped}/${currentRun.total} on ${currentRun.runDate}. The run did NOT finish — today's email may not have been sent.`;
    console.error(msg);
    try { Sentry.captureMessage(msg, "error"); } catch { /* best-effort */ }
    try { await recordRunInterrupted(currentRun.runDate, currentRun.kind, currentRun.scraped); } catch { /* best-effort */ }
    try { await Sentry.flush(2000); } catch { /* best-effort */ }
  }
  process.exit(0);
}
// Only register on the prod service (where the daily cron actually runs and a
// deploy can kill it). Avoids changing local-dev Ctrl-C behavior; matches the
// DEV-47 RAILWAY_ENVIRONMENT_NAME prod-guard convention.
if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
  process.on("SIGTERM", () => { void handleCronAwareShutdown("SIGTERM"); });
  process.on("SIGINT", () => { void handleCronAwareShutdown("SIGINT"); });
}
