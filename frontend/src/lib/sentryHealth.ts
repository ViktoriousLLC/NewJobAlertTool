// Active liveness verification for the frontend's Sentry error reporting.
//
// WHY THIS EXISTS (DEV-39, backport of backend DEV-27): Sentry.init({ dsn })
// no-ops SILENTLY when the DSN is missing or malformed -- by design, so dev/test
// environments don't error. A broken Sentry config is therefore
// indistinguishable from a healthy one: the dashboard just shows "no errors,"
// which reads as good news. The backend sat blind for 3.5 months this way, and
// the frontend's NEXT_PUBLIC_SENTRY_DSN was at one point silently truncated to a
// valid-looking but wrong-project value -- which the SDK ALSO swallows -- with
// nothing to catch it.
//
// The only reliable way to catch all three failure modes (missing / malformed /
// wrong-project) is to actually push an event through the ingest endpoint and
// check the HTTP response. @sentry/nextjs cannot do this for us: it is
// fire-and-forget and drops rejected events without surfacing the failure.
//
// This mirrors backend/src/lib/sentryHealth.ts. The frontend has two DSNs:
//   - NEXT_PUBLIC_SENTRY_DSN  (browser/client config; baked at build time)
//   - SENTRY_DSN              (server config; the Next.js server runtime)
// Both are probed -- the truncated value that bit us in the past was the
// NEXT_PUBLIC one.
//
// Reporting channel: console.error (visible in Vercel logs) + a PostHog
// `observability.sentry_unhealthy` event (the SAME alert channel the backend
// uses on purpose -- Sentry cannot be trusted to report its own outage). The
// frontend server runtime on Vercel has no Resend wiring, so unlike the backend
// it does NOT send an admin email; PostHog is the cross-channel alert.

export type SentryHealth =
  | { ok: true; eventId: string }
  | { ok: false; reason: "missing" | "malformed" | "rejected" | "error"; detail: string };

// Sentry DSN format: https://<publicKey>@<host>/<projectId>
function parseDsn(dsn: string): { publicKey: string; host: string; projectId: string } | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const host = u.host;
    const projectId = u.pathname.replace(/^\/+/, "");
    if (!publicKey || !host || !/^\d+$/.test(projectId)) return null;
    return { publicKey, host, projectId };
  } catch {
    return null;
  }
}

/**
 * POST a synthetic event to the given DSN's ingest endpoint and verify it is
 * accepted. Pure: no logging, no notifications.
 *
 * A correct DSN returns 200 + an event id. A missing/malformed DSN fails before
 * the request. A well-formed DSN pointing at a nonexistent project (e.g. a
 * truncated paste) returns a 4xx from ingest.
 *
 * All probe events share one fingerprint so they collapse into a single,
 * ignorable Sentry issue rather than spamming the issue stream.
 */
export async function probeSentryDsn(
  dsn: string | undefined,
  envVarName: string,
  timeoutMs = 8000,
): Promise<SentryHealth> {
  if (!dsn) return { ok: false, reason: "missing", detail: `${envVarName} is not set` };

  const parts = parseDsn(dsn);
  if (!parts) {
    return {
      ok: false,
      reason: "malformed",
      detail: `${envVarName} is not a valid DSN (length ${dsn.length})`,
    };
  }

  const { publicKey, host, projectId } = parts;
  const url = `https://${host}/api/${projectId}/store/`;
  const event = {
    message: "sentry-dsn-liveness-probe",
    level: "info",
    platform: "javascript",
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "production",
    server_name: process.env.VERCEL_REGION || undefined,
    tags: { phase: "liveness-probe", surface: "frontend", env_var: envVarName },
    // Collapse every probe into one Sentry issue so this never clutters the inbox.
    fingerprint: ["sentry-dsn-liveness-probe"],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=newpmjobs-liveness/1.0, sentry_key=${publicKey}`,
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });

    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, eventId: body.id || "accepted" };
    }
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      reason: "rejected",
      detail: `ingest endpoint returned HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`,
    };
  } catch (err) {
    return { ok: false, reason: "error", detail: err instanceof Error ? err.message : "unknown error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Emit a PostHog event directly via the capture endpoint. Mirrors the backend's
 * use of PostHog as the Sentry-outage alert channel, and reuses the same
 * public project key the rest of the frontend already exposes
 * (NEXT_PUBLIC_POSTHOG_KEY). Best-effort, fire-and-forget.
 *
 * Kept local (rather than importing serverAnalytics.captureServerEvent) because
 * this runs from instrumentation.ts at server start, where there is no request
 * cookie store and we want a stable, non-anonymous distinct id for the alert.
 */
async function capturePosthogEvent(
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return; // not configured -- silently skip
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

  try {
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: "observability-frontend",
        properties: { $lib: "newpmjobs-frontend-liveness", ...properties },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Swallow. The alert is best-effort; console.error below is the floor.
  }
}

/**
 * Probe BOTH frontend Sentry DSNs, log the result loudly, and emit a PostHog
 * event per DSN. Notification is PostHog + console only (no admin email --
 * Resend isn't wired into the Vercel frontend runtime; the backend's daily
 * probe owns the email channel).
 *
 * Fire-and-forget: callers (instrumentation.ts) must not block server startup
 * on this, and any throw is contained here.
 */
export async function reportFrontendSentryHealth(source: "boot"): Promise<void> {
  const targets: Array<{ envVarName: string; dsn: string | undefined }> = [
    { envVarName: "NEXT_PUBLIC_SENTRY_DSN", dsn: process.env.NEXT_PUBLIC_SENTRY_DSN },
    { envVarName: "SENTRY_DSN", dsn: process.env.SENTRY_DSN },
  ];

  await Promise.all(
    targets.map(async ({ envVarName, dsn }) => {
      const health = await probeSentryDsn(dsn, envVarName);
      if (health.ok) {
        console.log(
          `[observability] Frontend Sentry ingest healthy for ${envVarName} via ${source} probe (event ${health.eventId})`,
        );
        await capturePosthogEvent("observability.sentry_healthy", {
          source,
          surface: "frontend",
          env_var: envVarName,
        });
      } else {
        console.error(
          `[observability] Frontend Sentry ingest UNHEALTHY for ${envVarName} (${source}): ${health.reason}: ${health.detail}`,
        );
        await capturePosthogEvent("observability.sentry_unhealthy", {
          source,
          surface: "frontend",
          env_var: envVarName,
          reason: health.reason,
          detail: health.detail,
        });
      }
    }),
  );
}
