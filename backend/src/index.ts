import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import companiesRouter from "./routes/companies";
import favoritesRouter from "./routes/favorites";
import issuesRouter from "./routes/issues";
import { runDailyCheck } from "./jobs/dailyCheck";
import { requireAuth } from "./middleware/auth";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  // Also allow www variant for Vercel domain redirect
  (process.env.FRONTEND_URL || "").replace("https://", "https://www."),
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
  })
);
app.use(express.json());

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Routes (protected by auth)
app.use("/api/companies", requireAuth, companiesRouter);
app.use("/api/favorites", requireAuth, favoritesRouter);
app.use("/api/issues", requireAuth, issuesRouter);

// Manual trigger for daily check (protected by secret)
app.get("/api/cron/trigger", async (req, res) => {
  // Primary: read secret from Authorization header
  const authHeader = req.headers.authorization;
  const headerSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  // Fallback: query param (deprecated)
  const querySecret = req.query.secret as string | undefined;
  if (querySecret) {
    console.warn("DEPRECATED: cron secret via query param. Use Authorization: Bearer <secret> header instead.");
  }

  const secret = headerSecret || querySecret;
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
