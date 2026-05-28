// Server-side PostHog event emission for the Express backend.
//
// Backend mirror of the frontend serverAnalytics.ts helper. Posts directly
// to PostHog's capture endpoint via fetch; no SDK dependency.
//
// Used for visibility on backend-only paths that the frontend can't track:
//   auth.jwt_verify_path (local | fallback | unauthorized)
//   future: rate-limit hits, scraper events at the API edge, etc.
//
// Fire-and-forget. Failures are swallowed so analytics never breaks
// the request lifecycle.

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
  }).catch(() => {
    // Swallow; analytics never breaks the user flow.
  });
}
