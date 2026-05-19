# Auth Middleware — READ BEFORE EDITING

This sidecar collects everything needed before touching `backend/src/middleware/auth.ts` or any auth-adjacent flow. CLAUDE.md keeps only the 1-line architecture pointer.

## Magic Link Flow

- **No passwords.** Email → `/auth/confirm` verifies `token_hash` via `verifyOtp()` → JWT in HttpOnly cookies.
- **Legacy PKCE** fallback at `/auth/callback` — same-browser only.
- **Email template** (Supabase Dashboard): `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink`
- **Token flow**: Browser can't read HttpOnly cookies → `apiFetch` calls `/api/auth/token` server route → caches in memory.
- **Protected routes**: Frontend `middleware.ts` redirects to `/login` except `/`, `/auth/callback`, `/auth/confirm`, `/privacy`.

## Backend JWT Verification

- `requireAuth` middleware does **local JWT verification** via `SUPABASE_JWT_SECRET` (~0ms), fallback to Supabase API (~150ms).
- **Pinned algorithm**: HS256.
- **Validates** `audience: "authenticated"` and `issuer: <supabase-url>/auth/v1`.
- **Fails closed at boot** in production if `SUPABASE_JWT_SECRET` missing.
- Sentry warning fires when local-verify fails and code falls back to Supabase API.

## Data Scoping

- Companies are a **shared catalog**.
- Users subscribe via `user_subscriptions`.
- Dashboard/jobs filtered by subscription.
- **Never trust client-supplied `user_id`** — always derive from JWT.

## Cookies

- **HttpOnly is enforced** in `frontend/middleware.ts`, `auth/confirm`, `auth/callback`. Supabase defaults preserved.
- Browser JS reads tokens via `/api/auth/token` server route — never directly.
- **Do NOT override `httpOnly: false` on any cookie set call.** The bridge route exists by design.

## Env Vars

- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY` — **must be `service_role`, NOT `anon`** (anon key causes empty results for user-scoped queries).
- `SUPABASE_JWT_SECRET` — required in prod; fails closed at boot if missing.

## Auth Hardening Notes

- Open-redirect prevention on `/auth/confirm`.
- HTML-escaped user input in emails.
- PII removed from logs.

## Cron / Shared-Secret Bearer Tokens

- Use `safeCompareSecret()` in `backend/src/index.ts` (constant-time `crypto.timingSafeEqual` with length equalization).
- Applied to `/api/cron/trigger` and `/api/admin/add-company`.
- Reuse for future Stripe/Twilio webhook signature verification.

## Gotchas

- **HttpOnly cookies**: Browser JS can't read them. Use `/api/auth/token` server route.
- **CORS + www**: Backend CORS must allow both root and www origins. Code auto-adds www variant from `FRONTEND_URL`.
- **Supabase redirect URLs**: Need all 4 (root + www) × (callback + confirm) configured in Supabase Dashboard.
- **SUPABASE_SERVICE_KEY**: Confirm it's `service_role` key. Anon key silently breaks user-scoped queries (returns empty).
