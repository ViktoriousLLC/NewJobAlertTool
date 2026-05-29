// Active liveness verification for Sentry error reporting.
//
// WHY THIS EXISTS (DEV-27): Sentry.init({ dsn }) no-ops SILENTLY when the DSN is
// missing or malformed -- by design, so dev/test environments don't error. The
// consequence is that a broken Sentry config is indistinguishable from a healthy
// one: the dashboard just shows "no errors," which reads as good news. Backend
// error reporting sat completely dead from 2026-02-11 (when Sentry was added) to
// 2026-05-29 because SENTRY_DSN was never set on Railway, and nothing noticed.
// A later dashboard re-add truncated the DSN to a valid-looking but wrong project
// id, which the SDK ALSO swallows silently.
//
// The only reliable way to catch all three failure modes (missing / malformed /
// wrong-project) is to actually push an event through the ingest endpoint and
// check the HTTP response. The @sentry/node SDK cannot do this for us -- it is
// fire-and-forget and drops rejected events without surfacing the failure.

import { capturePosthogEvent } from "./posthog";

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
 * POST a synthetic event to the configured Sentry DSN's ingest endpoint and
 * verify it is accepted. Pure: no logging, no notifications.
 *
 * A correct DSN returns 200 + an event id. A missing/malformed DSN fails before
 * the request. A well-formed DSN pointing at a nonexistent project (e.g. the
 * truncated paste that bit us in DEV-27) returns a 4xx from ingest.
 *
 * All probe events share one fingerprint so they collapse into a single,
 * ignorable Sentry issue rather than spamming the issue stream.
 */
export async function probeSentryDsn(timeoutMs = 8000): Promise<SentryHealth> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return { ok: false, reason: "missing", detail: "SENTRY_DSN is not set" };

  const parts = parseDsn(dsn);
  if (!parts) {
    return { ok: false, reason: "malformed", detail: `SENTRY_DSN is not a valid DSN (length ${dsn.length})` };
  }

  const { publicKey, host, projectId } = parts;
  const url = `https://${host}/api/${projectId}/store/`;
  const event = {
    message: "sentry-dsn-liveness-probe",
    level: "info",
    platform: "node",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "production",
    server_name: process.env.RAILWAY_SERVICE_NAME || undefined,
    tags: { phase: "liveness-probe" },
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
 * Probe Sentry, log the result, and emit a PostHog event. Notification (admin
 * email) is left to the caller so this can be called fire-and-forget at boot
 * without an email dependency.
 *
 * PostHog -- not Sentry -- is the alert channel here on purpose: Sentry cannot
 * be trusted to report its own outage.
 */
export async function reportSentryHealth(source: "boot" | "daily"): Promise<SentryHealth> {
  const health = await probeSentryDsn();
  if (health.ok) {
    console.log(`[observability] Sentry ingest healthy via ${source} probe (event ${health.eventId})`);
    capturePosthogEvent("observability.sentry_healthy", null, { source });
  } else {
    console.error(`[observability] Sentry ingest UNHEALTHY (${source}): ${health.reason}: ${health.detail}`);
    capturePosthogEvent("observability.sentry_unhealthy", null, {
      source,
      reason: health.reason,
      detail: health.detail,
    });
  }
  return health;
}
