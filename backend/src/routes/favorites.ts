import { Router, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/favorites — list user's favorited job IDs
router.get("/", async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("user_job_favorites")
      .select("seen_job_id")
      .eq("user_id", req.userId!);

    if (error) throw error;

    const jobIds = (data || []).map((row) => row.seen_job_id);
    res.json(jobIds);
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/favorites error:", err);
    res.status(500).json({ error: "Failed to fetch favorites" });
  }
});

// POST /api/favorites/:jobId — add a favorite
router.post("/:jobId", async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    if (!UUID_REGEX.test(jobId)) {
      res.status(400).json({ error: "Invalid job ID format" });
      return;
    }

    const { error } = await supabase
      .from("user_job_favorites")
      .upsert(
        { seen_job_id: jobId, user_id: req.userId! },
        { onConflict: "user_id,seen_job_id" }
      );

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/favorites/:jobId error:", err);
    res.status(500).json({ error: "Failed to add favorite" });
  }
});

// DELETE /api/favorites/:jobId — remove a favorite
router.delete("/:jobId", async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    if (!UUID_REGEX.test(jobId)) {
      res.status(400).json({ error: "Invalid job ID format" });
      return;
    }

    const { error } = await supabase
      .from("user_job_favorites")
      .delete()
      .eq("seen_job_id", jobId)
      .eq("user_id", req.userId!);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    Sentry.captureException(err);
    console.error("DELETE /api/favorites/:jobId error:", err);
    res.status(500).json({ error: "Failed to remove favorite" });
  }
});

export default router;
