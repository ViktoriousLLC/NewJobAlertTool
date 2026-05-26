import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { captureServerEvent } from "@/lib/serverAnalytics";

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
    // DEV-13: funnel step — user clicked the magic link.
    captureServerEvent("auth.signin_link_clicked", null, { type });

    const cookieStore = await cookies();
    // DEV-17: capture cookies Supabase wants to set so we can re-apply them
    // onto the redirect response WITH FULL ATTRIBUTES (maxAge, expires,
    // sameSite, etc.). PR #62 originally read from cookieStore.getAll()
    // which strips attributes, turning persistent sessions into session-only
    // cookies that died on browser close. Same pattern as middleware.ts
    // redirectPreservingSession.
    const cookiesToApply: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(toSet) {
            toSet.forEach(({ name, value, options }) => {
              // Keep Supabase's defaults: HttpOnly + Secure + SameSite=Lax + maxAge.
              // Browser JS reads the token via /api/auth/token instead.
              cookieStore.set(name, value, options);
              cookiesToApply.push({ name, value, options: options || {} });
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error) {
      // Re-apply the cookies Supabase wrote during verifyOtp onto the redirect
      // response, preserving every attribute. NextResponse.redirect() is a
      // fresh response and inherits nothing from cookieStore by default — the
      // user would land at `next` without a session (PR #62's original fix
      // copied from cookieStore.getAll() which silently dropped maxAge, making
      // sessions die on browser close — DEV-17).
      const response = NextResponse.redirect(`${origin}${next}`);
      for (const c of cookiesToApply) {
        response.cookies.set(c.name, c.value, c.options);
      }
      // DEV-13: funnel terminal — session established successfully.
      captureServerEvent("auth.signin_success", null, { type });
      return response;
    }

    console.error("Auth confirm verifyOtp failed:", error.message);
    Sentry.captureMessage(`Magic link verify failed: ${error.message}`, "warning");
    // DEV-13: funnel failure — verifyOtp errored. Reason in props.
    captureServerEvent("auth.signin_failure", null, { type, reason: error.message });
  }

  // Verification failed — redirect to login with error
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Magic link expired or already used. Please request a new one.")}`
  );
}
