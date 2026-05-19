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

  // Helper: a NextResponse.redirect(...) is a fresh response and does NOT
  // inherit the cookies that Supabase's setAll callback already wrote onto
  // supabaseResponse. If we return a bare redirect, the refreshed session
  // cookies never reach the browser → next request the middleware sees no
  // user → user gets bounced to /login. This is the documented Supabase
  // SSR pitfall ("browser and server go out of sync, session terminates
  // prematurely"). Always route redirects through this helper so the
  // refreshed cookies ride along.
  function redirectPreservingSession(url: URL) {
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie);
    });
    return redirect;
  }

  // If authenticated and on login page, redirect to ?next= if safe, else /.
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    url.pathname = safeNext;
    url.search = "";
    return redirectPreservingSession(url);
  }

  // If no user and not on a public route, redirect to login (and remember
  // where they came from via ?next=).
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
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return redirectPreservingSession(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
