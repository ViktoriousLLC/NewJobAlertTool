import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Build CSP dynamically from env vars
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Extract just the origin (protocol + host) from API URL
const apiOrigin = apiUrl.startsWith("http") ? new URL(apiUrl).origin : apiUrl;

// Supabase needs both HTTPS and WSS for Realtime
const supabaseWss = supabaseUrl.replace("https://", "wss://");

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://www.google.com",
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin} ${supabaseUrl} ${supabaseWss} https://us.i.posthog.com https://us-assets.i.posthog.com https://o4510870199730176.ingest.us.sentry.io`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
});
