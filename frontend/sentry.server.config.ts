import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://SENTRY_DSN_REDACTED",
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
});
