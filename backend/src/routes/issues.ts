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

    // Length cap so a single user can't dump huge payloads into the admin queue.
    if (typeof description === "string" && description.length > 5000) {
      res.status(400).json({ error: "Description too long (max 5000 characters)" });
      return;
    }

    // Verify the user is subscribed to the company they're reporting on.
    // Stops drive-by spam against arbitrary companies in the admin queue.
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("id")
      .eq("user_id", req.userId!)
      .eq("company_id", company_id)
      .maybeSingle();

    if (!sub) {
      res.status(403).json({ error: "Not subscribed to this company" });
      return;
    }

    const { data: issue, error } = await supabase
      .from("scrape_issues")
      .insert({
        company_id,
        user_id: req.userId!,
        issue_type,
        description: typeof description === "string" ? description.slice(0, 5000) : null,
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
