import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

// GET /api/preferences — get user preferences (create default if not exists)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { data: existing, error: fetchError } = await supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", req.userId!)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      // PGRST116 = no rows — that's expected for new users
      throw fetchError;
    }

    if (existing) {
      res.json(existing);
      return;
    }

    // Create default preferences
    const { data: created, error: createError } = await supabase
      .from("user_preferences")
      .insert({ user_id: req.userId!, email_frequency: "daily" })
      .select()
      .single();

    if (createError) throw createError;

    res.json(created);
  } catch (err) {
    console.error("GET /api/preferences error:", err);
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

// PUT /api/preferences — update user preferences
router.put("/", async (req: Request, res: Response) => {
  try {
    const { email_frequency } = req.body;

    const validFrequencies = ["daily", "off"];
    if (!validFrequencies.includes(email_frequency)) {
      res.status(400).json({
        error: `email_frequency must be one of: ${validFrequencies.join(", ")}`,
      });
      return;
    }

    const { data, error } = await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: req.userId!,
          email_frequency,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error("PUT /api/preferences error:", err);
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

export default router;
