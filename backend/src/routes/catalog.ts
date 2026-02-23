import { Router, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";

const router = Router();

// GET /api/catalog — list all companies (shared catalog, no user filter)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { data: companies, error } = await supabase
      .from("companies")
      .select("id, name, careers_url, total_product_jobs, last_check_status, subscriber_count, is_active")
      .order("name", { ascending: true });

    if (error) throw error;

    res.json(companies || []);
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/catalog error:", err);
    res.status(500).json({ error: "Failed to fetch catalog" });
  }
});

export default router;
