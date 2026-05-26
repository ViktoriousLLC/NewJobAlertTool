// Server-side PostHog event emission. Used by route handlers like
// /auth/confirm and /auth/callback where the client-side trackEvent helper
// (which depends on posthog-js bundled in the browser) isn't available.
//
// Posts directly to PostHog's capture endpoint via fetch — no SDK
// dependency. The project key is public-safe (it's already exposed in the
// client bundle via NEXT_PUBLIC_POSTHOG_KEY).
//
// Designed for the DEV-13 auth funnel:
//   auth.signin_email_sent      (client-side, login/page.tsx)
//   auth.signin_link_clicked    (server-side, /auth/confirm/route.ts)
//   auth.signin_success         (server-side, /auth/confirm/route.ts)
//   auth.signin_failure         (server-side, /auth/confirm/route.ts)

const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

/**
 * Send a PostHog event from a server-side context (route handlers, middleware).
 * Best-effort: failures are swallowed silently so analytics never breaks the
 * user-facing flow. Returns immediately; the fetch runs in the background.
 *
 * @param event Event name (e.g., "auth.signin_success")
 * @param distinctId Anonymous if not provided. Pass a stable hash for user-scoped events.
 * @param properties Extra properties to attach to the event.
 */
export function captureServerEvent(
  event: string,
  distinctId: string | null,
  properties: Record<string, unknown> = {},
): void {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return; // not configured — silently skip

  const payload = {
    api_key: apiKey,
    event,
    distinct_id: distinctId || `anon-${crypto.randomUUID()}`,
    properties: {
      $lib: "newpmjobs-server",
      ...properties,
    },
    timestamp: new Date().toISOString(),
  };

  // Fire-and-forget. Don't await — route handlers should respond immediately.
  fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Swallow. Analytics must never break the user flow.
  });
}
