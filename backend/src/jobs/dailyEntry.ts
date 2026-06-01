// DEV-57 worker entrypoint. A standalone process that runs the daily check ONCE
// and exits — the basis for moving the run OFF the web service onto a dedicated
// Railway cron service, so a web-service redeploy can no longer kill an in-flight
// run (the 2026-05-31 P0). The actual cutover (create the Railway cron service +
// point it at `npm run cron:daily`, remove the old /api/cron/trigger schedule) is
// a VERIFIED dashboard step tracked in DEV-58 — it can't be confirmed until a real
// 14:00 run, so it isn't flipped blind. This script is ready for that flip.
//
// Run: node dist/jobs/dailyEntry.js [--skip-emails] [--force]
import * as Sentry from "@sentry/node";
import { runDailyCheck } from "./dailyCheck";

// Minimal Sentry init so the worker reports errors. Mirrors index.ts (DEV-58 will
// extract the shared init so this isn't duplicated). No-ops safely if SENTRY_DSN
// is unset.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0.1,
  });
}

(async () => {
  const skipEmails = process.argv.includes("--skip-emails");
  const force = process.argv.includes("--force");
  console.log(`[dailyEntry] starting runDailyCheck (skipEmails=${skipEmails}, force=${force})`);
  try {
    await runDailyCheck({ skipEmails, force });
    console.log("[dailyEntry] runDailyCheck completed");
    await Sentry.flush(3000).catch(() => {});
    process.exit(0);
  } catch (err) {
    console.error("[dailyEntry] runDailyCheck threw:", err);
    try {
      Sentry.captureException(err);
      await Sentry.flush(3000);
    } catch {
      /* best-effort */
    }
    process.exit(1);
  }
})();
