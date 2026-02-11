const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Cache the access token in memory to avoid repeated /api/auth/token calls
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string | null> {
  // Return cached token if still fresh (refresh 60s before expiry)
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const res = await fetch("/api/auth/token");
  if (!res.ok) return null;

  const { access_token } = await res.json();
  if (!access_token) return null;

  // Parse JWT expiry (payload is the second base64 segment)
  try {
    const payload = JSON.parse(atob(access_token.split(".")[1]));
    tokenExpiresAt = payload.exp * 1000;
  } catch {
    // If parsing fails, cache for 5 minutes
    tokenExpiresAt = Date.now() + 5 * 60_000;
  }

  cachedToken = access_token;
  return access_token;
}

/**
 * Authenticated fetch wrapper that gets the JWT from a server-side
 * route (which can read HttpOnly cookies) and attaches it to API calls.
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();

  if (!token) {
    window.location.href = "/login";
    return new Promise(() => {});
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    // Token might be stale — clear cache and retry once
    cachedToken = null;
    tokenExpiresAt = 0;
    const freshToken = await getAccessToken();
    if (freshToken) {
      headers.set("Authorization", `Bearer ${freshToken}`);
      const retry = await fetch(`${API_URL}${path}`, { ...options, headers });
      if (retry.status !== 401) return retry;
    }
    window.location.href = "/login";
    return new Promise(() => {});
  }

  return res;
}
