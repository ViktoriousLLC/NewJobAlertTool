import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

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

    // Insert subscription rows
    const rows = company_ids.map((companyId: string) => ({
      user_id: req.userId!,
      company_id: companyId,
    }));

    const { error: insertError } = await supabase
      .from("user_subscriptions")
      .upsert(rows, { onConflict: "user_id,company_id" });

    if (insertError) throw insertError;

    // Increment subscriber_count and set is_active for each company
    for (const companyId of company_ids) {
      const { data: countData } = await supabase
        .from("user_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);

      const count = (countData as unknown as { count: number } | null)?.count ?? 1;

      await supabase
        .from("companies")
        .update({ subscriber_count: count, is_active: true })
        .eq("id", companyId);
    }

    res.json({ success: true, subscribed: company_ids.length });
  } catch (err) {
    console.error("POST /api/subscriptions error:", err);
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

// DELETE /api/subscriptions/:companyId — unsubscribe from a company
router.delete("/:companyId", async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

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
    console.error("DELETE /api/subscriptions/:companyId error:", err);
    res.status(500).json({ error: "Failed to unsubscribe" });
  }
});

export default router;
