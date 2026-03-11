import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  ignoreErrors: [
    // EPIPE is a harmless Node.js error on Windows dev server (broken pipe on hot reload / tab close)
    "EPIPE",
  ],
});
