import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { captureServerEvent, getPostHogDistinctId } from "@/lib/serverAnalytics";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const cookieStore = await cookies();
    // DEV-18: mirror /auth/confirm instrumentation so OAuth (PKCE) signins
    // also flow through the DEV-13 funnel. Without this, callback-route
    // signins were invisible to monitoring.
    const phDistinctId = getPostHogDistinctId(cookieStore);
    captureServerEvent("auth.signin_link_clicked", phDistinctId, { flow: "pkce" });
    // DEV-17: track cookies via setAll so we can re-apply onto the redirect
    // WITH FULL ATTRIBUTES (maxAge, expires, etc.). PR #62's original fix
    // read from cookieStore.getAll() which strips attributes and broke
    // session persistence. Same pattern as middleware.ts redirectPreservingSession.
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
              cookieStore.set(name, value, options);
              cookiesToApply.push({ name, value, options: options || {} });
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Re-apply with FULL attributes (DEV-17 fix). See /auth/confirm for the
      // explanation of why cookieStore.getAll() can't be used here.
      const response = NextResponse.redirect(`${origin}/`);
      for (const c of cookiesToApply) {
        response.cookies.set(c.name, c.value, c.options);
      }
      captureServerEvent("auth.signin_success", phDistinctId, { flow: "pkce" });
      return response;
    }

    // PKCE exchange failed — likely opened in a different browser/device than where
    // the magic link was requested, or the link expired (5 min validity for codes).
    console.error("Auth callback code exchange failed:", error.message);
    Sentry.captureMessage(`Magic link PKCE exchange failed: ${error.message}`, "warning");
    captureServerEvent("auth.signin_failure", phDistinctId, { flow: "pkce", reason: error.message });
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Magic link verification failed. Please open the link in the same browser where you requested it, or request a new one.")}`
    );
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Invalid magic link. Please request a new one.")}`
  );
}
