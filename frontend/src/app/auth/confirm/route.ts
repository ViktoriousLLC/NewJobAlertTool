import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

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
  const next = searchParams.get("next") ?? "/";

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
              cookieStore.set(name, value, { ...options, httpOnly: false });
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error("Auth confirm verifyOtp failed:", error.message);
  }

  // Verification failed — redirect to login with error
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Magic link expired or already used. Please request a new one.")}`
  );
}
