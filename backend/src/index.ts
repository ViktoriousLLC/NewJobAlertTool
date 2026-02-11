import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import companiesRouter from "./routes/companies";
import favoritesRouter from "./routes/favorites";
import { runDailyCheck } from "./jobs/dailyCheck";
import { requireAuth } from "./middleware/auth";

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

// Routes (protected by auth)
app.use("/api/companies", requireAuth, companiesRouter);
app.use("/api/favorites", requireAuth, favoritesRouter);

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


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
