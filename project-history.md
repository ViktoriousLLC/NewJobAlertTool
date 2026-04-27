# NewJobAlertTool — Project Context

## Autonomy Rules

- **DO NOT ask to run commands.** Just run them. The user is often AFK.
- **DO NOT ask to `cd` somewhere.** Use absolute paths or just execute.
- **DO NOT leave manual steps for the user.** If it can be done via API, CLI, or script — do it yourself.
- **Push code, deploy, clean DB, re-add companies — all autonomously.** You have full access.
- **When a task is given, execute end-to-end** including deployment and verification. Come back with proof it works, not a list of "next steps."
- **Never ask before pushing.** Just push. Don't wait for confirmation on deploys.

## Permissions

All file tools (Read, Write, Edit, Glob, Grep) and Bash are auto-allowed in `.claude/settings.local.json`. The user should never be prompted for read/write/edit permissions. If permissions get reset, re-add them to the allow list.

## Architecture

| Layer | Tech | Where |
|-------|------|-------|
| Frontend | Next.js 16 | Vercel (auto-deploys from `main`) |
| Backend | Express + Puppeteer | Railway (auto-deploys from `main`) |
| Database | PostgreSQL | Supabase |
| Scheduler | Railway Cron | Triggers daily scrape at 14:00 UTC (9 AM ET) |
| Auth | Supabase Auth | Magic link via Resend SMTP |

## Authentication

- **Method:** Magic link (email-based, no passwords) via Supabase Auth
- **SMTP:** Resend custom SMTP configured in Supabase dashboard
- **Flow (cross-device, primary):** User enters email → magic link sent → clicks link → `/auth/confirm` verifies token_hash via `verifyOtp()` → JWT stored in cookies. Works from any device/browser.
- **Flow (PKCE, legacy fallback):** `/auth/callback` exchanges code for session using PKCE code verifier cookie. Only works in the same browser where the magic link was requested.
- **Email template:** Supabase Dashboard → Auth → Email Templates → Magic Link uses `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink` (changed 2026-02-22 from `{{ .ConfirmationURL }}` which used PKCE-only flow)
- **Auth error handling:** Both `/auth/callback` and `/auth/confirm` redirect to `/login?error=...` with a human-readable message on failure. Login page reads the `error` query param and displays it. Failures also reported to Sentry via `captureMessage()`.
- **Frontend:** `@supabase/ssr` for cookie-based sessions, `middleware.ts` protects all routes except `/`, `/auth/callback`, `/auth/confirm`, `/privacy` (redirects to `/login`)
- **Token flow:** Server-side cookies are HttpOnly, so browser JS can't read them. `apiFetch` calls `/api/auth/token` (a Next.js server route) to get the access token, then caches it in memory until near expiry.
- **Backend:** `requireAuth` middleware extracts `Bearer <token>` from `Authorization` header. Fast path: local JWT verification via `SUPABASE_JWT_SECRET` (~0ms). Fallback: `supabase.auth.getUser(token)` (~100-150ms). Attaches `req.userId`.
- **Data scoping:** Companies are shared (catalog). Users subscribe via `user_subscriptions`. Favorites via `user_job_favorites`. Dashboard/jobs filtered by subscription.
- **Cron/scraper:** Uses service key (bypasses RLS), no user context needed — scrapes all companies across all users
- **Env vars:** Backend needs `SUPABASE_ANON_KEY` (for auth verification) in addition to existing `SUPABASE_SERVICE_KEY`

## Production URLs

- **Frontend**: `https://<your-domain>` (Vercel)
- **Backend API**: `https://api.<your-domain>` (Railway custom domain)
- **Supabase**: `https://<project-id>.supabase.co`
- **Domain registrar/DNS**: Cloudflare

## Deployment

Pushing to `main` auto-deploys both:
- **Railway** (backend) — builds and deploys in ~60 seconds
- **Vercel** (frontend) — builds and deploys in ~30 seconds

Workflow: `git add` → `git commit` → `git push origin main` → wait ~60s → verify via API.

## API Endpoints (Auth Required)

All routes below require `Authorization: Bearer <token>` header.

### Companies (user's subscribed companies)
```
GET    /api/companies                    — List user's subscribed companies (via user_subscriptions)
GET    /api/companies/{id}               — Get company + jobs + next_company (shared, nav uses subscriptions)
POST   /api/companies/check              — Preview scrape results without saving (check-then-add flow)
         Body: {"careers_url": "https://..."}
         Returns: {status: "preview"|"exists"|"error", company_name, job_count, sample_jobs, jobs, ...}
POST   /api/companies                    — Add new company (creates + auto-subscribes, 10/user limit)
         Body: {"name": "X", "careers_url": "https://..."}
         Optional: {jobs: [...], platform_type: "...", platform_config: {...}} (from /check preview)
DELETE /api/companies/{id}               — Unsubscribe (admin can ?hard=true to delete)
```

### Catalog (shared company list)
```
GET    /api/catalog                      — All companies in shared catalog (no user filter)
```

### Subscriptions
```
GET    /api/subscriptions                — List user's subscribed company IDs
POST   /api/subscriptions                — Subscribe to companies
         Body: {"company_ids": ["uuid", ...]}
DELETE /api/subscriptions/{companyId}    — Unsubscribe from a company
```

### Preferences
```
GET    /api/preferences                  — Get user preferences (creates default if none)
PUT    /api/preferences                  — Update preferences
         Body: {"email_frequency": "daily|weekly|off"}
```

### Favorites
```
GET    /api/favorites                    — List user's favorited job IDs (from user_job_favorites)
POST   /api/favorites/{jobId}            — Add a favorite
DELETE /api/favorites/{jobId}            — Remove a favorite
```

### Jobs
```
GET    /api/jobs                         — All active jobs across user's subscribed companies
```

### Scrape Issues
```
POST   /api/issues                       — Report a scrape issue (any user, any company)
         Body: {"company_id": "uuid", "issue_type": "wrong_jobs|missing_jobs|bad_locations|other", "description": "..."}
```

### Compensation
```
GET    /api/compensation                 — Comp data for user's subscribed companies (batch)
GET    /api/compensation/{companyName}   — Comp data for a single company
```

### Help / Feedback
```
POST   /api/help                         — Send feedback email to admin + store in help_submissions table
         Body: {"issue_type": "bug|missing_data|other", "message": "...", "page_url": "..."}
```

### Admin (requires admin email)
```
GET    /api/admin/stats                  — Dashboard stats (users, companies, jobs, errors)
GET    /api/admin/issues                 — Combined scrape issues + help submissions
GET    /api/admin/users                  — User list with subs count and email prefs
```

### Scraping
```
GET    /api/cron/trigger                 — Trigger full scrape (requires Authorization: Bearer <CRON_SECRET> header)
         Optional query: ?skipEmails=true (skips per-user alerts, useful for manual re-runs)
```
The CRON_SECRET is set in Railway env vars.

## Database Schema

### `companies` table (shared catalog)
- `id` (uuid PK), `name`, `careers_url`, `created_at`, `last_checked_at`, `last_check_status`, `total_product_jobs`, `user_id` (nullable, legacy creator), `platform_type` (text), `platform_config` (jsonb), `levelsfyi_slug` (text, optional override), `is_active` (boolean), `subscriber_count` (integer)
- Companies are **shared** — one entry per company, visible to all users
- `is_active`: `true` if `subscriber_count > 0` (at least one user tracks it). Scraper only checks active companies.
- `subscriber_count`: denormalized count from `user_subscriptions` table
- RLS: everyone can read, authenticated users can insert

### `seen_jobs` table
- `id` (uuid PK), `company_id` (FK → companies, CASCADE delete), `job_url_path`, `job_title`, `job_location`, `first_seen_at`, `is_baseline`, `job_level` (text), `status` (text), `status_changed_at` (timestamptz)
- Unique index on `(company_id, job_url_path)`, index on `job_level`, composite index on `(company_id, is_baseline, first_seen_at)`, index on `status`
- `status`: `'active'` (current listing), `'removed'` (disappeared from scrape), `'archived'` (60+ days old)
- Jobs older than 60 days are archived (not deleted) — preserves favorites

### `user_subscriptions` table
- `id` (uuid PK), `user_id` (FK → auth.users), `company_id` (FK → companies, CASCADE), `created_at`
- UNIQUE on `(user_id, company_id)`, indexes on `user_id` and `company_id`
- Links users to the companies they track — replaces the old `companies.user_id` scoping

### `user_job_favorites` table
- `id` (uuid PK), `user_id` (FK → auth.users), `seen_job_id` (FK → seen_jobs, CASCADE), `created_at`
- UNIQUE on `(user_id, seen_job_id)`, index on `user_id`
- Replaces old `favorites` table

### `user_new_company_submissions` table
- `id` (uuid PK), `user_id` (FK → auth.users), `company_id` (FK → companies, CASCADE), `created_at`
- Tracks how many companies each user has submitted (rate limit: 10 per user, admin bypass)

### `user_preferences` table
- `id` (uuid PK), `user_id` (UNIQUE FK → auth.users), `email_frequency` (text, default 'daily'), `created_at`, `updated_at`
- `email_frequency`: `'daily'`, `'weekly'`, or `'off'`

### `comp_cache` table
- `id` (uuid PK), `company_slug` (text, UNIQUE), `company_name` (text), `data` (jsonb), `fetched_at` (timestamptz)
- Caches levels.fyi PM compensation data with 24hr TTL
- `data` contains: `levels` (array of {level, medianTC}), `overallMedianTC`, `tiers` ({early, mid, director} ranges), `levelsFyiUrl`
- No RLS — uses service key for read/write

### `scrape_issues` table
- `id` (uuid PK), `company_id` (FK → companies, CASCADE delete), `user_id` (FK → auth.users), `issue_type` (text), `description` (text), `created_at`
- RLS: users can insert/view their own issues
- Any user can report issues on any shared company
- Issue types: `wrong_jobs`, `missing_jobs`, `bad_locations`, `other`

### `help_submissions` table
- `id` (uuid PK), `user_id` (FK → auth.users), `user_email` (text), `issue_type` (text), `message` (text), `page_url` (text), `created_at`
- RLS: users can insert/view their own submissions
- Index on `created_at DESC` for admin dashboard queries
- Populated by POST /api/help alongside Resend email

## Scraper Architecture (backend/src/scraper/scraper.ts)

### Shared Greenhouse helper
`scrapeGreenhouseCareers(boardName, companyLabel)` — reusable for any company on Greenhouse. Fetches `https://api.greenhouse.io/v1/boards/{boardName}/jobs`, filters by `PM_KEYWORDS` (17 keywords including product manager, product lead, product growth, etc.).

### Company → Scraper Routing
| Company | Scraper | Board/Platform |
|---------|---------|---------------|
| Atlassian | Custom API | atlassian.com/endpoint/careers/listings |
| DoorDash | Greenhouse helper | `doordashusa` |
| Discord | Greenhouse helper | `discord` |
| Reddit | Greenhouse departments + keyword filter | `reddit` |
| Instacart | Greenhouse helper | `instacart` |
| Figma | Greenhouse helper | `figma` |
| Airbnb | Greenhouse helper | `airbnb` |
| OpenAI | Ashby GraphQL API (generalized) | ashbyhq.com/openai |
| Slack | Workday API (generalized) | wd12.myworkdayjobs.com |
| Stripe | Puppeteer pagination | stripe.com/jobs |
| Uber | Custom JSON API | uber.com/api |
| Google | Puppeteer pagination | google.com/careers |
| Netflix | Custom JSON API + PM filter | explore.jobs.netflix.net |
| PayPal | Eightfold.ai API | paypal.eightfold.ai |
| *Any Lever* | Lever API (auto-detected) | jobs.lever.co/{handle} |
| *Any Ashby* | Ashby GraphQL (auto-detected) | jobs.ashbyhq.com/{org} |
| *Any Workday* | Workday API (auto-detected) | *.myworkdayjobs.com |
| Others | Generic Puppeteer | Fallback HTML scraper |

### Platform Auto-Detection
When a new company is added, `detectPlatform(url)` runs to identify the ATS:
1. **Known custom hostnames** — Atlassian, Stripe, Uber, Google, Netflix → `custom_api`
2. **Known Greenhouse custom domains** — a16z, Twitch (hardcoded fast-path)
3. **Direct ATS URLs** — greenhouse.io, lever.co, ashbyhq.com, myworkdayjobs.com, eightfold.ai
4. **HTML embed detection** — fetches page HTML and looks for Greenhouse/Lever/Ashby/Workday/Eightfold embed signatures
5. **Puppeteer fallback** — renders SPA and re-checks for embeds
6. **Speculative API probes** — extracts company slug from hostname (e.g., `careers.twitch.com` → `twitch`), tries it against Greenhouse and Lever public APIs in parallel. Catches custom-domain companies backed by these ATS without manual config.
7. **Generic** — falls back to Puppeteer scraper

Detected platform is cached in `companies.platform_type` + `companies.platform_config` (jsonb) for daily checks.

### Post-Scrape Quality Validation
`validateScrapeResults()` runs after every scrape:
- Filters out non-PM jobs using PM_KEYWORDS
- Flags zero results, vague locations, duplicates, invalid URLs
- Returns quality score (0-100) stored in `last_check_status`

### Stripe scraper notes
- Puppeteer-based, paginates `stripe.com/jobs/search?skip=0` through `skip=1200`
- Filters for PM keywords AND excludes sales roles (account executive, sales engineer, etc.)
- Fetches each job's detail page for location data (Office locations / Remote locations sections)
- The full scrape takes ~2-3 minutes due to Puppeteer page loads

### To fix a broken scraper
1. Identify the platform (check the careers page source or API)
2. If Greenhouse: use `scrapeGreenhouseCareers("boardname", "Label")`
3. Add hostname routing in `scrapeCompanyCareers()`
4. Push to deploy
5. Delete the company via API, re-add it to get fresh data

### Stale data / contaminated jobs
When a new platform-specific scraper is added (e.g., Eightfold API for PayPal), old jobs scraped by the generic Puppeteer fallback remain in the DB with bad data (title/location/date mashed together). **Always delete and re-add the company** after adding a new scraper to flush stale data.

## Key Files

- `backend/src/scraper/scraper.ts` — All scraper logic (Greenhouse, Lever, Ashby, Workday, Eightfold, custom APIs, generic Puppeteer). Hostname routing runs before Puppeteer launch.
- `backend/src/scraper/atsRegistry.ts` — Shared ATS slug registry (hostname → platform mapping). Single source of truth for both detectPlatform and scraper routing.
- `backend/src/scraper/detectPlatform.ts` — ATS platform auto-detection engine
- `backend/src/scraper/detectCompanyName.ts` — Auto-detect company name from URL + platform info (40+ known hosts, ATS slug fallback, generic hostname fallback)
- `backend/src/scraper/validateScrape.ts` — Post-scrape quality validation
- `backend/src/jobs/dailyCheck.ts` — Daily cron job logic (per-user email, job status tracking)
- `backend/src/routes/companies.ts` — Companies API (subscription-scoped)
- `backend/src/routes/subscriptions.ts` — Subscribe/unsubscribe from shared companies
- `backend/src/routes/catalog.ts` — Shared company catalog (no user filter)
- `backend/src/routes/preferences.ts` — User email preferences (daily/off)
- `backend/src/routes/favorites.ts` — Favorites API (user_job_favorites table)
- `backend/src/routes/issues.ts` — Scrape issue reporting API (any user, any company)
- `backend/src/routes/compensation.ts` — Levels.fyi compensation API (subscription-scoped)
- `backend/src/routes/admin.ts` — Admin-only dashboard API (stats, issues, users)
- `backend/src/lib/constants.ts` — Shared constants (ADMIN_EMAIL)
- `backend/src/lib/classifyLevel.ts` — Job level classification (early/mid/director) by title keywords
- `backend/src/lib/levelsFyi.ts` — Levels.fyi fetcher, parser, and comp_cache manager
- `frontend/src/lib/jobFilters.ts` — Shared `isUSLocation()`, job level labels/colors
- `frontend/src/lib/brandColors.ts` — Brand color map, `softenColor()`, `getFaviconUrl()` for dashboard cards
- `frontend/src/lib/analytics.ts` — PostHog event tracking wrapper (`trackEvent`, `identifyUser`)
- `frontend/src/components/NavBar.tsx` — Dark navy sticky nav bar with active route detection
- `frontend/src/components/PostHogProvider.tsx` — PostHog deferred init (useEffect) + SPA pageview tracking provider
- `frontend/sentry.client.config.ts` — Sentry browser-side init
- `frontend/sentry.server.config.ts` — Sentry server-side init
- `frontend/instrumentation.ts` — Next.js instrumentation hook for Sentry
- `backend/src/middleware/auth.ts` — JWT verification middleware (extracts userId + userEmail)
- `backend/src/index.ts` — Express server entry point
- `frontend/src/lib/supabase.ts` — Browser Supabase client (`@supabase/ssr`)
- `frontend/src/lib/api.ts` — Authenticated fetch wrapper (attaches JWT, caches token)
- `frontend/src/app/api/auth/token/route.ts` — Server-side route to extract JWT from HttpOnly cookies
- `frontend/src/app/login/page.tsx` — Magic link login page (shows error from ?error= query param)
- `frontend/src/app/auth/callback/route.ts` — PKCE code exchange (legacy, same-browser only) + Sentry on failure
- `frontend/src/app/auth/confirm/route.ts` — Token-hash verification via verifyOtp() (cross-device) + Sentry on failure
- `frontend/src/components/LandingPage.tsx` — Landing page above-fold (Nav + Hero, sections 1-2) + exported shared utils (`mix`, `useInView`, `Reveal`, `COMPANIES`, `SAMPLE_JOBS`, `COMPANY_COLORS`)
- `frontend/src/components/LandingBelowFold.tsx` — Landing page below-fold (sections 3-10: Problem → Footer), lazy-loaded via `next/dynamic`
- `frontend/middleware.ts` — Route protection (redirects to /login if unauthenticated, except `/` which shows landing page)
- `frontend/src/components/AuthNav.tsx` — User email + sign out in navbar
- `frontend/src/app/page.tsx` — Auth-gated: LandingPage (unauth) or Dashboard (auth) with tile grid + AddCompanyModal + onboarding
- `frontend/src/app/add/page.tsx` — Redirects to `/?addCompany=true` (modal handles everything)
- `frontend/src/app/company/[id]/page.tsx` — Company detail page (with job status, saved inactive jobs)
- `frontend/src/app/jobs/page.tsx` — "View All Jobs" flat table (active jobs only)
- `frontend/src/app/settings/page.tsx` — Email preferences (daily/weekly/off)
- `frontend/src/app/privacy/page.tsx` — Privacy policy (static, public route)
- `frontend/src/app/layout.tsx` — Root layout with navbar + HelpButton
- `frontend/src/components/AddCompanyModal.tsx` — Two-tab modal: catalog browse + check-then-add flow (4-state: input → checking → preview → retry)
- `frontend/src/components/HelpButton.tsx` — Floating help/feedback button
- `frontend/src/components/Toast.tsx` — Toast notification system (context provider + UI)
- `frontend/src/app/admin/page.tsx` — Admin dashboard (stats, errors, reports, users)
- `cron/index.js` — Railway cron trigger script
- `scripts/reset-test-user.sql` — Test account data wipe script
- `scripts/create-help-submissions.sql` — SQL to create help_submissions table
- `scripts/phase6-cleanup.sql` — Drop old favorites table + companies.user_id column
- `docs/planning/supabase-schema.sql` — Database schema
- `docs/specs/NEWPMJOBS-LANDING-SPEC.md` — Landing page spec (primary design doc)
- `docs/specs/newpmjobs-landing-v4.jsx` — Landing page visual reference artifact

## Frontend Pages

| Route | File | Description |
|-------|------|-------------|
| `/login` | `login/page.tsx` | Magic link login (email input + send link + error display) |
| `/auth/callback` | `auth/callback/route.ts` | PKCE code exchange (same-browser only) |
| `/auth/confirm` | `auth/confirm/route.ts` | Token-hash verification (cross-device magic links) |
| `/` | `page.tsx` | Auth-gated: Landing page (unauth) or Dashboard (auth) |
| `/add` | `add/page.tsx` | Redirects to `/?addCompany=true` |
| `/company/[id]` | `company/[id]/page.tsx` | Company detail — active jobs + saved inactive section |
| `/jobs` | `jobs/page.tsx` | All Jobs — active jobs across subscribed companies |
| `/settings` | `settings/page.tsx` | Email preferences (daily / weekly / off) |
| `/privacy` | `privacy/page.tsx` | Privacy policy (public, no auth required) |
| `/admin` | `admin/page.tsx` | Admin dashboard (stats, issues, users) |

### Navbar (`layout.tsx`)
Sticky top nav with: Logo + "NewPMJobs" | [Starred] [View All Jobs] [+ Add Company] [Settings] | email + Sign Out

### Shared patterns
- **US Only toggle**: Checkbox filter using `isUSLocation()` regex matcher — shared logic in company detail and all-jobs pages
- **`first_seen_at`**: Used as "Date Added" in the all-jobs table (per-job, not per-company)
- **`last_checked_at`**: Used in company detail page stats (per-company scrape timestamp)

## Favorites

### `user_job_favorites` table (replaced old `favorites`)
- API: `GET /api/favorites`, `POST /api/favorites/:jobId`, `DELETE /api/favorites/:jobId`
- Frontend: star icons on All Jobs and Company Detail pages, "Starred" navbar → `/jobs?filter=starred`
- Favorited removed/archived jobs shown in muted "Saved Jobs" section on company detail

## Email

- **Daily alerts:** Per-user, personalized. Each user gets only alerts for their subscribed companies.
- **Batch sending (added 2026-02-22):** `sendBatchAlerts()` uses `resend.batch.send()` (up to 100 emails per API call, 1s delay between batches). Replaced individual `resend.emails.send()` loop that was hitting Resend's 2 req/s rate limit (429 errors).
- **Failure notifications:** `notifyAdminOfFailures()` sends a single email to `ADMIN_EMAIL` after the daily cron if any batches failed, with error details and a link to the Resend dashboard.
- **Sent from:** `alerts@newpmjobs.com` (via Resend API in `sendAlert.ts`)
- **Magic link emails:** Sent from `noreply@newpmjobs.com` (via Supabase custom SMTP → Resend)
- **Per-user logic:** `dailyCheck.ts` gets all users via `listUsers()`, checks `user_preferences.email_frequency`, filters alerts to subscriptions
- **Company logos:** Email includes Google favicon images for each company
- **Unsubscribe:** Footer links to `/settings` page where users can set email to "off"
- **API key:** Only in Railway production env vars (`RESEND_API_KEY`). Empty locally — cannot send from local.
- **Resend limits:** Free plan = 100 emails/day, 3,000/month, 2 req/s. SMTP (magic links) and API (daily alerts) share the same account quota. Upgrade to Pro ($20/month) removes daily limit.

## Performance Architecture

### Auth fast path
- `SUPABASE_JWT_SECRET` is set in Railway → `requireAuth` middleware verifies JWTs locally (~0ms) instead of calling Supabase API (~100-150ms). If this env var is ever removed, every API call gets 100-150ms slower.

### Dashboard (`GET /api/companies`)
- `new_jobs_today`: computed via **DB-level filter** — `supabase.from("seen_jobs").eq("is_baseline", false).gte("first_seen_at", todayISO)`. PostgreSQL handles the date comparison, not JS.
- Two parallel queries: (1) today's new jobs for badge counts, (2) latest non-baseline job per company for sorting.
- Composite index: `idx_seen_jobs_company_baseline ON seen_jobs(company_id, is_baseline, first_seen_at)` — added 2026-02-12.

### Detail page (`GET /api/companies/:id`)
- Backend runs **3 parallel queries**: company row, jobs (selected columns only), sibling company names.
- Response includes `next_company: { id, name }` — frontend no longer fetches all companies for the "next" button.
- Frontend renders page as soon as company + favorites load (~200ms). **Comp data loads lazily** (non-blocking, appears after page is visible).

### Compensation data (levels.fyi) — 3-tier cache
| Tier | Latency | TTL | Location |
|------|---------|-----|----------|
| In-memory (`Map`) | ~0ms | 1 hour | `backend/src/lib/levelsFyi.ts` |
| DB (`comp_cache` table) | ~50ms | 24 hours | Supabase |
| Live fetch (levels.fyi) | 1-3s (5s timeout) | Fills both caches | External |

- **Preloaded on company add**: `getCompData(name)` fires after response is sent (non-blocking).
- **Refreshed by daily cron**: batch of 3 companies at a time, 2s delay between batches.
- **DB upsert is fire-and-forget**: doesn't block the API response.
- Cache failures (levels.fyi down / no data) are cached for 5 min to avoid repeated failures.

## Monitoring & Analytics

| Service | Purpose | Where |
|---------|---------|-------|
| PostHog | Product analytics (pageviews, events, hashed user ID) | Frontend only (`posthog-js`) |
| Sentry | Error monitoring + tracing | Frontend (`@sentry/nextjs`) + Backend (`@sentry/node`) |
| UptimeRobot/BetterUptime | Uptime monitoring | External SaaS, pings `/api/health` |

- **PostHog:** Deferred init in `PostHogProvider.tsx` (useEffect, not top-level), SPA-aware pageview tracking via `usePathname()`, user identified by SHA-256 hash of email (no raw PII sent). Events: `company_added`, `company_deleted`, `job_starred`, `job_unstarred`, `dashboard_filter`.
- **Sentry:** DSN shared between frontend and backend. Frontend uses `withSentryConfig()` in `next.config.ts` + `instrumentation.ts`. Backend uses `Sentry.init()` + `Sentry.setupExpressErrorHandler(app)`. All backend route catch blocks call `Sentry.captureException(err)`. Frontend replay rate: 10% on error (reduced from 100% on 2026-02-23).

## Security Headers (added 2026-02-21)

All security headers are configured in `frontend/next.config.ts` via `headers()`:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Blocks iframe embedding |
| `X-Content-Type-Options` | `nosniff` | Blocks MIME-type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controls referrer leakage |
| `Content-Security-Policy` | Dynamic (see below) | Blocks XSS data exfiltration, script/style injection |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Forces HTTPS (2 years) |

### CSP details
- Built dynamically from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_API_URL` env vars
- `connect-src` whitelist: `'self'`, backend API origin, Supabase HTTPS + WSS, PostHog (`us.i.posthog.com`, `us-assets.i.posthog.com`), Sentry (`o4510870199730176.ingest.us.sentry.io`)
- `img-src`: `'self' data: https://www.google.com` (for company favicons)
- `script-src` / `style-src`: `'self' 'unsafe-inline'` — Next.js requires inline scripts/styles for hydration. Nonce-based CSP is a future upgrade.
- `frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`

## Gotchas & Lessons

- **Supabase RPC silent failures:** `supabase.rpc("fn_name", {...})` returns `{ data: null, error: ... }` if the function doesn't exist in the DB — but the error is easy to miss if you only destructure `data`. Prefer direct queries for critical features, or always check the `error` field.
- **Supabase DDL:** Cannot run CREATE TABLE / ALTER TABLE through REST API or supabase-js. Must use Supabase SQL Editor in the dashboard.
- **useSearchParams():** Must be wrapped in `<Suspense>` boundary in Next.js. Create a thin wrapper component.
- **Cron:** Only use Railway Cron (single source). Do NOT add in-process schedulers (node-cron) — causes duplicate runs.
- **Windows sleep:** Use `powershell -command "Start-Sleep -Seconds N"` instead of `timeout` (fails in non-interactive shells).
- **Deploy timing:** Wait 90+ seconds after pushing before calling production API endpoints that depend on new code.
- **Stale data:** After adding/fixing a scraper, always delete + re-add the company for a clean baseline.
- **SUPABASE_SERVICE_KEY:** Must be the `service_role` key, NOT the `anon` key. The anon key respects RLS and `auth.uid()` returns NULL, causing all user-scoped queries to return empty. The local `.env` previously had the anon key mislabeled — always verify the JWT `role` claim.
- **HttpOnly cookies + browser JS:** `createServerClient` from `@supabase/ssr` sets HttpOnly cookies that `createBrowserClient` cannot read. Solution: use a Next.js server route (`/api/auth/token`) to extract the access token from cookies server-side, then cache it on the client.
- **CORS with www redirect:** Vercel redirects root → `www` subdomain. Backend CORS must allow BOTH origins. Set `FRONTEND_URL=https://<your-domain>` and the code auto-adds the `www` variant.
- **Supabase redirect URLs:** Must include all 4: `https://<your-domain>/auth/callback`, `https://www.<your-domain>/auth/callback`, `https://<your-domain>/auth/confirm`, `https://www.<your-domain>/auth/confirm` due to Vercel's www redirect.
- **Magic link PKCE cross-device failure:** PKCE flow stores a code verifier cookie in the browser where `signInWithOtp` was called. If user opens the magic link on a different device/browser/email app webview, `exchangeCodeForSession` silently fails. Fixed 2026-02-22 by switching email template to token_hash flow (`/auth/confirm` + `verifyOtp`).
- **Resend 429 rate limit:** Daily alert emails were firing individual `resend.emails.send()` calls in a tight loop, exceeding Resend's 2 req/s limit. Fixed 2026-02-22 by switching to `resend.batch.send()` (up to 100 per API call).
- **NEXT_PUBLIC_ env vars:** Baked at build time. After changing in Vercel, must trigger a redeploy for changes to take effect.
- **Cloudflare proxy (orange cloud):** Must be OFF (grey cloud / DNS only) for Vercel and Railway custom domains — they manage their own SSL.
- **Supabase SMTP location:** Dashboard → Authentication → Notifications → Email → SMTP Settings (not under "Project Settings").
- **Duplicate companies:** Name-based dedup is unreliable ("Open ai" vs "OpenAI"). Always validate by URL domain when adding companies. Extract domain from careers_url and check against existing companies.
- **Subscription N+1:** When subscribing to N companies, don't loop 2N sequential queries. Batch the subscriber_count update. Same pattern for unsubscribe.
- **Anon key for read queries:** The Supabase anon key works for tables with `USING (true)` SELECT policies (companies, seen_jobs). Useful for CLI debugging without a user JWT.
- **Local .env placeholders:** The local `backend/.env` has placeholder values for SUPABASE_SERVICE_KEY. Production keys are only on Railway. For local DB queries, use anon key against Supabase REST API with appropriate RLS policies.
- **Git CRLF warnings:** Repo has `.gitattributes` with `* text=auto` (LF normalization). Set `git config core.autocrlf input` at repo level to suppress "LF will be replaced by CRLF" warnings on Windows.
- **PM_KEYWORDS false negatives:** VC firms and non-traditional companies use different job titles (e.g., a16z uses "Product Growth" not "Product Manager"). When a company's check returns 0 PM roles but has total jobs, check if their titles use PM-adjacent terms not in the keyword list. Added `"product growth"` on 2026-02-21.
- **Cron endpoint must await completion:** The `/api/cron/trigger` endpoint must `await runDailyCheck()` before responding. If it fires-and-forgets (returns immediately), Railway's auto-sleep can kill the backend process before scraping/emailing finishes — causing missed alerts on weekends when no other traffic keeps the service warm. Fixed 2026-02-24.
- **NEXT_PUBLIC_ADMIN_EMAIL required:** Security hardening (2026-02-23) removed the hardcoded admin email fallback from `NavBar.tsx`. The admin button only appears if `NEXT_PUBLIC_ADMIN_EMAIL` is set in Vercel env vars. Without it, `ADMIN_EMAIL` resolves to `""` and the check always fails.
- **Vercel project name:** The production Vercel project is `new-job-alert-tool` (not `frontend`). When using `vercel link`, always link to this project. The CLI `vercel link --yes` auto-creates a new project — always verify with `vercel project ls` first.
- **Salesforce careers redirect trap:** `careers.salesforce.com` redirects to a marketing page (`salesforce.com/company/careers/`) with zero job listings. The actual job board is Workday at `salesforce.wd12.myworkdayjobs.com/External_Career_Site`. Platform detection can't bridge the redirect → must use the Workday URL directly. This pattern applies to other large enterprises that separate their marketing careers page from their ATS.

## Security Hardening (2026-02-23)

Pre-public-launch audit. All fixes deployed in 2 commits:

### Fixes applied
- **Open redirect:** `/auth/confirm` `?next` param validated to only allow relative paths (not `//evil.com`)
- **XSS in help email:** All user input HTML-escaped via `escapeHtml()` before embedding in email HTML
- **Hardcoded admin email:** `index.ts` help route changed from hardcoded email to `ADMIN_EMAIL` constant
- **PII in logs:** User emails replaced with truncated user IDs in `sendAlert.ts` and `dailyCheck.ts`
- **Scraper timeout:** Generic Puppeteer scraper wrapped in 120s `Promise.race` timeout to prevent cron hangs
- **Cron overlap guard:** `dailyCheckRunning` flag prevents concurrent daily check runs
- **Input validation:** UUID regex on subscription endpoints, string length/type checks on help endpoint
- **Cron secret:** Removed deprecated query param support, header-only (`Authorization: Bearer`)
- **Sentry error capture:** `Sentry.captureException(err)` added to all 18 backend route catch blocks
- **PostHog privacy:** User identity hashed with SHA-256 before `posthog.identify()` (no raw emails)
- **Sentry replay:** `replaysOnErrorSampleRate` reduced from 1.0 to 0.1 (10%)
- **Cleanup:** Removed unused `node-cron` dependency, removed hardcoded admin email fallback from `NavBar.tsx` (requires `NEXT_PUBLIC_ADMIN_EMAIL` env var in Vercel)

### DB indexes added (manual SQL in Supabase)
```sql
CREATE INDEX idx_seen_jobs_company_status ON seen_jobs(company_id, status);
CREATE INDEX idx_seen_jobs_status_date ON seen_jobs(status, first_seen_at DESC);
CREATE INDEX idx_companies_is_active ON companies(is_active);
```

### DNS
- DMARC record added: `_dmarc.newpmjobs.com` TXT `v=DMARC1; p=none; rua=mailto:vikrant.agar+jobstoolDmarc@gmail.com`
- DKIM + SPF were already configured via Resend

## Scraper Reliability & Observability Overhaul (2026-03-07)

### Problem
Three interrelated issues discovered during routine monitoring:

1. **Stripe data corruption**: `broadATSDiscovery` (the zero-result fallback that probes ATS APIs) silently changed Stripe's `platform_type` from NULL to `"greenhouse"`, because there happens to be a Greenhouse board named "stripe". This bypassed the custom Stripe Puppeteer scraper and produced 37 duplicate jobs with different URL formats (`gh_jid=` params vs Stripe's native `/jobs/` paths). Users saw ~35 "new" jobs that were actually duplicates.

2. **23 of 45 companies failing daily**: The `scrapeCompanyCareers()` function launched Puppeteer (headless Chrome) as its *first* action, then checked hostname-based routing to decide which scraper to use. For the 17+ companies using known ATS APIs (Greenhouse, Lever, Ashby, etc.), Chrome was launched and immediately closed — wasting ~500MB RAM per instance. During the daily cron, this exhausted Railway's container resources before reaching companies that actually needed Puppeteer.

3. **Zero failure visibility**: `dailyCheck.ts` had no Sentry integration, no admin notification on failures, and the cron endpoint always returned HTTP 200 regardless of how many companies failed. 23 companies had been silently failing for days with no alerts.

### Root Cause Analysis
- **Why broadATSDiscovery overwrote Stripe**: The guard condition was `if (rawJobs.length === 0 && isGeneric)` — but custom scraper companies (Stripe, Uber, etc.) have `platform_type = NULL`, which made `isGeneric` evaluate to `true`. So when the custom Stripe scraper returned 0 jobs for any reason (temporary failure, timeout), broadATSDiscovery would probe the Greenhouse API, find the unrelated "stripe" board, and permanently overwrite the company's platform routing.
- **Why so many companies failed**: Puppeteer launches are expensive (~2-3s + 500MB each). Launching Chrome 45 times sequentially in a single cron run (even when immediately closing it for 17 companies) created resource pressure that caused EAGAIN errors and timeouts for later companies.

### Decisions Made

**Decision 1: Move hostname routing before Puppeteer launch**
- *Why*: The simplest fix — no architectural change, just reorder the existing code. All custom scraper checks, ATS registry lookups, and direct ATS URL matches now run before `puppeteer.launch()`. Only truly unknown companies (currently ~6) trigger Chrome.
- *Alternative considered*: Pooling Puppeteer instances — rejected as over-engineering for the current scale.

**Decision 2: Add CUSTOM_SCRAPER_HOSTS blocklist to broadATSDiscovery**
- *Why*: Custom scraper companies (Stripe, EA, Atlassian, Netflix, Uber, Google) should never have their platform_type overwritten by speculative ATS probes. A simple hostname blocklist is the most robust guard.
- *Alternative considered*: Adding a `is_custom_scraper` boolean column — rejected as unnecessary schema change when a code-level guard suffices.

**Decision 3: Populate platform_type for 12 NULL companies in DB**
- *Why*: Companies like Airbnb, Discord, OpenAI had `platform_type = NULL` even though they use known ATS platforms. This forced them through hostname-based routing in the scraper code, which worked but was fragile. Setting the platform_type directly means the switch statement at the top of `scrapeCompanyCareers()` handles them immediately, before any hostname logic runs.
- Companies updated: Airbnb (greenhouse), Anthropic (ashby), Bitkraft (greenhouse), Discord (greenhouse), DoorDash (greenhouse), Figma (greenhouse), Instacart (greenhouse), OpenAI (ashby), PayPal (eightfold), Reddit (greenhouse_departments), Roblox (greenhouse_departments), Slack (workday)

**Decision 4: Add Sentry + admin email + failure threshold to dailyCheck**
- *Why*: The cron was a black box. Now: each failure is tagged in Sentry (company name + phase), an admin email summarizes all failures with error messages, and if >25% of companies fail the cron returns HTTP 500 (visible in Railway dashboard).
- *Threshold choice*: 25% — high enough to tolerate a few flaky scrapers, low enough to catch systemic issues like the Puppeteer resource exhaustion.

**Decision 5: Add skipEmails query param**
- *Why*: After fixing scraper issues, you often want to trigger a manual re-run to verify fixes without sending users a second batch of alerts for the day. `?skipEmails=true` skips per-user email alerts but still runs all scraping, DB updates, and admin notifications.

### Changes Made

| File | Change |
|------|--------|
| `backend/src/scraper/scraper.ts` | Moved hostname + ATS routing before `puppeteer.launch()`. Chrome only launches for ~6 truly generic companies. |
| `backend/src/jobs/dailyCheck.ts` | Added Sentry import + `captureException` with tags. Added `failedCompanies[]` tracking. Added `CUSTOM_SCRAPER_HOSTS` guard on broadATSDiscovery. Added `skipEmails` option. Added `notifyAdminOfScrapeFailures()` call. Added 25% failure threshold that throws (→ cron returns 500). |
| `backend/src/email/sendAlert.ts` | New `notifyAdminOfScrapeFailures(totalCompanies, failures[])` function — sends HTML email to admin with failure count, percentage, and per-company error table. |
| `backend/src/index.ts` | Cron endpoint reads `?skipEmails=true` query param and passes to `runDailyCheck()`. |
| Database (direct SQL) | Reset Stripe `platform_type`/`platform_config` to NULL. Deleted 37 Greenhouse-format duplicate jobs. Restored 42 incorrectly-removed Stripe jobs to active. Updated 12 companies with correct `platform_type`. |

### Verification
- TypeScript compiles clean (`tsc --noEmit` passes)
- Pushed to main, Railway deployed healthy (`/api/health` returns 200)
- Stripe DB state verified: 0 Greenhouse dupes, 42 active jobs restored, platform_type = NULL
- Could not trigger manual cron (local CRON_SECRET doesn't match production) — next natural cron at 14:00 UTC will be first run with new code
- Expected outcome: ~39 companies succeed (vs 22 before), ~6 on generic Puppeteer, admin email if any fail

## Ashby Null JobBoard Fix (2026-03-07)

### Problem
Sentry alert: `TypeError: Cannot destructure property 'teams' of 'data.data.jobBoard' as it is null` during daily cron. The Ashby GraphQL API returned `jobBoard: null` for Anthropic. Our code destructured `{ teams, jobPostings }` from it without a null check, crashing the Anthropic scrape.

### Root Cause
Missing defensive null check. The Ashby API returned HTTP 200 with valid JSON, but the `jobBoard` field was null (likely a transient API hiccup). The code blindly assumed the response shape would always contain a populated `jobBoard` object.

### Fix
Added null guard before destructuring: if `data.data.jobBoard` is null, log a warning and return an empty job array. The cron continues processing all other companies normally.

### Lesson
External APIs can return null payloads with HTTP 200. Always null-check before destructuring API response objects. Added this as a gotcha in CLAUDE.md to catch similar patterns in other scrapers (Greenhouse, Lever, etc.).

## Multi-User Overhaul Status

The app was converted from single-user to multi-user in Feb 2026. Key changes:
- Companies are a shared catalog (one Uber entry, scraped once)
- Users subscribe via `user_subscriptions` to track companies
- Per-user email alerts based on subscriptions + preferences
- Old `favorites` table replaced by `user_job_favorites`
- Job status lifecycle: active → removed → archived (replaces hard delete)
- **Phase 6 cleanup ready:** `user_id` removed from companies INSERT. Run `scripts/phase6-cleanup.sql` in Supabase SQL Editor to drop old `favorites` table + `companies.user_id` column.
- **Admin email:** Extracted to `backend/src/lib/constants.ts` — reads `ADMIN_EMAIL` env var (Railway), falls back to `vikrant.agar@gmail.com`
- **Admin dashboard:** `/admin` page (frontend) + `/api/admin/*` routes (backend). Access restricted to `ADMIN_EMAIL`.
- **Test account:** Use `vikrant.agar+test@gmail.com` (Gmail `+` alias → same inbox, separate Supabase user). Reset script at `scripts/reset-test-user.sql`.
- **Rate limiting:** General API: 100 req/15min. Write endpoints (POST /api/companies, /api/help): 20 req/15min. Check endpoint (POST /api/companies/check): 5 req/15min. Uses `express-rate-limit`.
- **Toast notifications:** Frontend errors show toast notifications instead of silent console.error. Provider in layout.tsx, hook via `useToast()`.
- **URL dedup:** Company creation checks for existing companies with the same domain. ATS-hosted URLs (Greenhouse, Lever, etc.) use hostname/slug as dedup key.

## Landing Page (added 2026-02-19)

Marketing landing page at `/` for unauthenticated visitors. Authenticated users see the dashboard.

### Architecture
- **Fixed overlay approach**: `LandingPage.tsx` renders as `fixed inset-0 z-[200] overflow-y-auto`, covering the app shell behind it
- Zero changes to `layout.tsx`, `NavBar.tsx`, or `HelpButton.tsx` — they render behind the overlay, invisible
- Self-contained: own nav, footer, scroll behavior
- Auth gating in `page.tsx`: checks `supabase.auth.getSession()` client-side, returns `<LandingPage />` or `<DashboardContent />`
- Middleware allows `/` for unauthenticated users (all other routes still redirect to `/login`)

### 10 Sections
1. Fixed Nav (transparent → navy on scroll, links to #how-it-works, #jobs, /login)
2. Hero (dark gradient, 7 floating company cards with 3 toast notifications, email CTA, company strip)
3. Problem (2x2 pain point cards)
4. How It Works (1x3 step cards)
5. Product Screens (3 macOS-style mock UIs: Dashboard, All Jobs, Job Detail)
6. Latest Jobs (9 sample job rows with hover effects)
7. levels.fyi Callout (salary data card)
8. Stats (4 stat boxes)
9. Final CTA (email input + button)
10. Footer

### Key implementation details
- `mix(hex, pct)` JS function blends brand colors toward white — used for card backgrounds/headers via inline styles
- `useInView()` hook + `Reveal` component for scroll-triggered animations (IntersectionObserver, trigger once)
- Hero cards with toasts are grouped in parent divs that float together; standalone cards float independently
- Nav scroll detection listens to the overlay container (`#landing-scroll-container`), not `window`
- All CTAs link to `/login`
- Custom keyframes in `globals.css`: `heroFloat`, `slideIn`, `pulse`
- Animation tokens in `@theme inline` block for Tailwind v4
- Spec: `docs/specs/NEWPMJOBS-LANDING-SPEC.md`, reference: `docs/specs/newpmjobs-landing-v4.jsx`

### Performance optimization (2026-02-22)
- **Code-split:** `LandingPage.tsx` (1,528 lines) split into above-fold hero (783 lines) + lazy `LandingBelowFold.tsx` (791 lines) via `next/dynamic({ ssr: false })`
- **Pre-computed colors:** `COMPANY_COLORS` map computed once at module level (16 companies x 5 variants), eliminates ~24 runtime `mix()` calls per render
- **Deferred PostHog:** `posthog.init()` moved from top-level module scope to `useEffect` inside `PostHogProvider` — no longer blocks main thread before first paint
- **Browserslist:** Added `"defaults and supports es6-module"` to `frontend/package.json` — drops legacy polyfills like `Number.isInteger`
- **Results:** Desktop Lighthouse 49 → **100** (TBT 0ms). Mobile ~72-77 (unchanged — bottlenecked by React DOM 225KB runtime, not our code).
- **Next step for mobile:** Convert landing page to React Server Component (renders as pure HTML, no React runtime for static sections). This is a bigger architectural change not yet done.

## Check-Then-Add Flow (added 2026-02-20)

Preview scrape results before committing to DB. Nothing saved until user confirms.

### User flow
1. User enters **URL only** (no company name — auto-detected by `detectCompanyName.ts`)
2. Button says **"Check PM Roles"** — calls `POST /api/companies/check`
3. Backend scrapes but does **NOT save to DB** — returns preview
4. User sees: company name (editable), sample job titles + locations, "Found X PM roles — Does this look right?"
5. **Yes, Add It** → `POST /api/companies` with pre-checked `jobs[]` + `platform_type` + `platform_config` (skips re-scraping)
6. **No, Try Again** → retry state with editable URL + feedback textarea
7. **Cancel after feedback** → feedback filed via `POST /api/help` for admin review
8. If URL matches existing company → shows it and offers to subscribe instead

### Backend changes
- `validateCareersUrl()` — extracted shared helper (HTTPS, LinkedIn block, SSRF protection)
- `findExistingCompany()` — extracted dedup check helper
- `POST /api/companies/check` — detect platform → detect name → scrape → validate → return preview (no DB writes)
- `POST /api/companies` — accepts optional `jobs`, `platform_type`, `platform_config` to skip re-scraping; legacy flow still works without them

### Frontend state machine (`AddCompanyModal.tsx` "Add New Company" tab)
`"input"` → `"checking"` → `"preview"` → `"retry"`
- **input**: URL-only field, "Check PM Roles" button
- **checking**: 4-step progress animation (reuses `STEP_DURATIONS` + `getStepLabel`), cancel button
- **preview**: company name input + sample jobs + "Found X roles" summary + "Yes, Add It" / "No, Try Again" buttons. Dedup match shows "Add to Dashboard" subscribe button. Scrape error shows "Try Different URL".
- **retry**: editable URL + feedback textarea, "Re-check" / "Cancel"

## Performance Rules

**These rules apply to ALL code changes — follow automatically, don't wait to be asked.**

1. **Audit for N+1 queries:** After any feature, check if loops issue sequential DB queries. Use `Promise.all()` for independent queries or batch operations.
2. **Parallel over sequential:** If two queries don't depend on each other's results, run them in `Promise.all()`.
3. **Minimize round-trips:** Prefer one batch query over N individual queries.
4. **Index awareness:** New query patterns may need new indexes. Check if WHERE/ORDER BY columns are indexed.
5. **Suggest optimizations:** Before marking any task done, suggest any performance improvements found.
6. **Frontend re-fetches:** Don't re-fetch data that's already available. Pass via props or context.

## Common Operations

### API calls now require auth
All `/api/companies` and `/api/favorites` calls need a Bearer token. For CLI testing, either:
1. Use the cron endpoint (secret-based, no JWT): `curl -s -H "Authorization: Bearer $CRON_SECRET" "https://api.<your-domain>/api/cron/trigger"`
2. Or use the app UI — CLI curl to protected endpoints requires a valid user JWT.

### Delete and re-add a company (to fix corrupted data)
Best done via the app UI (delete button on dashboard tile, then Add Company page). For CLI:
```bash
# Health check (no auth needed)
curl -s "https://api.<your-domain>/api/health"
```

### Test a Greenhouse board exists
```bash
curl -s "https://api.greenhouse.io/v1/boards/{boardname}/jobs" | head -c 200
```

### Verify deployment worked
```bash
curl -s "https://api.<your-domain>/api/health"
```

## Monetization Planning (2026-03-07)

### Context
Three feature requests from user feedback: (1) real-time job checking for high-priority companies, (2) WhatsApp + SMS notifications, (3) paid subscription to gate these features.

### What was decided
- **Tier structure:** Free ($0) vs Premium ($7/month)
- **Free tier:** 10 companies, daily checks, email only (unchanged from current behavior)
- **Premium tier:** 50 companies, 30-min priority checks (API platforms only), email + WhatsApp + SMS, real-time alerts
- **3-phase rollout:** Stripe Billing first (foundation) → Priority Checking → WhatsApp/SMS via Twilio

### Key decisions and alternatives considered

**Pricing: $7/month flat.**
- $5 felt throwaway, $10 adds purchase friction for a job search tool
- Flat rate chosen over usage-based because predictability matters for job seekers (they're already stressed)
- No free trial — the free tier IS the trial

**Priority checks: API-only, business hours only.**
- Puppeteer companies (Stripe, Google, ~6 total) excluded — too slow/expensive to poll every 30 min
- Business hours only (Mon-Fri 8am-6pm ET) because job postings are published during work hours
- Hash-based change detection so most checks complete in <1s (just an API call + MD5 comparison)
- Additional cost: ~$0.17/month Railway compute

**Notifications: Twilio for both WhatsApp and SMS.**
- Single vendor for both channels (vs. Meta Cloud API for WhatsApp + separate SMS provider)
- WhatsApp nearly free (1K service-initiated conversations/month included by Meta)
- SMS is the cost driver (~$0.008/msg) — may become a separate add-on if volume grows

**Billing: Stripe Checkout (hosted page).**
- Zero PCI compliance burden, zero payment form UI, zero fraud detection to build
- 2.9% + $0.30 per charge (~$0.50 per $7 subscription)
- Breakeven at 4 premium subscribers

### Planning artifacts
- `docs/monetization-plan.md` — full implementation spec with code patterns, DB schemas, API designs
- `docs/backlog.md` — itemized feature backlog with priorities and effort estimates
- Both are gitignored (local reference only, not committed)

## Scraper Self-Healing and Auto-Remediation (2026-03-20)

### Context
Four companies were failing in daily cron: Anthropic (Ashby → Greenhouse migration), Microsoft (Eightfold domain extraction bug), Atlassian (0 PM roles in category), Slack (0 PM roles but scraper worked). The user wanted the system to fix itself rather than just report failures.

### What was decided

**Auto-remediation via broadATSDiscovery for all non-custom companies.**
- When a scraper returns 0 jobs and the company isn't a custom scraper, broadATSDiscovery runs to check if the company changed ATS platforms
- If a new platform is found, the system auto-updates DB, re-scrapes, and tracks the remediation
- Custom scrapers (Stripe, EA, Atlassian, Netflix, Uber, Google) are excluded via CUSTOM_SCRAPER_HOSTS blocklist

**Two-tier admin email: auto-fixed vs still-broken.**
- Green section shows companies that were auto-remediated (e.g., "Anthropic: ashby → greenhouse")
- Red section shows companies that still need manual attention
- Subject line reflects both: "N auto-fixed, M still broken" or "N issues auto-fixed ✓"

**Removed false alert on rawJobs.length === 0.**
- Most scrapers pre-filter by PM_KEYWORDS internally, so 0 raw jobs = "no PM roles" not "broken scraper"
- Real failures throw exceptions and are caught by the catch block
- This eliminated false alerts for Bitkraft and Slack

**Eightfold custom domain handling.**
- Microsoft uses `apply.careers.microsoft.com` (custom domain) instead of `*.eightfold.ai`
- Domain extraction logic now handles both standard eightfold subdomains and custom domains
- Added HTML response guard (Eightfold API sometimes returns HTML "Not Found" with 200 status)

**Anthropic platform migration: Ashby → Greenhouse.**
- Anthropic migrated from Ashby to Greenhouse. Updated DB platform_type, cleared stale jobs, added to atsRegistry
- This was the first real-world test of the auto-remediation system

### Key decisions and alternatives considered

**Session-start health check pattern.**
- Claude should proactively query for scrape failures at conversation start and fix them without being asked
- Alternative: wait for user to report issues → rejected because user is often AFK
- Stored as a feedback memory for future sessions

**Auto-remediation scope: broadATSDiscovery only.**
- Only auto-remediates when a known ATS platform change is detected
- Custom scraper failures (Atlassian) still require manual investigation
- Alternative: try all scraper types blindly → rejected, too expensive and could produce false positives

## Backend US Location Filtering + Daily Quality Eval (2026-03-22)

### Context
Microsoft showed 157 PM jobs in the daily email. Many were from India, UK, and other non-US locations. Root cause: location filtering only existed as a frontend UI toggle (`isUSLocation()` in `frontend/src/lib/jobFilters.ts`). The backend stored and emailed ALL global PM jobs with no location filtering. The user also wanted an automated daily evaluation that catches data quality issues before they reach users.

### What was decided

**Backend US location filtering in `validateScrapeResults`.**
- Ported `isUSLocation()` to `backend/src/lib/locationFilter.ts` with enhanced `NON_US_PATTERNS` (60+ patterns covering India, UK, Germany, France, Canada, Australia, Singapore, Japan, China, and many more)
- Added as second filter pass in `validateScrapeResults()`: PM keyword filter → US location filter
- Non-US jobs never enter the `seen_jobs` table, so `total_product_jobs` and email alerts automatically become US-only
- Unknown locations (no match either way) default to excluded (safer than including unknown international locations)
- Alternative: add `is_us_location` column to DB and filter in queries → rejected, simpler to not store non-US jobs at all. Can revisit if international support is needed.

**Daily quality evaluation with per-company scorecard.**
- New `dailyEval.ts` runs after scraping, before user emails
- Checks per company: absurd job count (>100 = critical), high non-US ratio (>50% = warning), sudden spike (>100% + >10 absolute), sudden drop (>50% + >10 absolute), zero jobs for subscribed companies (info), low quality score (<50 = warning)
- Admin email shows full scorecard table for every company: US jobs, non-US filtered, previous count, change indicator (+/-), quality score, and status (issues or "all checks passed")
- Companies with issues sort to top (critical > warning > info), clean companies at bottom
- Includes checks legend explaining what each check does and its threshold
- Always sends (even when all clear) so admin knows it ran
- Critical issues also go to Sentry
- Alternative: separate eval endpoint → rejected, cleaner to run as part of cron pipeline

### Key decisions and alternatives considered

**Filter at validation, not at scraper level.**
- All scrapers flow through `validateScrapeResults()`, so the location filter applies universally
- Alternative: add location filtering to each individual scraper → rejected, too many places to maintain (8+ scrapers)

**Default unknown locations to excluded.**
- Frontend `isUSLocation()` defaulted unknown to included. Backend version defaults to excluded.
- Rationale: safer to miss a few US jobs with unusual location strings than to include India/UK jobs
- "Remote" without other qualifiers matches US_PATTERNS (treated as US)

## Microsoft Title Filtering + Canadian Location Fix (2026-04-01)

### Context
Daily quality eval flagged Microsoft with 123 active US PM jobs ("Absurd job count"). Investigation revealed only 66 were actual Product Manager roles. 35 were Technical Program Managers, 22 were other program manager variants (Business PM, Customer Experience PM, Supply Chain PM, etc.). The `COMPANY_EXTRA_KEYWORDS` mechanism that adds "program manager" for Microsoft was bypassing ALL hard exclusions, including the "technical program" exclusion that should have caught TPMs. Separately, one Ontario, Canada job (`ON,CA`) leaked through the US location filter because the structured format parser required 3+ comma-separated parts but this format only has 2.

### What was decided

**Company-specific exclusions (`COMPANY_EXTRA_EXCLUSIONS`) in `validateScrape.ts`.**
- Added a new exclusion list that applies even when company extra keywords match
- For Microsoft: "technical program", "business program", "customer experience program", "supply chain program", "content program", "data center program", "datacenter program", "environment program", "silicon program", "strategy & operations program", "platform technical program"
- This keeps pure "Program Manager" and "Product Manager" titles while rejecting non-product PM variants
- Alternative: remove the Microsoft "program manager" exception entirely → rejected, Microsoft's core PM title IS "Program Manager" and many legitimate PM roles use it
- Alternative: try to detect Microsoft teams/orgs from title to distinguish real PMs → rejected, too fragile and Microsoft doesn't consistently include team names

**Lowered structured location format check from 3+ to 2+ parts in `locationFilter.ts`.**
- Eightfold returns both `City, State, US` (3 parts) and `State,CountryCode` (2 parts)
- `ON,CA` has 2 parts: `["ON", "CA"]` where CA = Canada country code, not California state
- With 3+ parts requirement, it fell through to regex matching where `/\bCA\b/` matched California
- Now any `XX,CC` where CC is a 2-letter code != US is rejected
- Confirmed `MD,US` (Maryland, US) still passes correctly

**DB cleanup: removed 48 non-PM Microsoft jobs immediately.**
- Marked as `status = 'removed'` rather than waiting for next cron cycle
- Reduced Microsoft active count from 123 to 75

### Key insight
Microsoft genuinely has ~66+ distinct US PM openings at any time. They're not reposts — each has a unique Eightfold job ID. "Principal Product Manager" alone had 16 listings across different orgs. The big daily batches (81 on Mar 25, 63 on Mar 31) are real new postings, not dedup failures. Jobs also churn fast — 20 were already marked removed on Apr 1.

---

## 2026-04-21 — Puppeteer Mass Migration to API Scrapers

### Context
All 10 Puppeteer-dependent companies failed simultaneously with identical `posix_spawn` Chrome crash errors. Root cause: `ghcr.io/puppeteer/puppeteer:latest` Docker image pulled a broken Chrome build. This was 18% of all tracked companies (10/55), including high-subscriber companies like Google (19), LinkedIn (11), and eBay (7).

### What was decided

**Migrate 7 of 10 companies to API-based scrapers (no Puppeteer needed).**
For each failing company, researched the actual ATS platform by probing Greenhouse, Lever, Workday, iCIMS, and company-specific API endpoints. Results:

| Company | ATS Found | Scraper Added |
|---------|-----------|--------------|
| Datadog | Greenhouse | Added to atsRegistry (board: `datadog`) |
| LinkedIn | Greenhouse | Added to atsRegistry (board: `linkedin`) |
| Amazon | Custom JSON API | `amazon.jobs/en/search.json` with pagination |
| Rivian | iCIMS REST API | `careers.rivian.com/api/jobs` (new scraper type) |
| Costco | iCIMS REST API | `careers.costco.com/api/jobs` (new scraper type) |
| Intuit | TalentBrew/Radancy | HTML-in-JSON parser (new scraper type) |
| Zerodha | Custom REST API | `careers.zerodha.com/api/jobs` (0 jobs currently) |

- Alternative: Fix Puppeteer for all 10 → rejected as sole approach, API scrapers are more reliable and faster
- Alternative: Drop the failing companies → rejected, Google and LinkedIn have high subscriber counts

**Pin Docker base image from `:latest` to `:24.2.0` for remaining 3 Puppeteer companies.**
- eBay (Phenom People): API requires auth tokens, no clean API path
- Google: Custom SPA, no JSON API found
- Ametek: SAP SuccessFactors, no public API

**New iCIMS REST API scraper (`scrapeICIMSAPICareers`).**
- iCIMS sites expose `/api/jobs` endpoint returning paginated JSON
- Different instances handle query params differently: Costco filters on `keywords=`, Rivian's `q=` returns all jobs
- Uses `keywords` param for filtering, paginates with `limit`/`offset`

**New TalentBrew HTML parser (`scrapeIntuitCareers`).**
- TalentBrew (by Radancy) returns HTML fragments inside a JSON envelope
- Parses `<li>` elements with regex for title, location, URL
- Paginates via `CurrentPage` parameter

### Key insight
Most "generic" Puppeteer companies aren't actually generic — they have discoverable APIs if you probe for them. The label "generic" in the DB was a lazy default, not an accurate platform assessment. Probing 10 companies revealed that 7 had clean API paths. The real takeaway: when Puppeteer breaks, the fix isn't to fix Puppeteer — it's to eliminate the dependency.

---

## 2026-04-22 — Catalog Expansion to 126 Companies + Full Audit

### Context
Expanded from 55 to 126 companies by researching ATS platforms for all major US PM employers. Removed 2 India-focused companies (Zerodha, Razorpay). Built Oracle HCM scraper for JPMorgan Chase and Oracle. Ran Phase 6 migration (dropped legacy `favorites` table and `companies.user_id`). Completed full system audit and fixed 16 issues.

### What was decided

**Research-first approach to company additions.**
- For each of 73 companies, probed Greenhouse, Lever, Ashby, Workday, Eightfold, SmartRecruiters, and iCIMS APIs before adding
- 118 of 126 companies use API-based scrapers (no Puppeteer)
- 8 companies need Puppeteer: Google, eBay, Ametek, Apple, Meta, Wayfair, Tesla, TikTok
- Apple will likely show 0 PM jobs (they use "Engineering Program Manager" not "Product Manager")

**Built Oracle HCM Cloud scraper for JPMorgan and Oracle.**
- New platform type `oracle_hcm` with `tenantUrl` and `siteNumber` config
- Uses `recruitingCEJobRequisitions` REST API
- Input validation on tenantUrl (must be *.oraclecloud.com) and siteNumber (alphanumeric)

**Puppeteer version pinned to exact 24.2.0 (no caret).**
- `^24.2.0` resolved to 24.36.1 which downloaded Chrome 144 (broken)
- Docker image 24.2.0 bundles Chrome for puppeteer 24.2.0
- Must pin exact version so npm package and Docker image use the same Chrome

**Ran Phase 6 migration.**
- Dropped `companies.user_id` column (replaced by `user_subscriptions` table in multi-user overhaul)
- Dropped `favorites` table (replaced by `user_job_favorites`)
- Added `idx_seen_jobs_status_first_seen` index
- Fixed code reference in admin add-company before dropping column

**Full system audit: 16 issues found and fixed.**
- Critical: CUSTOM_SCRAPER_HOSTS blocklist was missing Amazon, Intuit, Rivian, Costco
- Critical: Dead Zerodha scraper code removed
- Important: `greenhouse_departments` added to platform switch, Oregon pattern made case-sensitive, empty locations default to excluded, fetch timeouts added, null checks added
- Minor: Docker USER explicit, Oracle HCM input validation, linkedin.com registry narrowed

### Key insight
Puppeteer npm version and Docker image version must match exactly. Docker image `ghcr.io/puppeteer/puppeteer:24.2.0` bundles Chrome for puppeteer 24.2.0. If `package.json` uses `^24.2.0`, npm resolves to the latest 24.x (24.36.1), which needs a different Chrome than what's in the image. The fix is `"puppeteer": "24.2.0"` (no caret). Three separate Dockerfile attempts failed before this root cause was identified.

---

## 2026-04-23 — Location Filter Critical Bug: US State Abbreviations Rejected

### Context
Daily quality eval showed Lyft, Robinhood, Gusto, Duolingo, Scale AI, Visa, and others with 0 US jobs despite having obvious US PM roles (San Francisco, CA; New York, NY). All jobs were being classified as non-US.

### What was decided
Root cause: The April 1 fix for "ON,CA" (Ontario, Canada) changed the structured format check from 3+ parts to 2+ parts. This made "San Francisco, CA" trigger the check: "CA" is a 2-letter code != "US", so it was rejected. Every US city/state location was silently filtered out for ~3 weeks.

**Added `US_STATES` set to `locationFilter.ts`.**
- 50 states + DC + PR/GU/VI/AS/MP
- 2-letter code check now skips US state abbreviations
- "San Francisco, CA" → CA is a US state → passes
- "Bengaluru, KA, IN" → IN is not a US state → rejected

**Added Canadian province patterns to `NON_US_PATTERNS`.**
- "ON,CA" now caught by explicit `/\bON,\s*CA\b/` pattern
- Also added BC,CA; AB,CA; QC,CA; etc.
- Added city names: Ottawa, Calgary, Edmonton, Winnipeg

### Key insight
Location filter bugs are invisible. The scraper succeeds, jobs are simply excluded silently. The only signal was the daily quality eval's "high non-US ratio" flag. Without that monitoring layer (added in Phase 16), this bug would have silently excluded US jobs for months. The lesson from the original April 1 fix also applies: a fix for one edge case ("ON,CA") can break the common case ("San Francisco, CA") if the abstraction is too broad.

### Results (2026-04-25)
All 126 companies succeeding with zero errors. Recovered: Lyft 13 jobs, Robinhood 6, Gusto 10, Duolingo 9, Google 42, eBay 3. Puppeteer fix also confirmed working.

---

## 2026-04-26 — Simplified Daily Quality Eval

### Context
The daily quality email was flagging 20+ companies every day with warnings that were correct but not actionable: "Amazon has 252 PM jobs" (yes, they're a huge company), "Visa has 100% non-US ratio" (yes, their PM roles are in Poland), "Contentful has 100% non-US" (yes, they're European). The email was noise, not signal. The user's goal was catching broken scrapers, not monitoring steady-state counts.

### What was decided
Removed three checks that generated repeat noise:
- "Absurd job count" (>100) — spike detection catches anomalies, steady high counts aren't problems
- "High non-US ratio" (>50%) — the filter is working correctly, not worth reporting daily
- "Low quality score" (<50) — derivative of other checks, not independently useful

Kept two checks that catch real problems:
- Spike/drop detection (>100%/50% change AND >10 absolute change)
- Zero jobs for subscribed companies (direct user impact)

Added one new check:
- First-scrape results (shows a company's first scrape results once, so admin can eyeball new additions)

### Key insight
Monitoring that alerts on known-good states trains you to ignore the alerts. The email goes from "daily health report" to "daily annoyance." The right threshold for automated monitoring isn't "anything unusual" — it's "anything that changed unexpectedly." Steady states, even unusual ones, should be silent.
