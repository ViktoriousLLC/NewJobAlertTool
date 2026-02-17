import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";

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

    // Get company names for those IDs
    const { data: companies, error: compErr } = await supabase
      .from("companies")
      .select("id, name, careers_url")
      .in("id", companyIds);

    if (compErr) throw compErr;

    const companyMap = new Map(
      (companies || []).map((c) => [c.id, { name: c.name, careers_url: c.careers_url }])
    );

    // Get all active jobs for these companies
    const { data: jobs, error: jobsErr } = await supabase
      .from("seen_jobs")
      .select("id, company_id, job_title, job_location, job_url_path, first_seen_at, is_baseline, job_level, status")
      .in("company_id", companyIds)
      .eq("status", "active")
      .order("first_seen_at", { ascending: false });

    if (jobsErr) throw jobsErr;

    // Join company info onto each job
    const result = (jobs || []).map((j) => {
      const company = companyMap.get(j.company_id);
      return {
        ...j,
        company_name: company?.name || "",
        careers_url: company?.careers_url || "",
      };
    });

    res.json(result);
  } catch (err) {
    console.error("GET /api/jobs error:", err);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

export default router;
