import posthog from "posthog-js";

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  posthog.capture(event, properties);
}

/** SHA-256 hash for privacy-safe PostHog identification */
async function hashEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function identifyUser(email: string) {
  const hashedId = await hashEmail(email);
  posthog.identify(hashedId);
}
