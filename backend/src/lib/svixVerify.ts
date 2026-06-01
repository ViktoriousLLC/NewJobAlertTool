// Svix webhook signature verification (used by Resend webhooks).
//
// Resend signs webhook deliveries with the Svix scheme and sends three headers:
//   svix-id          — unique message id
//   svix-timestamp   — unix seconds when the message was sent
//   svix-signature   — space-separated list of `v1,<base64sig>` entries
//
// The signed content is exactly: `${svix_id}.${svix_timestamp}.${rawBody}`,
// HMAC-SHA256'd with the webhook signing secret. The secret arrives as
// `whsec_<base64>` — the bytes after the `whsec_` prefix are base64 and are the
// actual HMAC key. The computed signature is base64 and is compared
// (constant-time) against EACH v1 entry; any match passes.
//
// We implement the documented scheme directly with Node crypto rather than
// adding the `svix` npm dependency: it is a small, self-contained algorithm,
// it avoids a supply-chain addition, and it mirrors the existing
// safeCompareSecret() constant-time pattern already in index.ts.
//
// Spec: https://docs.svix.com/receiving/verifying-payloads/how-manual
// Resend webhook signing is Svix under the hood.

import { createHmac, timingSafeEqual } from "crypto";

const WHSEC_PREFIX = "whsec_";
// Reject messages whose timestamp is too far from now (replay protection),
// matching Svix's default tolerance.
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

/**
 * Verify a Svix-signed webhook payload.
 *
 * @param rawBody  the EXACT raw request body bytes/string used for the HMAC
 *                 (must not be re-serialized JSON — whitespace must match)
 * @param headers  svix-id / svix-timestamp / svix-signature
 * @param secret   the RESEND_WEBHOOK_SECRET, e.g. `whsec_...`
 * @returns true only if a valid v1 signature matches and the timestamp is fresh
 */
export function verifySvixSignature(
  rawBody: string,
  headers: SvixHeaders,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  // Replay protection: timestamp must be a sane unix-seconds value near now.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > DEFAULT_TOLERANCE_SECONDS) return false;

  // The signing key is base64 after the optional `whsec_` prefix.
  const secretBytes = Buffer.from(
    secret.startsWith(WHSEC_PREFIX) ? secret.slice(WHSEC_PREFIX.length) : secret,
    "base64",
  );
  if (secretBytes.length === 0) return false;

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes)
    .update(signedContent, "utf8")
    .digest(); // raw bytes; compare against decoded candidate bytes

  // svix-signature is space-separated `v1,<base64sig>` entries (versioned so a
  // future scheme can roll forward). Any matching v1 entry passes.
  for (const part of signature.split(" ")) {
    const commaIdx = part.indexOf(",");
    if (commaIdx === -1) continue;
    const version = part.slice(0, commaIdx);
    const sig = part.slice(commaIdx + 1);
    if (version !== "v1" || !sig) continue;

    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (candidate.length !== expected.length) continue;
    // Constant-time compare — never short-circuit on first differing byte.
    if (timingSafeEqual(candidate, expected)) return true;
  }

  return false;
}
