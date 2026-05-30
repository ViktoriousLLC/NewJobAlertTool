export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // DEV-39 (backport of backend DEV-27): Sentry.init() no-ops SILENTLY on a
    // missing/malformed/wrong-project DSN, so a dead error pipeline looks
    // identical to a healthy one. The frontend's NEXT_PUBLIC_SENTRY_DSN was
    // once truncated and dead with nothing to catch it. Actively verify both
    // frontend DSNs at server start by pushing a real event through ingest and
    // checking acceptance. Fire-and-forget; never blocks startup. On failure it
    // logs loudly + emits a PostHog observability.sentry_unhealthy event (the
    // backend's daily probe owns the admin-email channel).
    //
    // Gated to Vercel production. On Vercel, NODE_ENV is "production" for BOTH
    // production and preview builds, so VERCEL_ENV is the correct signal to
    // avoid firing a probe (and a PostHog event) on every preview deploy.
    if (process.env.VERCEL_ENV === "production") {
      import("./src/lib/sentryHealth")
        .then(({ reportFrontendSentryHealth }) => reportFrontendSentryHealth("boot"))
        .catch((err) => console.error("[observability] Sentry boot probe crashed:", err));
    }
  }
}

export const onRequestError = async (...args: unknown[]) => {
  const { captureRequestError } = await import("@sentry/nextjs");
  // @ts-expect-error - Sentry types may not match exactly
  return captureRequestError(...args);
};
