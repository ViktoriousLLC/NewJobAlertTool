// Privacy-safe PostHog distinctId derived from a user's email.
//
// MUST stay byte-for-byte identical to the frontend's hashEmail in
// frontend/src/lib/analytics.ts, because that is the distinctId the logged-in
// user is identify()'d under in the browser. Any backend-emitted email event
// (e.g. the Resend webhook) has to hash the recipient address the EXACT same
// way so the event stitches to the SAME PostHog person — not a second
// orphaned person.
//
// Frontend reference (Web Crypto):
//   const data = new TextEncoder().encode(email.toLowerCase().trim());
//   const hash = await crypto.subtle.digest("SHA-256", data);
//   Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("")
//
// That is: lowercase + trim, UTF-8 bytes, SHA-256, lowercase hex (64 chars).
// Node's crypto.createHash("sha256").update(s, "utf8").digest("hex") produces
// the identical lowercase-hex digest for the identical input string.

import { createHash } from "crypto";

/** SHA-256 hex of the normalized email — matches frontend analytics.ts exactly. */
export function hashEmail(email: string): string {
  return createHash("sha256")
    .update(email.toLowerCase().trim(), "utf8")
    .digest("hex");
}
