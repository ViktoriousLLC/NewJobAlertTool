import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";
import { getCompData, getAllCompData } from "../lib/levelsFyi";

const router = Router();

// GET /api/compensation — comp data for all of user's tracked companies
router.get("/", async (req: Request, res: Response) => {
  try {
    const { data: companies, error } = await supabase
      .from("companies")
      .select("name")
      .eq("user_id", req.userId!);

    if (error) throw error;

    const names = (companies || []).map((c) => c.name);
    if (names.length === 0) {
      res.json({});
      return;
    }

    const compData = await getAllCompData(names);
    res.json(compData);
  } catch (err) {
    console.error("GET /api/compensation error:", err);
    res.status(500).json({ error: "Failed to fetch compensation data" });
  }
});

// GET /api/compensation/:companyName — comp data for a single company
router.get("/:companyName", async (req: Request, res: Response) => {
  try {
    const companyName = req.params.companyName as string;
    const data = await getCompData(decodeURIComponent(companyName));

    if (!data) {
      res.status(404).json({ error: "No compensation data found" });
      return;
    }

    res.json(data);
  } catch (err) {
    console.error("GET /api/compensation/:companyName error:", err);
    res.status(500).json({ error: "Failed to fetch compensation data" });
  }
});

export default router;
