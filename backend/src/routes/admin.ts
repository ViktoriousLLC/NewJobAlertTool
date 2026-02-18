import { Router, Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase";
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
      supabase.auth.admin.listUsers(),
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
      supabase.auth.admin.listUsers(),
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
    console.error("GET /api/admin/issues error:", err);
    res.status(500).json({ error: "Failed to fetch issues" });
  }
});

// GET /api/admin/users — user list with subscription count and preferences
router.get("/users", async (_req: Request, res: Response) => {
  try {
    const [usersResult, subsResult, prefsResult] = await Promise.all([
      supabase.auth.admin.listUsers(),
      supabase.from("user_subscriptions").select("user_id"),
      supabase.from("user_preferences").select("user_id, email_frequency"),
    ]);

    const users = usersResult.data?.users || [];
    const subs = subsResult.data || [];
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
    console.error("GET /api/admin/users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

export default router;
