import { Router, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/fetchAllRows";

const router = Router();

// GET /api/catalog — list all companies (shared catalog, no user filter)
router.get("/", async (req: Request, res: Response) => {
  try {
    // Returns the FULL catalog, which already approaches PostgREST's silent
    // 1000-row cap. An unbounded select would quietly drop companies past row
    // 1000. Paginate over the stable unique key (id), then sort by name for
    // display (paging order must be the unique key, not name).
    const companies = await fetchAllRows<{ id: string; name: string; careers_url: string; total_product_jobs: number | null; last_check_status: string | null; subscriber_count: number | null; is_active: boolean | null; scrape_blocked: boolean | null; industry: string | null; sub_industry: string | null }>(
      (from, to) =>
        supabase
          .from("companies")
          .select("id, name, careers_url, total_product_jobs, last_check_status, subscriber_count, is_active, scrape_blocked, industry, sub_industry")
          .order("id", { ascending: true })
          .range(from, to)
    );
    companies.sort((a, b) => a.name.localeCompare(b.name));

    res.json(companies);
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/catalog error:", err);
    res.status(500).json({ error: "Failed to fetch catalog" });
  }
});

export default router;
