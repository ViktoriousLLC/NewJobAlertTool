import { Router, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/subscriptions — list user's subscribed company IDs
router.get("/", async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("user_subscriptions")
      .select("company_id")
      .eq("user_id", req.userId!);

    if (error) throw error;

    const companyIds = (data || []).map((row) => row.company_id);
    res.json(companyIds);
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/subscriptions error:", err);
    res.status(500).json({ error: "Failed to fetch subscriptions" });
  }
});

// POST /api/subscriptions — subscribe to companies (body: { company_ids: string[] })
router.post("/", async (req: Request, res: Response) => {
  try {
    const { company_ids } = req.body;

    if (!Array.isArray(company_ids) || company_ids.length === 0) {
      res.status(400).json({ error: "company_ids array is required" });
      return;
    }
    if (!company_ids.every((id: unknown) => typeof id === "string" && UUID_RE.test(id))) {
      res.status(400).json({ error: "Invalid company ID format" });
      return;
    }

    // Insert subscription rows
    const rows = company_ids.map((companyId: string) => ({
      user_id: req.userId!,
      company_id: companyId,
    }));

    const { error: insertError } = await supabase
      .from("user_subscriptions")
      .upsert(rows, { onConflict: "user_id,company_id" });

    if (insertError) throw insertError;

    // Batch: get subscriber counts for all affected companies in one query
    const { data: countRows } = await supabase
      .from("user_subscriptions")
      .select("company_id")
      .in("company_id", company_ids);

    const countMap = new Map<string, number>();
    for (const row of countRows || []) {
      countMap.set(row.company_id, (countMap.get(row.company_id) || 0) + 1);
    }

    // Parallel: update all companies at once
    await Promise.all(
      company_ids.map((companyId: string) => {
        const count = countMap.get(companyId) || 1;
        return supabase
          .from("companies")
          .update({ subscriber_count: count, is_active: true })
          .eq("id", companyId);
      })
    );

    res.json({ success: true, subscribed: company_ids.length });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/subscriptions error:", err);
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

// DELETE /api/subscriptions/:companyId — unsubscribe from a company
router.delete("/:companyId", async (req: Request, res: Response) => {
  try {
    const companyId = req.params.companyId as string;
    if (!UUID_RE.test(companyId)) {
      res.status(400).json({ error: "Invalid company ID format" });
      return;
    }

    const { error: deleteError } = await supabase
      .from("user_subscriptions")
      .delete()
      .eq("user_id", req.userId!)
      .eq("company_id", companyId);

    if (deleteError) throw deleteError;

    // Get updated subscriber count
    const { count } = await supabase
      .from("user_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);

    const newCount = count ?? 0;

    // Update company: decrement count, deactivate if zero
    await supabase
      .from("companies")
      .update({
        subscriber_count: newCount,
        is_active: newCount > 0,
      })
      .eq("id", companyId);

    res.json({ success: true, subscriber_count: newCount });
  } catch (err) {
    Sentry.captureException(err);
    console.error("DELETE /api/subscriptions/:companyId error:", err);
    res.status(500).json({ error: "Failed to unsubscribe" });
  }
});

export default router;
