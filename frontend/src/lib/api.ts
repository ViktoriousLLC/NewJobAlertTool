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
  // getUser() reliably reads from cookies and populates the session in memory
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    window.location.href = "/login";
    return new Promise(() => {});
  }

  // After getUser(), the session should be in memory
  const { data: { session } } = await supabase.auth.getSession();

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
    window.location.href = "/login";
    return new Promise(() => {});
  }

  return res;
}
