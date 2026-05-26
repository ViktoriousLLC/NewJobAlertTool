import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";

/**
 * Token-hash based auth confirmation — works cross-device (no PKCE code verifier needed).
 *
 * The Supabase email template should link here:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next={{ .RedirectTo }}
 *
 * Unlike /auth/callback (which uses PKCE and requires the same browser),
 * this route verifies the token directly via verifyOtp().
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next") ?? "/";
  // Prevent open redirect — only allow relative paths (not protocol-relative "//evil.com")
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (token_hash && type) {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              // Keep Supabase's defaults: HttpOnly + Secure + SameSite=Lax.
              // Browser JS reads the token via /api/auth/token instead.
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error) {
      // Supabase SSR writes session cookies onto cookieStore via the setAll
      // callback above, but NextResponse.redirect() is a fresh response object
      // and inherits none of them. Copy them onto the redirect explicitly,
      // otherwise the browser receives a 302 with no Set-Cookie and the user
      // lands at `next` as an unauthenticated visitor (last_sign_in_at stays
      // NULL). This is the same class of bug PR #26 fixed in middleware.ts
      // via redirectPreservingSession() but never backported here.
      const response = NextResponse.redirect(`${origin}${next}`);
      for (const cookie of cookieStore.getAll()) {
        response.cookies.set(cookie);
      }
      return response;
    }

    console.error("Auth confirm verifyOtp failed:", error.message);
    Sentry.captureMessage(`Magic link verify failed: ${error.message}`, "warning");
  }

  // Verification failed — redirect to login with error
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Magic link expired or already used. Please request a new one.")}`
  );
}
