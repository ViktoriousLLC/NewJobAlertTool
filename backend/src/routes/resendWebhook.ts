// POST /api/webhooks/resend — Resend email-engagement webhook (DEV-65).
//
// Server-to-server webhook (NO JWT). Resend POSTs email lifecycle events here
// (sent / delivered / opened / clicked / bounced / complained). We verify the
// Svix signature, then forward each event to PostHog via capturePosthogEvent so
// email opens/clicks join the product analytics under the SAME person as the
// logged-in user.
//
// MOUNTING (see index.ts): this route is registered with
// express.raw({ type: "application/json" }) BEFORE the global express.json(),
// because Svix signature verification must run over the EXACT raw bytes Resend
// signed — re-serialized JSON would change whitespace/key order and break the
// HMAC. So req.body here is a Buffer, not a parsed object.
//
// distinctId: hashEmail(recipient) — byte-for-byte the same SHA-256 hex the
// frontend identify()s the user under (frontend/src/lib/analytics.ts), so an
// email event stitches to the user's existing PostHog person.
//
// Resilience: never throw on a single event — log + Sentry-breadcrumb and
// continue. Once the signature is valid we ALWAYS return 200 so Resend doesn't
// retry-storm us over a downstream hiccup. Unverified → 401.

import * as Sentry from "@sentry/node";
import type { Request, Response } from "express";
import { capturePosthogEvent } from "../lib/posthog";
import { hashEmail } from "../lib/hashEmail";
import { verifySvixSignature } from "../lib/svixVerify";

// Map Resend event `type` → the PostHog event name we emit.
const EVENT_NAME_BY_TYPE: Record<string, string> = {
  "email.sent": "email_sent",
  "email.delivered": "email_delivered",
  "email.opened": "email_opened",
  "email.clicked": "email_clicked",
  "email.bounced": "email_bounced",
  "email.complained": "email_complained",
};

// Resend "to" can be a string or an array of strings; normalize to the first
// recipient (these are 1:1 transactional sends, so there's a single recipient).
function firstRecipient(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const to = data.to;
  if (typeof to === "string" && to.trim()) return to.trim();
  if (Array.isArray(to)) {
    const first = to.find((x) => typeof x === "string" && x.trim());
    if (typeof first === "string") return first.trim();
  }
  // Some payloads use `email` instead of `to`.
  const email = data.email;
  if (typeof email === "string" && email.trim()) return email.trim();
  return null;
}

function headerStr(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

export function resendWebhookHandler(req: Request, res: Response): void {
  // req.body is a Buffer because this route is mounted with express.raw().
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : "";

  const verified = verifySvixSignature(
    rawBody,
    {
      id: headerStr(req, "svix-id"),
      timestamp: headerStr(req, "svix-timestamp"),
      signature: headerStr(req, "svix-signature"),
    },
    process.env.RESEND_WEBHOOK_SECRET,
  );

  if (!verified) {
    // Could be a missing secret, a forged request, or a stale timestamp. Don't
    // leak which — just reject. (A missing RESEND_WEBHOOK_SECRET fails closed.)
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Signature is valid: parse the (already-verified) raw body. From here on we
  // ALWAYS answer 200 — Resend should not retry over our own downstream issues.
  let payload: { type?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    // Verified signature but unparseable body — log and ack so Resend stops.
    console.error("[resend-webhook] verified body failed to parse:", err);
    Sentry.captureException(err, { tags: { area: "resend.webhook", phase: "parse" } });
    res.status(200).json({ received: true, processed: false });
    return;
  }

  try {
    const type = typeof payload.type === "string" ? payload.type : "";
    const eventName = EVENT_NAME_BY_TYPE[type];
    const data = payload.data;

    if (!eventName) {
      // Unknown/unhandled event type — ack without forwarding.
      console.log(`[resend-webhook] ignoring unhandled event type "${type}"`);
      res.status(200).json({ received: true, processed: false });
      return;
    }

    const recipient = firstRecipient(data);
    const distinctId = recipient ? hashEmail(recipient) : null;

    // Build PostHog properties. `link` only exists on click events
    // (data.click.link); subject/tags/email_id are present on all.
    const click = (data?.click ?? undefined) as Record<string, unknown> | undefined;
    const properties: Record<string, unknown> = {
      email_id: data?.email_id ?? null,
      subject: data?.subject ?? null,
      tags: data?.tags ?? null,
      // Surface the recipient domain (NOT the raw email — PII) for funnels.
      recipient_domain: recipient && recipient.includes("@") ? recipient.split("@")[1] : null,
    };
    if (type === "email.clicked" && click && typeof click.link === "string") {
      properties.link = click.link;
    }

    capturePosthogEvent(eventName, distinctId, properties);
    console.log(
      `[resend-webhook] ${type} → ${eventName} (email_id=${String(data?.email_id ?? "?")})`,
    );

    res.status(200).json({ received: true, processed: true });
  } catch (err) {
    // Never throw on one event — log, report, and still 200 so Resend doesn't
    // retry over a transient backend hiccup.
    console.error("[resend-webhook] error processing event:", err);
    Sentry.captureException(err, { tags: { area: "resend.webhook", phase: "process" } });
    res.status(200).json({ received: true, processed: false });
  }
}
