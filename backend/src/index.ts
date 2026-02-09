import express from "express";
import cors from "cors";
import cron from "node-cron";
import dotenv from "dotenv";
import companiesRouter from "./routes/companies";
import { runDailyCheck } from "./jobs/dailyCheck";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
  })
);
app.use(express.json());

// Routes
app.use("/api/companies", companiesRouter);

// Manual trigger for daily check (protected by secret)
app.get("/api/cron/trigger", async (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Run in background so the request doesn't timeout
  runDailyCheck().catch((err) =>
    console.error("Manual daily check failed:", err)
  );

  res.json({ message: "Daily check triggered" });
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Test email endpoint (temporary — remove after verifying email works)
app.get("/api/test-email", async (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { Resend } = await import("resend");

  if (!process.env.RESEND_API_KEY) {
    res.status(500).json({ error: "RESEND_API_KEY not set" });
    return;
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: "vik@viktoriousllc.com",
      to: "vik@viktoriousllc.com",
      subject: "Test Email from Job Alert Tool",
      html: "<h2>It works!</h2><p>If you see this, daily email alerts are configured correctly.</p>",
    });
    res.json({ success: true, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({ success: false, error: message, details: err });
  }
});

// Schedule daily check: 10:00 UTC (2am PT)
cron.schedule("0 10 * * *", () => {
  console.log("Cron triggered: running daily check");
  runDailyCheck().catch((err) =>
    console.error("Cron daily check failed:", err)
  );
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
