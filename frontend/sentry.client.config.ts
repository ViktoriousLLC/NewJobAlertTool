import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://SENTRY_DSN_REDACTED",
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
});
