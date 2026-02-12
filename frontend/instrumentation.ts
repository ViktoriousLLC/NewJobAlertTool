export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

export const onRequestError = async (...args: unknown[]) => {
  const { captureRequestError } = await import("@sentry/nextjs");
  // @ts-expect-error - Sentry types may not match exactly
  return captureRequestError(...args);
};
