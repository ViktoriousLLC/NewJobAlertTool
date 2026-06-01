# Routes Subsystem — READ BEFORE EDITING

This sidecar collects everything needed before touching `backend/src/routes/*.ts`. CLAUDE.md keeps the API endpoint table for top-level navigation.

## Data Isolation (mandatory pattern)

Every read endpoint on user-scoped or subscription-gated data MUST check the requester's subscription before returning.

**Pattern:** load `user_subscriptions` for `req.userId`, return 403 if target not in list.

**Applies to:**
- `GET /api/companies/:id`
- `POST /api/favorites/:jobId`
- `POST /api/issues`
- Any new endpoint accepting a `company_id` or `seen_job_id` path param

**Rule:** Never trust client-supplied `user_id`; always derive from JWT.

## Body Limits

- Global: `express.json({ limit: "256kb" })`
- `/api/help.message` ≤ 5000 chars
- `/api/issues.description` ≤ 5000 chars

## Companies CRUD Specifics

- **Dedup on URL domain**, not name. ATS URLs use `hostname/slug` key (e.g., `greenhouse.io/discord`).
- **`platform_type` and `platform_config` are NEVER trusted from client body** in `POST /api/companies`. Always re-detect server-side. Trusting them = SSRF amplification (auth user injects arbitrary `baseUrl` that daily cron then dereferences). Fixed in PR #16.
- **Pre-checked `jobs` array** from `/check` IS trusted (user already saw and confirmed those).
- **10/user submission limit** in `POST /api/companies` (admin bypass). Rate limit via `user_new_company_submissions` table.

## Check-Then-Add Flow

States: `input` → `checking` → `preview` → `retry`

1. User enters URL only (name auto-detected via `detectCompanyName`)
2. `POST /api/companies/check` scrapes without saving → returns preview with `detection_method` + `confidence` fields
3. User confirms → `POST /api/companies` with pre-checked jobs (skips re-scrape; platform info re-detected server-side)
4. "No, Try Again" → retry with feedback → "Cancel" files feedback via `/api/help`
5. URL match → offers to subscribe to existing company

## Admin Endpoints

- `GET /api/admin/*` requires `req.userEmail === ADMIN_EMAIL`.
- `ADMIN_EMAIL` from env var with hardcoded fallback in `lib/constants.ts`.
- Admin hard-delete: `DELETE /api/companies/{id}?hard=true` → CASCADE deletes jobs, subscriptions, etc.

## Resend Webhook (DEV-65, `POST /api/webhooks/resend`)

Server-to-server webhook that streams Resend email-engagement events into PostHog so email **opens/clicks** join the product analytics. **NO JWT** — it is authenticated by the Svix signature Resend sends, not a bearer token.

- **Handler:** `backend/src/routes/resendWebhook.ts` (a bare handler, not an `express.Router`).
- **Mounting (critical):** registered in `index.ts` with `express.raw({ type: "application/json" })` **BEFORE** the global `express.json()` and **before** the `/api/` rate limiter. The Svix HMAC is computed over the EXACT raw request bytes — if `express.json()` parsed + re-serialized the body first, the signature would never match. So for this one path `req.body` is a `Buffer`; every other route still gets parsed JSON, and the 256kb global JSON limit is untouched. It sits ahead of the rate limiter so a legitimate burst of deliveries isn't 429'd (the route is signature-gated, not auth-gated).
- **Signature verification:** `backend/src/lib/svixVerify.ts` implements the documented Svix scheme directly (no `svix` npm dependency): secret is base64 after the `whsec_` prefix; `signedContent = ${svix-id}.${svix-timestamp}.${rawBody}`; HMAC-SHA256 → base64; constant-time compare (`timingSafeEqual`) against each space-separated `v1,<sig>` entry in the `svix-signature` header. Also enforces a ±5 min timestamp tolerance (replay protection). Reads the secret from **`RESEND_WEBHOOK_SECRET`** (the `whsec_...` value from the Resend dashboard). Unverified → **401** (fails closed if the secret is unset).
- **Headers Resend sends:** `svix-id`, `svix-timestamp`, `svix-signature`.
- **Events handled:** `email.sent` → `email_sent`, `email.delivered` → `email_delivered`, `email.opened` → `email_opened`, `email.clicked` → `email_clicked`, `email.bounced` → `email_bounced`, `email.complained` → `email_complained`. Unknown types are ack'd (200) without forwarding.
- **distinctId:** `hashEmail(recipient)` from `backend/src/lib/hashEmail.ts` — SHA-256 hex of `email.toLowerCase().trim()`, **byte-for-byte identical** to the frontend `hashEmail` in `frontend/src/lib/analytics.ts` that the logged-in user is `identify()`'d under, so an email event stitches to the SAME PostHog person. Recipient is read from `data.to` (string or array) or `data.email`.
- **PostHog properties:** `{ email_id, subject, tags, recipient_domain }`, plus `link` on `email.clicked` (from `data.click.link` — `email.opened` has NO nested object). `recipient_domain` (not the raw email) is surfaced for funnels; the raw address stays out of properties as PII, only the hash is the distinctId.
- **Resilience:** once the signature is valid the route ALWAYS returns **200** (so Resend doesn't retry-storm over a downstream hiccup); a single bad event is logged + sent to Sentry and skipped, never thrown.
- **Activation (one-time, manual):** enable Open + Click tracking on the sending domain in Resend, register the endpoint `https://api.newpmjobs.com/api/webhooks/resend`, copy its Signing Secret into `RESEND_WEBHOOK_SECRET` on Railway prod.

## Subscribe Semantics

- **`POST /api/subscriptions`** (body `{ company_ids: string[] }`) upserts subscriptions, bumps `subscriber_count`, sets `is_active=true`, then **fires a fire-and-forget background scrape** (`scrapeCompaniesByIds` from `jobs/dailyCheck`, NO email) for just-subscribed companies that have zero jobs and aren't `scrape_blocked`, capped at 25 (DEV-54). So a freshly-added catalog company populates within minutes instead of waiting for the 14:00 cron. The daily cron is the guaranteed backstop; the scrape is idempotent. Response: `{ success, subscribed, populating }`.
- Don't `await` the scrape — it would block the response (and a large bulk add would blow past the Cloudflare ~100s timeout). Fire-and-forget + `.catch(Sentry)` is intentional.

## Delete Semantics

- **Dashboard "Remove"** = unsubscribe only. Updates `subscriber_count` and `is_active`.
- **Companies with 0 subscribers** stay in catalog, keep getting scraped.
- **Admin hard-delete** is the only true delete path.

## Endpoints (full reference)

All routes require `Authorization: Bearer <token>` unless noted.

```
# Companies (user-scoped via subscriptions)
GET    /api/companies                    — User's subscribed companies
GET    /api/companies/{id}               — Company + jobs + next_company
POST   /api/companies/check              — Preview scrape (no DB write). Body: {careers_url, feedback?}
POST   /api/companies                    — Add company (auto-subscribe, 10/user limit). Body: {name, careers_url, jobs?}
DELETE /api/companies/{id}               — Unsubscribe only. Admin: ?hard=true deletes from catalog.

# Catalog / Subscriptions
GET    /api/catalog                      — All companies (no user filter)
GET    /api/subscriptions                — User's subscribed company IDs
POST   /api/subscriptions                — Subscribe. Body: {company_ids: []}
DELETE /api/subscriptions/{companyId}    — Unsubscribe

# Jobs / Favorites
GET    /api/jobs                         — Active jobs across subscribed companies
GET    /api/favorites                    — User's favorited job IDs
POST   /api/favorites/{jobId}            — Star a job
DELETE /api/favorites/{jobId}            — Unstar

# Preferences / Help / Issues
GET    /api/preferences                  — Get email prefs (creates default if none)
PUT    /api/preferences                  — Body: {email_frequency: "daily|weekly|off"}
POST   /api/help                         — Filed to Linear (User Feedback, Inbox) + email to admin. Body: {issue_type, message, page_url}
POST   /api/issues                       — Filed to Linear (User Feedback, Inbox) + email to admin. Body: {company_id, issue_type, description}

# Compensation (levels.fyi, 3-tier cache: memory 1hr → DB 24hr → live fetch)
GET    /api/compensation                 — Batch comp for subscribed companies
GET    /api/compensation/{companyName}   — Single company comp

# Admin (requires ADMIN_EMAIL match)
GET    /api/admin/stats                  — Users, companies, jobs, errors
GET    /api/admin/issues                 — Scrape issues + help submissions
GET    /api/admin/companies              — All companies for management (with hard-delete)
GET    /api/admin/users                  — User list + subs + email prefs

# Cron (requires Authorization: Bearer <CRON_SECRET>)
GET    /api/cron/trigger                 — Must await runDailyCheck() — Railway kills idle processes
         Optional: ?skipEmails=true      — Skips per-user alerts (for safe manual re-runs)
         Optional: ?forceMondayDigest=true — Forces the Monday digest on any day
GET    /api/cron/self-check-suspects     — Returns the daily self-check suspect set as JSON for the DEV-41 remote routine
                                           (which has no Supabase access). Filters in Node; EXCLUDES is_verified_zero. See JOBS.md.
                                           Auth: accepts CRON_SECRET OR the scoped read-only SELF_CHECK_TOKEN (least privilege).

# Webhooks (NO JWT — server-to-server, signature-verified)
POST   /api/webhooks/resend              — Resend email-engagement webhook (DEV-65). Forwards email lifecycle
                                           events into PostHog. Svix-signature-gated; see "Resend Webhook" below.
```

## Input Validation

- UUID regex on all path-param IDs (`UUID_REGEX` in `companies.ts`).
- HTTPS-only careers URLs.
- LinkedIn URLs blocked.
- SSRF protection: no private IPs (`10.x`, `192.168.x`, `172.16-31.x`, `127.x`, `0.0.0.0`, `[::1]`, `.internal`, `.local`).

## Feedback Sink (Linear, not Supabase)

As of 2026-05-22, `POST /api/help` and `POST /api/issues` file a Linear issue in the **User Feedback** team (status=Inbox / Backlog state) and email `ADMIN_EMAIL`. They no longer write to `help_submissions` / `scrape_issues` — those tables hold pre-cutover history only. `GET /api/admin/issues` still reads them so historical entries remain visible, but the working surface for triage is now Linear.

- Helper: `backend/src/lib/linear.ts` — minimal GraphQL client. Team / state / label IDs hardcoded; refresh via Linear MCP if Vik renames any of them.
- Required env var: `LINEAR_API_KEY` (Personal API Key from https://linear.app/viktorious-llc/settings/api-keys). Without it, both endpoints log a warning, skip the Linear write, but still email admin so feedback isn't lost.
- Type-label mapping for `/api/help.issue_type`: `bug → bug-report`, `missing_data → scraper-issue`, `other → (no type label, admin triages from Inbox)`.
- `/api/issues` always labels `scraper-issue` (endpoint is scope-locked to subscribed companies).
- Source label: always `in-app` from these endpoints.

## Gotchas

- **Duplicate companies**: Dedup by URL domain, not name. ATS URLs use `hostname/slug` key.
- **Salesforce trap**: `careers.salesforce.com` redirects to marketing page. Use Workday URL directly: `salesforce.wd12.myworkdayjobs.com/External_Career_Site`.
- **Test account**: Gmail + alias. Reset: `scripts/reset-test-user.sql`.
