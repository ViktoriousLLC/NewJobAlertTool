import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            // Keep Supabase's defaults: HttpOnly + Secure + SameSite=Lax.
            // Browser JS reads the token via /api/auth/token instead.
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Check session from local cookie (no network call to Supabase)
  // Safe: backend still verifies JWT on every API request
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const user = session?.user ?? null;

  // If authenticated and on login page, redirect to dashboard.
  // Honor the ?next= param when it's a safe same-origin relative path so
  // /login?next=/new-home actually lands the user back on /new-home after
  // sign-in. Anything that doesn't start with "/" (or starts with "//", which
  // is protocol-relative) falls back to "/" — prevents open-redirect abuse.
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    url.pathname = safeNext;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // If no user and not on a public route, redirect to login.
  // /new-home is the parallel preview of the job-first feed — public so
  // unauth visitors can browse and convert via Track-button → login flow.
  if (
    !user &&
    request.nextUrl.pathname !== "/" &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/new-home") &&
    !request.nextUrl.pathname.startsWith("/auth/callback") &&
    !request.nextUrl.pathname.startsWith("/auth/confirm") &&
    !request.nextUrl.pathname.startsWith("/privacy")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where the user was trying to go so the post-login redirect
    // above can send them back. Without this, signing in from a deep link
    // dumps you on / regardless of intent.
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
