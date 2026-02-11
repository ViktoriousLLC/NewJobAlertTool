import { supabase } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Authenticated fetch wrapper that attaches the user's JWT
 * and redirects to /login on 401.
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  // Try getSession first, then fall back to getUser + refreshSession
  let {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // Session not in memory — try refreshing from cookies
    const { data } = await supabase.auth.refreshSession();
    session = data.session;
  }

  if (!session) {
    window.location.href = "/login";
    return new Promise(() => {});
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    // Token may have expired — try one refresh
    const { data } = await supabase.auth.refreshSession();
    if (data.session) {
      headers.set("Authorization", `Bearer ${data.session.access_token}`);
      const retry = await fetch(`${API_URL}${path}`, { ...options, headers });
      if (retry.status !== 401) return retry;
    }
    window.location.href = "/login";
    return new Promise(() => {});
  }

  return res;
}
