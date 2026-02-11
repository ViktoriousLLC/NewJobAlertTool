const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Authenticated fetch wrapper that gets the JWT from a server-side
 * route (which can read HttpOnly cookies) and attaches it to API calls.
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  // Get access token from server-side route (reads session from cookies)
  const tokenRes = await fetch("/api/auth/token");

  if (!tokenRes.ok) {
    window.location.href = "/login";
    return new Promise(() => {});
  }

  const { access_token } = await tokenRes.json();

  if (!access_token) {
    window.location.href = "/login";
    return new Promise(() => {});
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${access_token}`);

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
