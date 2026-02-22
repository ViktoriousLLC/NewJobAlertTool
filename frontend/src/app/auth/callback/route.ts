import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
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

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }

    // PKCE exchange failed — likely opened in a different browser/device than where
    // the magic link was requested, or the link expired (5 min validity for codes).
    console.error("Auth callback code exchange failed:", error.message);
    Sentry.captureMessage(`Magic link PKCE exchange failed: ${error.message}`, "warning");
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Magic link verification failed. Please open the link in the same browser where you requested it, or request a new one.")}`
    );
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Invalid magic link. Please request a new one.")}`
  );
}
