import { Router, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";

const router = Router();

// POST /api/issues — report a scrape issue
router.post("/", async (req: Request, res: Response) => {
  try {
    const { company_id, issue_type, description } = req.body;

    if (!company_id || !issue_type) {
      res.status(400).json({ error: "company_id and issue_type are required" });
      return;
    }

    const validTypes = ["wrong_jobs", "missing_jobs", "bad_locations", "other"];
    if (!validTypes.includes(issue_type)) {
      res.status(400).json({ error: `issue_type must be one of: ${validTypes.join(", ")}` });
      return;
    }

    // Verify company exists (shared catalog — any user can report)
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("id", company_id)
      .single();

    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const { data: issue, error } = await supabase
      .from("scrape_issues")
      .insert({
        company_id,
        user_id: req.userId!,
        issue_type,
        description: description || null,
      })
      .select()
      .single();

    if (error) throw error;

    res.json(issue);
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/issues error:", err);
    res.status(500).json({ error: "Failed to report issue" });
  }
});

export default router;
