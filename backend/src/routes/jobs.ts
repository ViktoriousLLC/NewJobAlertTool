import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

// GET /api/jobs — all jobs across all of a user's companies (single query)
router.get("/", async (req: Request, res: Response) => {
  try {
    // Get user's company IDs + names in one query
    const { data: companies, error: compErr } = await supabase
      .from("companies")
      .select("id, name, careers_url")
      .eq("user_id", req.userId!);

    if (compErr) throw compErr;
    if (!companies || companies.length === 0) {
      res.json([]);
      return;
    }

    const companyMap = new Map(
      companies.map((c) => [c.id, { name: c.name, careers_url: c.careers_url }])
    );
    const companyIds = companies.map((c) => c.id);

    // Get all jobs for these companies in one query
    const { data: jobs, error: jobsErr } = await supabase
      .from("seen_jobs")
      .select("id, company_id, job_title, job_location, job_url_path, first_seen_at, is_baseline, job_level")
      .in("company_id", companyIds)
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
