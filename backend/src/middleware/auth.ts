import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { capturePosthogEvent } from "../lib/posthog";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

// Supabase has migrated away from the legacy HS256 shared secret. Tokens are
// now signed with asymmetric keys (ES256/RS256). We fetch and cache the
// public keys from the project's JWKS endpoint.
//
// The legacy SUPABASE_JWT_SECRET env var is no longer used. Until 2026-05-28
// every authed request was logging "Local JWT verification failed (invalid
// algorithm), falling back to Supabase getUser()" because the HS256 whitelist
// rejected the new asymmetric tokens. Result: every request paid a ~150ms
// network round-trip we didn't need.
const jwksUrl = supabaseUrl ? new URL(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`) : null;
const jwks = jwksUrl ? createRemoteJWKSet(jwksUrl) : null;

// Issuer claim Supabase tokens carry. Derived from project URL.
const expectedIssuer = supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/auth/v1` : undefined;

// Separate client using anon key for verifying user JWTs (fallback only)
const authClient = createClient(supabaseUrl, supabaseAnonKey);

// DEV-47: these prod-only guards gate on the Railway-injected
// RAILWAY_ENVIRONMENT_NAME instead of NODE_ENV. NODE_ENV was unset on Railway
// for months, so BOTH the fail-closed check and the JWKS boot probe below were
// dead code in production — they never ran. The platform-injected var is always
// present on a Railway service and can't be silently cleared.
const isProdRuntime = process.env.RAILWAY_ENVIRONMENT_NAME === "production";

// Fail-closed at boot if we can't verify JWTs. Without proper verification
// every request silently falls back to a 150ms Supabase API call which masks
// the misconfiguration. Better to crash early than degrade silently.
if (!jwksUrl && isProdRuntime) {
  throw new Error(
    "SUPABASE_URL is required in production to construct JWKS endpoint. Set it in Railway env vars."
  );
}

// Best-effort boot probe: warm the JWKS cache + surface failures at startup.
// Doesn't crash on probe failure (network might be temporarily flaky); just
// logs + Sentry so we notice. The first real request would catch a hard failure.
if (jwks && isProdRuntime) {
  (async () => {
    try {
      // Pass a dummy token to trigger JWKS fetch. We expect verification to
      // fail (bad token) but JWKS load itself should succeed.
      await jwtVerify("dummy", jwks, {}).catch(() => undefined);
      console.log("[auth] JWKS endpoint reachable at", jwksUrl!.href);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error("[auth] JWKS probe failed:", msg);
      Sentry.captureMessage(`Boot JWKS probe failed: ${msg}`, {
        level: "error",
        tags: { phase: "auth-boot" },
      });
    }
  })();
}

// Extend Express Request to include userId and userEmail
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  // Try local JWKS-based verification first (~0ms after first JWKS fetch).
  // Validates signature + algorithm + exp + audience + issuer.
  if (jwks) {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        audience: "authenticated",
        issuer: expectedIssuer,
      });

      if (payload.sub) {
        req.userId = payload.sub;
        req.userEmail = (payload.email as string) || undefined;
        capturePosthogEvent("auth.jwt_verify_path", payload.sub, { path: "local" });
        next();
        return;
      }
    } catch (err) {
      // Local verification failed; fall back to Supabase API call.
      // Tagged so a Sentry alert rule can fire if this becomes frequent
      // (which would mean JWKS rotation drift or actual attempted forgery).
      const message = err instanceof Error ? err.message : "unknown";
      console.warn(`[auth] JWKS verify failed (${message}); falling back to Supabase getUser()`);
      Sentry.captureMessage(`JWT JWKS verify failed: ${message}`, {
        level: "warning",
        tags: { phase: "auth-fallback" },
      });
    }
  }

  // Fallback: verify via Supabase API (~50-150ms network call)
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error || !user) {
    capturePosthogEvent("auth.jwt_verify_path", null, { path: "unauthorized" });
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  req.userId = user.id;
  req.userEmail = user.email || undefined;
  capturePosthogEvent("auth.jwt_verify_path", user.id, { path: "fallback" });
  next();
}
