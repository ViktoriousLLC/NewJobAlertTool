import { Router, Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { listAllUsers } from "../lib/listAllUsers";
import { ADMIN_EMAIL } from "../lib/constants";

const router = Router();

// Middleware: restrict to admin user
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.userEmail !== ADMIN_EMAIL) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  next();
}

router.use(requireAdmin);

// GET /api/admin/stats — dashboard summary stats
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [usersResult, companiesResult, activeJobsResult, subsResult, errorCompaniesResult] = await Promise.all([
      listAllUsers().then((u) => ({ data: { users: u } })),
      supabase.from("companies").select("id", { count: "exact", head: true }),
      supabase.from("seen_jobs").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("user_subscriptions").select("id", { count: "exact", head: true }),
      supabase
        .from("companies")
        .select("id, name, last_check_status, last_checked_at")
        .like("last_check_status", "error%")
        .order("last_checked_at", { ascending: false }),
    ]);

    const users = usersResult.data?.users || [];
    const recentSignups = users.filter(
      (u) => u.created_at && new Date(u.created_at) >= sevenDaysAgo
    ).length;

    res.json({
      total_users: users.length,
      total_companies: companiesResult.count || 0,
      active_jobs: activeJobsResult.count || 0,
      total_subscriptions: subsResult.count || 0,
      recent_signups_7d: recentSignups,
      error_companies: errorCompaniesResult.data || [],
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/admin/stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// GET /api/admin/issues — combined scrape issues + help submissions, enriched with names/emails
router.get("/issues", async (_req: Request, res: Response) => {
  try {
    const [scrapeIssuesResult, helpResult, companiesResult, usersResult] = await Promise.all([
      supabase
        .from("scrape_issues")
        .select("id, company_id, user_id, issue_type, description, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("help_submissions")
        .select("id, user_id, user_email, issue_type, message, page_url, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("companies")
        .select("id, name"),
      listAllUsers().then((u) => ({ data: { users: u } })),
    ]);

    // Build lookup maps
    const companyMap = new Map<string, string>();
    for (const c of companiesResult.data || []) {
      companyMap.set(c.id, c.name);
    }

    const userEmailMap = new Map<string, string>();
    for (const u of usersResult.data?.users || []) {
      if (u.email) userEmailMap.set(u.id, u.email);
    }

    // Enrich scrape issues with company name and user email
    const enrichedScrapeIssues = (scrapeIssuesResult.data || []).map((s) => ({
      ...s,
      company_name: companyMap.get(s.company_id) || "Unknown",
      user_email: userEmailMap.get(s.user_id) || null,
    }));

    res.json({
      scrape_issues: enrichedScrapeIssues,
      help_submissions: helpResult.data || [],
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/admin/issues error:", err);
    res.status(500).json({ error: "Failed to fetch issues" });
  }
});

// GET /api/admin/companies — all companies for management
router.get("/companies", async (_req: Request, res: Response) => {
  try {
    const { data: companies, error } = await supabase
      .from("companies")
      .select("id, name, careers_url, total_product_jobs, subscriber_count, is_active, last_checked_at, last_check_status")
      .order("name", { ascending: true });

    if (error) throw error;
    res.json(companies || []);
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/admin/companies error:", err);
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

// GET /api/admin/users — user list with subscription count and preferences
router.get("/users", async (_req: Request, res: Response) => {
  try {
    // user_subscriptions must be paginated: PostgREST caps a single select at
    // 1000 rows, and the table is well past that. An unbounded select made
    // this admin view under-count subscriptions for every user past row 1000
    // (the same truncation that silently dropped recent signups from the daily
    // email loop). Paginate over a stable unique key (id).
    const fetchAllSubscriptions = async (): Promise<{ user_id: string }[]> => {
      const rows: { user_id: string }[] = [];
      const PAGE_SIZE = 1000;
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("user_subscriptions")
          .select("user_id")
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      return rows;
    };

    const [usersResult, subs, prefsResult] = await Promise.all([
      listAllUsers().then((u) => ({ data: { users: u } })),
      fetchAllSubscriptions(),
      supabase.from("user_preferences").select("user_id, email_frequency"),
    ]);

    const users = usersResult.data?.users || [];
    const prefs = prefsResult.data || [];

    // Count subscriptions per user
    const subCountMap = new Map<string, number>();
    for (const sub of subs) {
      subCountMap.set(sub.user_id, (subCountMap.get(sub.user_id) || 0) + 1);
    }

    // Email preference per user
    const prefsMap = new Map<string, string>();
    for (const pref of prefs) {
      prefsMap.set(pref.user_id, pref.email_frequency);
    }

    const result = users.map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      subscriptions: subCountMap.get(u.id) || 0,
      email_frequency: prefsMap.get(u.id) || "daily",
    }));

    res.json(result);
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/admin/users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET /api/admin/email-status — proxy Resend's list emails API.
//
// Purpose: investigate missing-email reports without writing user PII to our
// own database. Resend keeps the per-recipient send log; we just query it.
//
// Query params (all optional):
//   ?email=foo@bar.com  filter results to a specific recipient
//   ?limit=20           cap returned results (default 20, max 100)
//
// Returns: array of recent emails with {id, to, from, subject, last_event, created_at}.
//
// Auth: requireAdmin middleware (top of file) — only ADMIN_EMAIL gets in.
router.get("/email-status", async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "RESEND_API_KEY not configured" });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const filterEmail = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : null;

    // Resend's list endpoint paginates; pull up to `limit` items in a single page.
    const resp = await fetch(`https://api.resend.com/emails?limit=${limit}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      res.status(resp.status).json({ error: `Resend API ${resp.status}`, body: text.slice(0, 500) });
      return;
    }
    const json = await resp.json() as { data?: Array<{ id: string; to: string[]; from: string; subject: string; last_event?: string; created_at: string }> };
    let emails = json.data || [];
    if (filterEmail) {
      emails = emails.filter((e) => (e.to || []).some((addr) => (addr || "").toLowerCase().includes(filterEmail)));
    }

    res.json({
      count: emails.length,
      filterEmail,
      emails: emails.map((e) => ({
        id: e.id,
        to: e.to,
        from: e.from,
        subject: e.subject,
        last_event: e.last_event,
        created_at: e.created_at,
      })),
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/admin/email-status error:", err);
    res.status(500).json({ error: "Failed to query Resend" });
  }
});

// POST /api/admin/users/send-magic-link — trigger a fresh magic-link email
// to an existing user. Built to recover users stuck post-incident (template
// bug 2026-05-22 + cookie bug DEV-3 fixed 2026-05-25). Reusable for the
// stuck-user reminder system (DEV-14) and any future "user lost their link"
// scenario.
//
// Body: { email: string }
// Auth: requireAdmin (top of file).
// Behavior: calls supabase.auth.signInWithOtp with shouldCreateUser=false,
// which uses the (just-fixed) Supabase Auth email template + SMTP path.
// Will reject if the email doesn't already exist as an auth user.
//
// Returns: { success: true, email } on send. Errors bubble through 4xx/5xx.
router.post("/users/send-magic-link", async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (typeof email !== "string" || !email.includes("@") || email.length > 320) {
      res.status(400).json({ error: "Valid email required in body" });
      return;
    }

    // Don't auto-create users via this admin path — recovery only, not bulk
    // onboarding. shouldCreateUser=false makes Supabase return user-not-found.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    if (error) {
      // Common: user doesn't exist (would-be new signup). Surface clearly.
      const status = /not found|does not exist/i.test(error.message) ? 404 : 500;
      res.status(status).json({ error: error.message });
      return;
    }

    res.json({ success: true, email });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/admin/users/send-magic-link error:", err);
    res.status(500).json({ error: "Failed to send magic link" });
  }
});

// POST /api/admin/weekly-digest/send — trigger the weekly LinkedIn-draft
// email send manually. Useful for test sends + ad-hoc runs without waiting
// for the Friday cron. Returns the computed data so the caller can preview
// the numbers even on a no-key (compute-but-don't-send) outcome.
router.post("/weekly-digest/send", async (_req: Request, res: Response) => {
  try {
    const { sendWeeklyDigest } = await import("../jobs/weeklyDigest");
    const result = await sendWeeklyDigest();
    res.json(result);
  } catch (err) {
    Sentry.captureException(err);
    console.error("Admin weekly-digest send failed:", err);
    res.status(500).json({ error: "Weekly digest send failed" });
  }
});

// GET /api/admin/weekly-digest/preview — return the computed data + the
// rendered LinkedIn post text + HTML email body without sending. Useful for
// previewing what Friday's email will look like before it lands in the inbox.
router.get("/weekly-digest/preview", async (_req: Request, res: Response) => {
  try {
    const { computeWeeklyDigest, renderLinkedInPost, renderEmailHtml } = await import("../jobs/weeklyDigest");
    const data = await computeWeeklyDigest();
    res.json({
      data,
      linkedinPost: renderLinkedInPost(data),
      emailHtml: renderEmailHtml(data),
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("Admin weekly-digest preview failed:", err);
    res.status(500).json({ error: "Weekly digest preview failed" });
  }
});

export default router;
