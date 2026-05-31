import { Router, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/fetchAllRows";

const router = Router();

// GET /api/jobs — all jobs across user's subscribed companies
router.get("/", async (req: Request, res: Response) => {
  try {
    // Get user's subscribed company IDs
    const { data: subs, error: subErr } = await supabase
      .from("user_subscriptions")
      .select("company_id")
      .eq("user_id", req.userId!);

    if (subErr) throw subErr;

    const companyIds = (subs || []).map((s) => s.company_id);
    if (companyIds.length === 0) {
      res.json([]);
      return;
    }

    // Parallel: fetch companies and jobs at the same time.
    // The active-jobs read can exceed PostgREST's silent 1000-row cap for a
    // user subscribed to many companies, which would truncate the /jobs list
    // (and any starred-filter computed off it). Paginate over the stable unique
    // key (id); we sort by first_seen_at DESC in Node afterward.
    type JobRow = {
      id: string;
      company_id: string;
      job_title: string;
      job_location: string | null;
      job_url_path: string;
      first_seen_at: string;
      is_baseline: boolean;
      job_level: string | null;
      status: string | null;
    };
    const [companiesResult, jobs] = await Promise.all([
      supabase
        .from("companies")
        .select("id, name, careers_url")
        .in("id", companyIds),
      fetchAllRows<JobRow>((from, to) =>
        supabase
          .from("seen_jobs")
          .select("id, company_id, job_title, job_location, job_url_path, first_seen_at, is_baseline, job_level, status")
          .in("company_id", companyIds)
          .eq("status", "active")
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);

    if (companiesResult.error) throw companiesResult.error;

    const companies = companiesResult.data;

    // Restore the previous newest-first ordering (paging had to order by id).
    jobs.sort((a, b) => (a.first_seen_at < b.first_seen_at ? 1 : a.first_seen_at > b.first_seen_at ? -1 : 0));

    const companyMap = new Map(
      (companies || []).map((c) => [c.id, { name: c.name, careers_url: c.careers_url }])
    );

    // Join company info onto each job
    const result = jobs.map((j) => {
      const company = companyMap.get(j.company_id);
      return {
        ...j,
        company_name: company?.name || "",
        careers_url: company?.careers_url || "",
      };
    });

    res.json(result);
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/jobs error:", err);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

export default router;
