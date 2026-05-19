import { Router, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";

const router = Router();

// Public, paginated feed of recent PM jobs across all companies. Powers the
// new job-first landing page (PR #24). No auth required — the catalog is
// shared and the per-row Track button gates writes behind the existing
// magic-link login flow.

const VALID_INDUSTRIES = new Set([
  "banking", "biotech", "consulting", "consumer", "fintech",
  "gaming", "hardware", "healthcare", "media", "tech",
]);
const VALID_LEVELS = new Set(["early", "mid", "director"]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const industryParam = typeof req.query.industry === "string" ? req.query.industry : null;
    const industry = industryParam && VALID_INDUSTRIES.has(industryParam) ? industryParam : null;

    const levelParam = typeof req.query.level === "string" ? req.query.level : null;
    const level = levelParam && VALID_LEVELS.has(levelParam) ? levelParam : null;

    const qRaw = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const q = qRaw.length > 0 ? qRaw : null;

    // Foreign-key join via Supabase's nested select. `companies!inner` makes
    // the filter on `companies.industry` an INNER JOIN so non-matching jobs
    // are excluded server-side instead of post-filtered in JS.
    let query = supabase
      .from("seen_jobs")
      .select(
        "id, job_title, job_location, job_url_path, first_seen_at, job_level, companies!inner ( id, name, careers_url, industry )",
        { count: "exact" }
      )
      .eq("status", "active")
      .eq("is_baseline", false)
      .order("first_seen_at", { ascending: false });

    if (industry) query = query.eq("companies.industry", industry);
    if (level) query = query.eq("job_level", level);
    if (q) {
      // Postgres ilike — case-insensitive substring match on title.
      // % wildcards are safe here: query is constrained to 100 chars and
      // ilike treats % as a wildcard token, not an injection vector.
      query = query.ilike("job_title", `%${q}%`);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    type JoinedRow = {
      id: string;
      job_title: string;
      job_location: string | null;
      job_url_path: string;
      first_seen_at: string;
      job_level: string | null;
      companies: { id: string; name: string; careers_url: string; industry: string };
    };

    const rows = (data as unknown as JoinedRow[]) || [];
    const jobs = rows.map((row) => ({
      id: row.id,
      title: row.job_title,
      location: row.job_location,
      urlPath: row.job_url_path,
      firstSeenAt: row.first_seen_at,
      level: row.job_level,
      company: row.companies,
    }));

    res.json({
      jobs,
      total: count ?? jobs.length,
      limit,
      offset,
      filters: { industry, level, q },
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/feed error:", err);
    res.status(500).json({ error: "Failed to fetch feed" });
  }
});

export default router;
