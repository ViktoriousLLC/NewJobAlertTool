// Server-side PostHog event emission for the Express backend.
//
// Backend mirror of the frontend serverAnalytics.ts helper. Posts directly
// to PostHog's capture endpoint via fetch; no SDK dependency.
//
// Used for visibility on backend-only paths that the frontend can't track:
//   auth.jwt_verify_path (local | fallback | unauthorized)
//   future: rate-limit hits, scraper events at the API edge, etc.
//
// Fire-and-forget. A failed capture never breaks the request lifecycle, but it
// is no longer SILENTLY swallowed: DEV-40 routes the rejection to Sentry so a
// dead backend-analytics pipeline (wrong host, revoked key, network egress
// block) is actually visible instead of looking like "no events happened."

import * as Sentry from "@sentry/node";

const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
// Same key as frontend NEXT_PUBLIC_POSTHOG_KEY (publishable, safe to use here).
const POSTHOG_KEY = process.env.POSTHOG_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;

export function capturePosthogEvent(
  event: string,
  distinctId: string | null,
  properties: Record<string, unknown> = {},
): void {
  if (!POSTHOG_KEY) return; // silently no-op if not configured

  const payload = {
    api_key: POSTHOG_KEY,
    event,
    distinct_id: distinctId || `anon-${crypto.randomUUID()}`,
    properties: {
      $lib: "newpmjobs-backend",
      ...properties,
    },
    timestamp: new Date().toISOString(),
  };

  fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => {
    // Non-fatal — analytics never breaks the user flow — but DEV-40: report it
    // so a broken capture pipeline isn't indistinguishable from "no events."
    console.error(`[posthog] capture failed for event "${event}":`, err);
    Sentry.captureException(err instanceof Error ? err : new Error(`PostHog capture failed for "${event}": ${String(err)}`), {
      tags: { area: "posthog.capture", event },
    });
  });
}
