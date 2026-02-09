import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

// GET /api/favorites — list all favorited job IDs
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("favorites")
      .select("job_id");

    if (error) throw error;

    const jobIds = (data || []).map((row) => row.job_id);
    res.json(jobIds);
  } catch (err) {
    console.error("GET /api/favorites error:", err);
    res.status(500).json({ error: "Failed to fetch favorites" });
  }
});

// POST /api/favorites/:jobId — add a favorite
router.post("/:jobId", async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const { error } = await supabase
      .from("favorites")
      .upsert({ job_id: jobId }, { onConflict: "job_id" });

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/favorites/:jobId error:", err);
    res.status(500).json({ error: "Failed to add favorite" });
  }
});

// DELETE /api/favorites/:jobId — remove a favorite
router.delete("/:jobId", async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("job_id", jobId);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/favorites/:jobId error:", err);
    res.status(500).json({ error: "Failed to remove favorite" });
  }
});

export default router;
