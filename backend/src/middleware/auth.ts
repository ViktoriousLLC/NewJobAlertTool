import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const jwtSecret = process.env.SUPABASE_JWT_SECRET;

// Fail-closed at boot if the JWT secret is missing in production. Without it,
// every request silently degrades to a 150ms Supabase API call, which masks
// the misconfiguration and burns latency. Better to crash early than to
// silently downgrade in production.
if (!jwtSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "SUPABASE_JWT_SECRET is required in production. Set it in the Railway env vars."
  );
}

// Issuer claim Supabase tokens carry. Derived from project URL.
const expectedIssuer = supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/auth/v1` : undefined;

// Separate client using anon key for verifying user JWTs (fallback only)
const authClient = createClient(supabaseUrl, supabaseAnonKey);

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

  // Try local JWT verification first (no network call, ~0ms).
  // Validates signature + algorithm + exp + audience + issuer.
  if (jwtSecret) {
    try {
      const payload = jwt.verify(token, jwtSecret, {
        algorithms: ["HS256"],
        audience: "authenticated",
        issuer: expectedIssuer,
      }) as jwt.JwtPayload;

      if (payload.sub) {
        req.userId = payload.sub;
        req.userEmail = (payload.email as string) || undefined;
        next();
        return;
      }
    } catch (err) {
      // Local verification failed — fall back to Supabase API call.
      // Alert so we notice if this becomes a regular occurrence (could mean
      // a secret rotation, an issuer mismatch, or attempted forgery).
      const message = err instanceof Error ? err.message : "unknown";
      console.warn(`Local JWT verification failed (${message}), falling back to Supabase getUser()`);
      Sentry.captureMessage(`JWT local verify failed: ${message}`, {
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
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  req.userId = user.id;
  req.userEmail = user.email || undefined;
  next();
}
