import posthog from "posthog-js";

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  posthog.capture(event, properties);
}

export function identifyUser(email: string) {
  posthog.identify(email, { email });
}
