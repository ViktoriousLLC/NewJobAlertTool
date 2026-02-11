const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Authenticated fetch wrapper that gets the JWT from a server-side
 * route (which can read HttpOnly cookies) and attaches it to API calls.
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  console.log("[apiFetch] starting for path:", path);
  console.log("[apiFetch] API_URL:", API_URL);

  try {
    // Get access token from server-side route (reads session from cookies)
    const tokenRes = await fetch("/api/auth/token");
    console.log("[apiFetch] token response status:", tokenRes.status);

    if (!tokenRes.ok) {
      console.log("[apiFetch] token not ok, redirecting to login");
      window.location.href = "/login";
      return new Promise(() => {});
    }

    const tokenData = await tokenRes.json();
    console.log("[apiFetch] got token:", tokenData.access_token ? "yes (length: " + tokenData.access_token.length + ")" : "null");

    if (!tokenData.access_token) {
      console.log("[apiFetch] no access_token, redirecting to login");
      window.location.href = "/login";
      return new Promise(() => {});
    }

    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${tokenData.access_token}`);

    const fullUrl = `${API_URL}${path}`;
    console.log("[apiFetch] fetching:", fullUrl);

    const res = await fetch(fullUrl, {
      ...options,
      headers,
    });

    console.log("[apiFetch] API response status:", res.status);

    if (res.status === 401) {
      console.log("[apiFetch] got 401, redirecting to login");
      window.location.href = "/login";
      return new Promise(() => {});
    }

    return res;
  } catch (err) {
    console.error("[apiFetch] error:", err);
    throw err;
  }
}
