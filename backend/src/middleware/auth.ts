import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const jwtSecret = process.env.SUPABASE_JWT_SECRET;

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

  // Try local JWT verification first (no network call, ~0ms)
  if (jwtSecret) {
    try {
      const payload = jwt.verify(token, jwtSecret, {
        algorithms: ["HS256"],
      }) as jwt.JwtPayload;

      if (payload.sub) {
        req.userId = payload.sub;
        req.userEmail = (payload.email as string) || undefined;
        next();
        return;
      }
    } catch {
      // Local verification failed — fall back to Supabase API call
      console.warn("Local JWT verification failed, falling back to Supabase getUser()");
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
