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

## 2026-05-08 — Self-Healing Scrapers + Coinbase Goes Dark

### Context
Session opened with a single failure flagged: Coinbase. Their public Greenhouse board (`boards-api.greenhouse.io/v1/boards/coinbase`) had returned 404 on every endpoint — the board was deleted, not renamed. Investigation showed Coinbase rebuilt their careers experience as a custom SPA at `coinbase.com/careers/positions` (server-redirects to `/careers`) backed by an internal `api.coinbase.com/v2/careers` endpoint that requires authenticated/cookied requests. Even from inside a stealth-rendered Puppeteer browser with all the right `X-CB-*` headers, the API returns HTTP 400 — server-side rejection of public scraping.

User pointed out Coinbase recently announced layoffs, so this could equally be a hiring freeze plus protective lockdown rather than purely anti-scrape. Either way, no clean path to scrape them right now.

### What was decided
Instead of fighting Coinbase specifically, build a generalized self-healing layer so this never has to be a manual session again. Three tiers of recovery now run automatically when any company returns 0 jobs:

1. **Configured platform scraper** — uses `platform_type` from the DB (existing)
2. **broadATSDiscovery** — auto-detects new ATS, updates DB on success (existing, skipped for `CUSTOM_SCRAPER_HOSTS`)
3. **stealthFallbackScrape (NEW)** — generic last-resort using `puppeteer-extra` + `puppeteer-extra-plugin-stealth`. Sniffs every JSON XHR response for arrays of objects with title+id-like fields, falls back to DOM extraction. Runs for ALL companies including custom-scraper hosts.

When all three tiers fail, a `consecutive_failure_count` column on `companies` increments. After 7 consecutive days, `auto_disabled = true` and the cron loop skips the company. Every Monday UTC the cron probes auto-disabled companies once and re-enables them automatically if jobs return — handles the "Coinbase reopens" case without manual intervention. Successful scrape resets both flags to zero.

Admin email gets four colored sections instead of two: green "Watch-list re-enabled," green "Auto-fixed," green "Stealth fallback recovered," orange "Auto-disabled," red "Still needs attention." Coinbase will appear once in orange when it auto-disables in ~7 days, then go silent.

### Alternatives considered
- **Hard-delete Coinbase from catalog.** Cleanest but loses the company permanently and doesn't help the next company that breaks the same way. Rejected in favor of building general recovery.
- **Reverse-engineer Coinbase's `X-CB-*` headers and signed cookies.** Possible but brittle — they'll change it within months and we're back to square one. Rejected.
- **Use a paid scraping service (Browserless / Bright Data).** Would solve Cloudflare bot detection. Adds ongoing cost and a vendor dependency for one company. Rejected at this scale.
- **Auto-disable threshold of 3 days vs 7.** 7 chosen because some companies legitimately have 0 PM roles for a week (small companies, hiring pauses). 3 would auto-disable real companies that just aren't hiring.

### Key insights
- The right fix for "this one company broke" is usually "build the recovery system that catches the next ten." Coinbase's specific problem is unsolvable without their cooperation, but the architecture that handles it gracefully also handles every silent ATS migration that hasn't happened yet.
- **Throw vs return-empty matters for tiered recovery.** Tier-1 scrapers that throw bypass tiers 2 and 3. Pattern is now: return `[]` for known/expected failures so auto-healing runs, reserve exceptions for genuinely unexpected errors. Updated `scrapeCoinbaseCareers` to this pattern.
- **Stealth Puppeteer dodges fingerprinting, not server-side bot rejection.** Cloudflare's challenge page is one thing; an application-level 400 from the origin server is another. Stealth helps with the former, can't touch the latter. Useful tool but not magic.

### Pending decision
User asked whether the system could try to fix broken scrapers itself, not just retry. Proposal sketched but not yet built: when auto-disable triggers, snapshot diagnostics (HTML, network log, error message) and send to the Claude API with a structured prompt asking for a `platform_type + platform_config` proposal. The system tries the proposal in propose-mode (emails admin "click to apply") rather than auto-applying, to avoid hallucinated configs. Estimated cost ~$1-3/year, build is ~half a session. Awaiting user approval to proceed.

## 2026-05-11 — Email Consolidation + Stealth Fix + End-to-End Security Audit

### Context

Three related operational issues opened the session:

1. User was getting **three admin emails per day** from the cron: a scrape report, a daily quality eval, and a separate failure notification when email batches failed. Most of the content was "FYI, system recovered" noise — not action items.
2. The "stealth fallback recovered jobs" line was firing for **13 companies daily**, suggesting widespread Tier-1 breakage. Investigation showed it was actually doing wasteful duplicate work for companies with legitimate zero PM roles (Block had 50 jobs, none PMs; Wiz had 202, none PMs; etc.). Only LinkedIn-style cases were real recoveries.
3. The last security audit was ~16 days old. With Stripe Billing on the roadmap, time for a fresh pass before adding payment processing.

### What was decided — three commits

**1. Email consolidation** (commit `ed40c5b`)

One `sendAdminDigest()` replaces three separate emails. Daily: silent unless action items present (failed scrapes, watch list at 3-6 strikes, auto-disabled, subscribed-company-dropped-to-zero, email send failures). Monday: same email picks up a weekly digest section with system health + past-7-days self-heal log queried from new `scraper_events` table (audit-log table for self-healing actions, indexed on `created_at DESC`).

**2. Layer 2 stealth fix** (commit `d728f12`)

Added `ScrapeStats` out-param. Filter-heavy scrapers (Greenhouse, Workday, Ashby) now write their pre-PM-filter raw count. dailyCheck only triggers stealth fallback when both `rawJobs.length === 0 AND scrapeStats.totalScanned === 0` — true source failure. Cuts stealth runs from ~13/day to ~3/day.

**3. Layer 1 stealth auto-fix** (commit `a1fa23c`)

`stealthFallbackScrape` now returns `{ jobs, sniffedUrl, via }` instead of just `jobs`. New `inferPlatformFromSniffedUrl()` maps known patterns (Greenhouse, Lever, Ashby, SmartRecruiters APIs) back to `platform_type + platform_config`. On match, cron auto-updates the company so next run skips stealth entirely. Unknown URLs (e.g., LinkedIn's in-house career API) get logged to `scraper_events` for Monday digest visibility.

### Security audit + hardening (commit `164606f`)

Ran three parallel review agents focused on (a) auth flow, (b) data isolation, (c) infrastructure + monetization readiness. **Eleven findings, all shipped in one commit.**

**Exploitable (RED):**
- **Cookies were not HttpOnly.** Three places (`auth/confirm/route.ts`, `auth/callback/route.ts`, `middleware.ts`) explicitly stripped HttpOnly via `{ ...options, httpOnly: false }`. The `/api/auth/token` bridge route existed specifically because of HttpOnly, defeated by the override. Removed override in all three.
- **`GET /api/companies/:id` returned any company's full job list to non-subscribers.** Added 403 guard after loading user's subscription list.
- **`CRON_SECRET` compared with plain `===`** (timing-attack vulnerable). New `safeCompareSecret()` helper using `crypto.timingSafeEqual` with length equalization. Applied to `/api/cron/trigger` and `/api/admin/add-company`. Reusable for upcoming Stripe webhook signature verification.
- **`npm audit fix` in backend:** closed `express-rate-limit` CVE (IPv4-mapped IPv6 bypass on Railway dual-stack), `path-to-regexp` ReDoS, `qs` DoS, `minimatch` ReDoS. 7 vulns → 0.
- **`npm audit fix` in frontend:** 12 vulns → 2 (remaining 2 are build-time only inside Next.js internals).

**Defense-in-depth (YELLOW):**
- JWT verification now validates `audience: "authenticated"` and `issuer: <supabase-url>/auth/v1` (was only signature + HS256 pinned).
- `requireAuth` fails closed at boot if `SUPABASE_JWT_SECRET` missing in production; Sentry alert when API fallback runs.
- `POST /api/favorites/:jobId` and `POST /api/issues` now require subscription check on the relevant company.
- `express.json()` body limit set to 256kb (was unbounded). `/api/issues.description` capped at 5000 chars.
- RLS enabled on new `scraper_events` table. Verified all other user-scoped tables have RLS + `auth.uid() = user_id` policies via Supabase MCP.

### Weekly security check (commit `d5316e1`)

New `backend/src/jobs/securityCheck.ts` module. Monday cron runs `npm audit --json --omit=dev` against backend production deps, snapshots vuln fingerprints to new `security_snapshots` table, diffs against previous Monday's snapshot, surfaces new/resolved/ongoing in admin digest. Failures don't break the cron — silently skip the section on error and log to Sentry.

### Alternatives considered

- **Split Monday into a separate email from the daily.** Considered, rejected. Splitting partially undoes the consolidation we just did. Most Mondays will have no daily action items anyway, so the Monday email is functionally a weekly digest already.
- **Frontend npm audit in the same Monday check.** Frontend doesn't deploy to Railway, so the cron container can't run it directly. Would need a Vercel build hook or scraping the lock file from GitHub. Deferred — easier to configure Vercel to fail builds on high-severity vulns.
- **Ship CSP `unsafe-inline` removal in the same security commit.** Could break Sentry/PostHog inline scripts at runtime. Bundling a CSP change with a security commit makes rollback messier. Deferred to a separate Vercel-preview-tested commit before public marketing launch.
- **Bump Next.js 16.1.6 → 16.2.6 to close last 2 frontend vulns.** Minor bump within Next 16. Vulns are build-time only (picomatch + postcss in Next internals). Deferred to next opportunistic Next.js work.
- **Manual fix for LinkedIn's fake Greenhouse board (`linkedin` board is actually "LI Test Company" — test/staging data, not real LinkedIn).** Considered, deferred. Layer 1 auto-fix will discover the real URL (`linkedin.com/...`) on next cron run and log it. Will decide whether to build a custom scraper based on what Monday digest surfaces.

### Key insights

- **Documentation drifts from code during refactors.** The cookie HttpOnly override was added during some past refactor and never reverted. Docs claimed HttpOnly. The `/api/auth/token` bridge route, built specifically because of HttpOnly, kept working because the override happened to not break it. Audits exist to compare what you think is happening against what is actually happening — never because someone is lying, just because docs drift naturally.
- **Action-only alerting beats activity logging.** A self-healing system that emails you about every recovery trains you to ignore the channel. By the time something actually needs attention, you've been habituated to skip the inbox notification. The fix is silent-by-default daily emails, with successes audited to a database for weekly review.
- **Specialized > general for security audits.** Three agents each scoped to one surface (auth, data isolation, infra) found things a single general review would have missed. The HttpOnly bug specifically was caught because one agent compared cookie setter code against the documented design rather than just against best practices.
- **Pre-filter count vs post-filter count is a meaningful distinction in tiered recovery.** Zero post-filter jobs can mean "source returned nothing" OR "source returned data, just nothing matched our filter." These need different recovery responses. Out-param pattern lets each scraper signal both states cheaply.
- **Build the weekly monitoring once.** Adding npm-audit to the Monday cron took ~45 min. Catches new CVEs the week after they're published, instead of waiting for the next manual audit. The opportunity cost of building it is tiny; the cost of NOT building it could have been shipping Stripe Billing with a known CVE in a transitive dep.

### Bug-reporting system clarification
User asked what they use for bug reports — it's a custom-built widget (`HelpButton.tsx` → `POST /api/help` → `help_submissions` table + admin email via Resend → admin dashboard view). Not a third-party tool. $0 incremental cost, ~120 lines of React + one Express endpoint.

### Files created
- `backend/src/jobs/securityCheck.ts` — weekly npm audit + diff
- `docs/security-log.md` (gitignored) — running record of audits, fixes, deferred items
- New tables: `scraper_events`, `security_snapshots`

### Deferred items (tracked in `docs/security-log.md`)
- **D1**: Frontend CSP `unsafe-inline` removal (needs runtime testing)
- **D2**: Next.js 16.1.6 → 16.2.6 bump (closes last 2 build-time frontend vulns)
- **D3**: `/api/auth/token` rate limit (Next.js route, low exploitability)
- **D4**: Vercel "fail build on high severity audit" toggle
- **P1**: Stripe billing schema (`billing_subscriptions` table with `stripe_customer_id`)
- **P2**: Raw-body parser for `POST /api/stripe/webhook` (mount BEFORE `express.json()`)
- **P3**: `requirePremium` middleware extensibility point

## 2026-05-12 — Catalog Expansion (124 → 220) + Weekly Digest on Mon+Tue

### Context

Two threads in one session:

1. **Catalog scale-up.** User wants the catalog to feel like "a real database, not a personal tool." Current size of ~124 felt small compared to the target of 500-1000. User specifically called out missing AI startups (Wispr Flow, Harvey) and asked for gaming + biotech + other West Coast tech additions.
2. **Weekly digest cadence.** User wanted the full Monday-style weekly digest (system health + 7-day self-heal log + npm-audit security check) to also fire on Tuesday so they have a two-day window to review it instead of one shot per week.

### What was decided

**Bulk catalog expansion: +96 companies in one batch.**

Wrote a one-off Node.js script (`backend/src/scripts/bulk-add-companies.js`, gitignored) that:
1. Iterates a hardcoded list of ~94 (name, careers_url) tuples
2. Calls the existing compiled `detectPlatform` from `dist/` for each
3. Appends a JSONL line per company to `detected-companies.jsonl`

Detection ran in ~10 min (most companies were trivial hostname matches; Puppeteer fallback for ~20 unknowns). Then a second script (`generate-insert-sql.js`) converted the JSONL to a single SQL `INSERT ... ON CONFLICT DO NOTHING` batch, which was executed via Supabase MCP (since local `SUPABASE_SERVICE_KEY` is a placeholder).

Categories added:
- **Hot AI startups (19)**: Perplexity, Glean, Sierra, Harvey, Wispr Flow, Decagon, Cursor, Windsurf, Together AI, Replicate, Cresta, Writer, Replit, xAI, Pika, Character.AI, Magic, Imbue, Figure AI
- **Dev tools (14)**: Sentry, Linear, Retool, Webflow, Hex, Supabase, Convex, PlanetScale, Neon, Pinecone, GitLab, Statsig, Sumo Logic, Splunk
- **Gaming (10)**: Niantic, Zynga, Riot Games, Epic Games, Unity, Bungie, Sony Interactive Entertainment, HoYoverse, Pokemon Company International, 2K Games
- **Biotech/pharma (14)**: Genentech, Gilead Sciences, Amgen, Illumina, BeiGene, Twist Bioscience, 10x Genomics, Guardant Health, Exelixis, BioMarin, Verily, Color Health, 23andMe, insitro
- **Hardware/space (5)**: SpaceX, Wisk Aero, Saildrone, Vast Space, Cruise
- **Streaming (2)**: Disney, Pandora
- **EdTech (5)**: Coursera, Chegg, Khan Academy, Quizlet, MasterClass
- **Fintech (4)**: Bolt, Modern Treasury, Kraken, Anrok
- **Crypto (3)**: Solana Labs, Aptos Labs, Mysten Labs
- **Misc West Coast tech (18)**: Patreon, Strava, Hims & Hers, Calm, Quora, Twitch, Skydio, Archer Aviation, Joby Aviation, Faire, Whatnot, Grammarly, Lattice, Carta, Substack, Bluesky, Allbirds, Stitch Fix

Platform breakdown of new entries:
- greenhouse: 32, ashby: 29, workday: 7, lever: 4, smartrecruiters: 2, icims: 1, generic: 19 (left for cron auto-detect)

**Three detection overrides after spot-check:**
- **Niantic → Greenhouse "scopely"**: Initially looked like a false positive. WebFetch revealed Niantic redirects to scopely.com/join-us — they merged. Detection was correct; reverted my null override.
- **xAI → Greenhouse "xai"**: Initial detection picked SmartRecruiters slug "x" (low confidence). Direct API check at `boards-api.greenhouse.io/v1/boards/xai/jobs` confirmed 200+ jobs at xai. Set correctly.
- **Zynga, Solana Labs → NULL**: No public ATS detected. Solana uses Getro (talent-network platform not in our registry). Stealth fallback (Layer 3) will handle on first cron run.

**Weekly digest fires Mon + Tue UTC (commit `f1810e2`).**

Single-line condition change in `sendConsolidatedAdminDigest`:
```javascript
const isMondayDigest = input.forceMondayDigest || dayOfWeek === 1 || dayOfWeek === 2;
```

Also fixed `runSecurityCheck` to query the most recent snapshot at least 6 days old (instead of "latest"). Without this, Tuesday would diff against Monday's snapshot and always show "0 new vulns since yesterday" — technically correct but useless. With the 6-day floor, both Monday and Tuesday show genuine week-over-week deltas.

**Ad-hoc trigger: `forceMondayDigest=true` query param (commit `db5c270`).**

Added to `/api/cron/trigger`. Lets the admin request a Monday-style report on any day without modifying code. Combined with `skipEmails=true` (suppresses per-user job alerts so subscribers don't get duplicates from a mid-day manual run), it's a clean way to get the weekly digest on demand.

### Alternatives considered

- **Add companies in smaller batches with manual review per group.** Considered; rejected. User explicitly said "I don't think you even need to group them. I think all of them are fine." Trust the user's go-big stance and the self-healing layer to catch any bad inserts.
- **Use the production `/api/admin/add-company` endpoint with CRON_SECRET for each company.** Considered; rejected. Local CRON_SECRET is `test-secret-123` (placeholder), so this would have required user to share their Railway secret. Faster to run `detectPlatform` locally and bulk-insert via Supabase MCP.
- **Skip platform detection and insert all 94 with `platform_type=NULL`, let cron auto-detect.** User explicitly said: "you should absolutely always, always do platform detection." Run detection upfront so tomorrow's first scrape has the right config and Layer 2/3 only handle genuine edge cases.
- **Split Monday vs Tuesday digest content (e.g., Mon = system health, Tue = security check).** Considered; rejected as overcomplication. User wants the FULL report both days. Simpler to fire the same digest twice, with security diff window adjusted to stay week-over-week.

### Key insights

- **Bulk-add tooling is reusable. Don't throw it away.** Moved `bulk-add-companies.js` and `generate-insert-sql.js` to `backend/src/scripts/` (gitignored) for next batch. User wants to keep growing the catalog toward 500-1000, so this pattern will repeat.
- **Detection false positives need spot-checking.** `detectPlatform`'s speculative API probes can match a different company that happens to share a slug. The `isProbeNameMatch()` guard catches some of these, but not all (Niantic → "scopely" via probe; Solana → "sphere-laboratories" via probe). Always sample 5-10 medium-confidence detections after a bulk run.
- **The self-healing layer is the safety net for batch operations.** Of 94 new companies, ~28 have `platform_type=NULL`. Pre-cron, that would have been worrying. With Layer 2/3 in place, those companies just get a slower first scrape (broadATSDiscovery + stealth fallback) and the Monday digest surfaces any that genuinely failed. Bulk operations are safer because of the recovery infrastructure.
- **Cadence > schedule precision for operational reports.** Firing the weekly digest on Mon AND Tue means a two-day window to review. The marginal cost (one extra email per week, partially overlapping content) is tiny. The benefit (user doesn't miss the report if Monday gets buried) is real.

### Files / artifacts
- `backend/src/scripts/bulk-add-companies.js` — reusable bulk-add (gitignored)
- `backend/src/scripts/generate-insert-sql.js` — JSONL → SQL converter (gitignored)
- `backend/src/scripts/detected-companies.jsonl` — output of last run (gitignored)
- `backend/src/jobs/dailyCheck.ts` — Mon+Tue digest condition
- `backend/src/jobs/securityCheck.ts` — 6-day snapshot floor for diff
- `backend/src/index.ts` — `forceMondayDigest` query param

### Next batch — open ideas
- More biotech / pharma (we got 14; there are 50+ notable West Coast biotechs)
- Defense / aerospace (Hadrian, Shield AI, Helsing, Saronic, Vannevar Labs)
- Specific verticals: logistics, insurance tech, agtech, climate
- East Coast tech if going for 500-1000 (NYC startups, Boston biotech, DC)

---

## 2026-05-14 — Claude Code Agent Framework + PR-Gated Deploys

### Context

Two related problems with how the project was being built:

1. **Every Claude Code session started from zero specialist context.** Whether the task was a scraper fix, a security audit, a code review, or a feature spec, the main agent had to re-derive project rules and patterns every time. The CLAUDE.md gives it operational reference, but it doesn't give it role-specific instructions ("when reviewing code, do X; when auditing auth, do Y").

2. **Direct push to `main` was risky.** A bad change would auto-deploy to production in ~60 seconds. The user wanted a gate — see the preview, click merge — without losing the autonomous workflow.

### What was decided

**Built a 13-agent Claude Code subagent portfolio at `.claude/agents/`:**

Custom (5, project-specific knowledge):
- `scraper-doctor` — diagnose one broken scraper; knows the 3-tier recovery, `CUSTOM_SCRAPER_HOSTS`, return-empty-vs-throw
- `catalog-scout` — research new companies, detect ATS, output JSONL for bulk-add pipeline
- `security-auth` — audit login/JWT/cookie surface; bakes in 2026-05-11 known-good baseline
- `security-data-isolation` — audit per-route subscription checks + RLS policies
- `security-infra` — audit npm/env/CORS/CSP/body limits; integrates with `security_snapshots` table

Borrowed + trimmed (8, generic roles rewritten from scratch):
- `change-reviewer` (forked from agency-agents/engineering-code-reviewer) — pre-push diff review with blocker/suggestion/nit format
- `code-refactorer` (forked from iannuttall/code-refactorer) — behavior-preserving cleanup
- `incident-triage` (forked from wshobson/devops-troubleshooter) — prod incident triage with Railway/Sentry/Supabase MCP playbook
- `debugger` (forked from wshobson/debugger) — single-bug fix with `tasks/lessons.md` + Gotchas check
- `db-optimizer` (forked from VoltAgent/postgres-pro) — Postgres-specific, knows existing indexes
- `performance-engineer` (forked from wshobson/performance-engineer) — N+1, parallelism, caching
- `threat-modeling-expert` (forked from wshobson/threat-modeling-expert) — STRIDE on new endpoints/tables; for Stripe Phase 1 prep
- `spec-writer` (forked from iannuttall/prd-writer) — feature idea → backlog.md table format

All borrowed agents were rewritten from scratch to remove external branding, author signatures, vendor name-drops (Trag, Bito, SonarQube, etc.), roleplay headers, and aspirational checklists for tools/processes not used.

Six more agents identified during research but **deferred** with explicit triggers: `wshobson/payment-processing` plugin (Phase 1 kickoff), `experiment-tracker` (first A/B test), `growth-hacker` (referral push), `brand-landingpage` (next landing iteration), `seo-cannibalization-detector` + `content-marketer` (blog/SEO launch), `customer-support` (help inbox > 50/week).

**Output discipline applied to every agent:** No git commits, pushes, or PR opens from any subagent. They return findings/patches as markdown in their response. The main agent handles git operations after user review.

**PR-gated deploy workflow.** Turned on:
- GitHub branch protection rule set on `main` (require PR, block force-push, block deletion)
- Railway PR environments (Base = Production, Bot PR Environments on, Focused PR Environments on)
- Vercel preview deploys (already on; verified Pull Request Comments enabled)

Tested end-to-end with PR #1 (landing headline change — closed without merging, proving the safety net) and PR #2 (commit the agent files themselves — merged successfully).

**Side-quest edits:**
- Added 2 rules to global `~/.claude/CLAUDE.md` Core Principles: "wait for fourth occurrence before abstracting" and "surface scope creep as follow-ups, don't smuggle"
- Added line to `docs/security-log.md` process notes: "a clean audit is suspicious — expect informational findings"
- Adjusted `.gitignore` to use `.claude/*` + `!.claude/agents/` so agents are tracked but `settings*.json` stay ignored

### Alternatives considered

- **Install public agent collections as plugins (e.g., `claude plugin marketplace add wshobson/agents`).** Considered; rejected. Plugin installs bring 50+ irrelevant agents per collection and a marketplace runtime overhead. Cherry-picking and rewriting was cleaner.
- **Use the existing built-in `/security-review` and `/review` slash commands instead of custom security agents.** Considered; rejected. Slash commands review the current diff against main — fine for incremental checks, but the 2026-05-11 audit pattern (3 parallel agents, line-by-line on a fixed scope) provably catches issues a single-pass scan misses.
- **Skip the PR-gated workflow; keep direct push to main with branch protection off.** Considered; rejected after the user explicitly said they wanted a gate. The marginal cost is one click per merge; the benefit is preview-before-prod and one-click undo.
- **Use staging Supabase project for Railway PR environments to isolate writes.** Considered; rejected for now. Production Supabase as base is fine for a solo project pre-monetization. Revisit when scaling team or going public.
- **Build a `journey-historian` agent for product-development-journey.md updates.** Considered; rejected. The `savecc` rule + the inline phase template in CLAUDE.md cover this without needing a dedicated agent.

### Key insights

- **Public agents are uniformly bloated for solo projects.** Even the best (`wshobson/debugger` at 27 lines, `iannuttall/code-refactorer`) needed targeted trimming. Mid-tier ones (`wshobson/code-reviewer`, `VoltAgent/security-auditor`) needed 50-70% cut. The structural patterns are real value; the surface bloat (vendor name-drops, enterprise tools, roleplay) actively dilutes the agent's instruction budget. Borrow the bones, throw out the marketing.

- **Specialized > generalized for review work.** The 2026-04-25 single-pass audit missed 11 issues the 2026-05-11 3-agent split caught. The same insight applies to the new portfolio: separate `security-auth`, `security-data-isolation`, and `security-infra` agents will outperform a single mega `security-audit` agent because each one has a finite checklist and reads its full scope.

- **Output contracts beat freeform prose for agent reviews.** Every agent declares the exact markdown structure it returns (blocker/suggestion/nit, STRIDE matrix, backlog table, etc.). Reviewing a structured output is a 30-second scan; reviewing prose is a slog. The model matters less than the contract on the way out.

- **PR-gated workflow doesn't actually slow you down.** The first test (PR #1) felt heavier than direct push, but the "close without merging" path saved a revert. The second test (PR #2, agent files) merged in seconds. Net friction per change is ~1 extra click; net safety is preview-before-prod for every change.

- **Agents are useless without trigger discipline.** Having 13 agents doesn't help if the user keeps invoking the main agent for everything by habit. The win comes from internalizing the routing ("the Coinbase scraper is broken" → `scraper-doctor`, not free-form chat). The portfolio is built; using it is the next discipline.

### Files / artifacts

- `.claude/agents/*.md` — 13 agent files + README.md (committed in PR #2, merged 6066811)
- `~/.claude/CLAUDE.md` — added 2 Core Principles rules
- `docs/security-log.md` — added process note about clean audits
- `.gitignore` — pattern updated for `.claude/agents/` tracking
- GitHub repo: branch protection rule set on `main`
- Railway: PR environments enabled with Production base
- Vercel: previews on (default), PR Comments enabled

### Next batch — open ideas

- **Pull deferred agents when triggers fire**: payment-integration before Stripe Phase 1, experiment-tracker before first A/B test, etc.
- **Re-evaluate public agent ecosystem every 6 months** — collections grow fast. Set a reminder.
- **Routine: invoke `change-reviewer` on every non-trivial PR before merging.** Build the habit.
- **Routine: quarterly security audit (3 parallel agents) appended to `docs/security-log.md`.** Calendar reminder.
- **Phase 1 Stripe kickoff**: invoke `threat-modeling-expert` on the planned data flows BEFORE writing code, plus `spec-writer` for the phased backlog.
- Public mid-caps in PM target work areas

---

## 2026-05-28: Remove the admin from the operational loop

### Context

Vik received 6 PostHog alert emails in a single morning ("Auth signin conversion below 50%") AND a daily admin digest showing 28 "unverified zeros" companies needing manual `is_verified_zero=true` triage. Both classes of noise were rooted in the same problem: monitoring + triage systems that asked Vik to confirm things the system could decide for itself.

### What shipped

**PR #87 — Auth funnel alert overhaul + /auth/callback instrumentation (DEV-26 / DEV-13 follow-up)**

- **Root cause of the 6 PostHog emails**: alert was `auth.signin_success / auth.signin_email_sent` over a 6h rolling window, checked hourly, fires below 50%. A user who requested a link at 9am and clicked at 4pm shows up in the success count at 4pm but with no matching email_sent inside the 4pm-window's lookback. Ratio swings between 0% and 200%+ based on individual event timing. Low traffic + 6h window = statistical noise dressed up as an alert.
- **Disabled** the noisy ratio alert. Renamed it "RETIRED" and widened its insight to 24h as a glance-chart only.
- **New insight `kds943CH`** "Daily signin success count (DEV-13)": total `auth.signin_success` events over 24h, BoldNumber display.
- **New alert** on it: "Zero auth signins in 24h", daily check, fires if value < 1. Catches catastrophic auth failure (template regression, cookie drop) without misfiring on traffic timing.
- **Funnel insight `9Lbo01cw`** retained as the diagnostic view — when the volume alert fires, the funnel tells you WHERE users dropped off. PostHog blocks alerts on Funnels queries directly, so the trends-volume approach is the practical replacement.
- **Code**: added `captureServerEvent` calls in `frontend/src/app/auth/callback/route.ts` mirroring `/auth/confirm`. PKCE/OAuth signins were previously invisible to PostHog; the funnel was undercounting real signin volume.

**PR #90 — Auto-verify zero PMs; retire manual "Unverified zeros" admin email**

- **Root cause of the 28-unverified-zeros email**: every 0-PM company appeared in a daily admin email until Vik manually marked `is_verified_zero=true`. With 28 companies at zero (some genuinely not hiring, some on stealth-tier blocked sites, some never-verified scrapers), the email would have continued daily forever.
- **Three rules in the daily cron**:
  - Healthy company (`is_verified=true`) at zero for 7 consecutive days → auto-set `is_verified_zero=true`. Trusted scraper + sustained zero = real zero.
  - Never-verified company at zero for 14 days → auto-set `auto_disabled=true`. Probably a misconfigured scraper. Saves cron cycles; Monday probe still gets a chance.
  - Any company returning >0 PMs → reset `consecutive_zero_days=0` AND flip `is_verified_zero=false` if it was true. Auto-flip-back is the safety net: there is no permanently silenced state.
- **Migration** added `consecutive_zero_days` column. Bootstrap UPDATE silenced all 28 currently-zero companies immediately (originally scoped to `is_verified=TRUE` only, then expanded to catch-all when all 28 turned out to be `is_verified=FALSE` — mostly stealth-tier blocked sites and scrapers that have never returned a PM).
- **Email plumbing**: dropped the "Unverified zeros" section, its rollup chip, its subject contribution, and the `platform_zero_cluster` cross-cutting pattern detection.
- **Result**: daily admin email is silent on most days. Only fires on real-time scrape errors, watch list, subscribed-companies-dropping-to-zero, or email send failures.

### Alternatives considered

- **Just snooze the PostHog alert.** Considered; rejected. Snoozing addresses the symptom (today's email volume) without addressing the cause (ratio math is unstable). It'd fire again the next time traffic dipped.
- **Use PostHog anomaly detection (zscore/MAD) on the ratio.** Considered; rejected. Anomaly detection adapts to baseline noise, which means it adapts to ZERO traffic as baseline. Wouldn't catch a real outage on a slow day.
- **Build a funnel-trends alert directly on the existing funnel insight `9Lbo01cw`.** Tried; PostHog rejects alerts on Funnels queries even when `funnelVizType: "trends"`. Volume alert on a separate trends insight is the workaround.
- **Build a queryable admin UI page so Vik can triage zeros faster instead of removing the email.** Considered; rejected. Vik explicitly said "I want a solution where I am never involved and will never ever look at any company and confirm anything." Faster UI is still involvement. Auto-marking removes him entirely.
- **For unverified zeros, only auto-mark companies with at least N days of `last_check_status='success'`.** Considered; rejected as added complexity for no gain. `is_verified=true` already encodes "this scraper has worked at least once," which is the meaningful trust signal. Layering on a recency requirement narrows the rule without clear benefit.
- **Mark only `is_verified=TRUE` companies as auto-zero, never touch the never-verified ones.** Conservative version of the bootstrap. Tried first. Result: 0 of the 28 noise items got silenced. All 28 were `is_verified=FALSE`. Switched bootstrap to catch-all. Trusts the auto-flip-back to restore accuracy if any of them start hiring.

### Key insights

- **The flag's blast radius determines whether bold defaults are safe.** `is_verified_zero` reads only from admin-email plumbing and cron logic — no user-facing surface touches it. Worst-case bug in the auto-flip-back code is "admin email stays quieter than it should." Never "users miss jobs." That bounded downside made it safe to aggressive-bootstrap all 28 unverified zeros, including never-verified ones. If the flag had been read by user-facing code, the conservative version would have been the right call.

- **Stop asking the human to confirm what the system already knows.** The "Unverified zeros" pattern existed because at the time, the system genuinely couldn't distinguish "no PMs" from "scraper broken." The `is_verified` column (added later) gave it that signal — but the email kept asking anyway. When the data evolves, the workflow has to evolve with it. Otherwise you're paying a manual cost for a problem that's already been automated away in a different layer.

- **Cross-window ratio alerts misfire on low traffic; volume alerts don't.** The 6h ratio alert is the technically-correct measurement of "signin conversion" — but a numerator and denominator that drift in and out of the window independently are a recipe for nonsense at low scale. The trends-volume alert (`signin_success < 1 in 24h`) is a coarser measurement, but it can't lie on a low-traffic day. For a site below ~100 signins/day, volume floor > conversion ratio.

- **Per-session feedback shapes the next session, not this one.** Vik called out three communication patterns mid-session: split-message preambles + post-summaries (annoying to scroll), em-dashes in user-facing copy (still leaking through, watch for it), one-clear-answer (vs the 3-option-table reflex). Saved as feedback memories so future sessions don't repeat them. The cost of saving is one file write; the cost of not saving is paying the same correction tax every session.

### Files / artifacts

- `frontend/src/app/auth/callback/route.ts` — added `captureServerEvent` calls for PKCE flow (PR #87)
- `backend/src/jobs/dailyCheck.ts` — auto-verify/auto-disable/auto-flip-back logic (PR #90)
- `backend/src/email/sendAlert.ts` — removed "Unverified zeros" email section (PR #90)
- `backend/migrations/2026-05-28-auto-verify-zeros.sql` — column add + bootstrap UPDATE
- `backend/src/scraper/SCRAPER.md` — updated silent-zero gotcha to reflect automation
- `backend/src/jobs/JOBS.md` — new "Silent-Zero Self-Management" section
- `CLAUDE.md` — `companies` table schema row notes the new column + auto-managed semantics
- PostHog: insight `kds943CH` + alert `019e703c-bd12-...` (zero signins in 24h), funnel `9Lbo01cw` retained
- Linear DEV-26 (closed) — full write-up of the auth alert overhaul

### Next batch — open ideas

- **Spot-check `scraper_events` after 7 days of the new rules** for any `auto_verified_zero` or `auto_unverified_zero` rows to validate the cron is doing what it's supposed to.
- **Consider tightening "Zero auth signins in 24h" alert** once daily signin baseline is known (need ~7 days clean data). Move from `< 1` to `< 50% of trailing 7d mean` for partial-regression detection.
- **Add a second DEV-11 audit rule** for the cookie-drop attribute-strip footgun (capture from earlier session memory, not yet implemented).

---

## 2026-05-14 (evening) — Zero-Jobs Audit Executed: 4 PRs, 3 New ATS Platforms, Catalog 220→216

### Context

The 2026-05-13 diagnostic found ~90 of 220 catalog companies showing 0 PMs. Investigation revealed a mix of legitimate-zero (Block, Palantir, xAI, Wiz, etc.) and silently-broken (Confluent's Ashby team filter dropping 5 PMs, AmEx's invisible Eightfold → Oracle HCM migration, Apple/Meta/Tesla/TikTok/Wayfair SPA-blocked, EA pagination, ~12 wrong-ATS-in-DB cases). The 8-step fix plan was locked in memory but not executed — the agent framework was being validated first.

Tonight the plan executed end-to-end in one session, with one wrinkle the user injected mid-flight: prior-art research from a parallel session that flipped the plan for Meta (drop the build), TikTok (drop the build), corrected EA (simpler than expected), and reframed Apple (use known endpoints). After verifying the prior art against live curl tests, the conclusion was: prior-art is great for orientation but always re-verify before committing to the path. Apple's prior-art endpoints were actually stale; the agent's reverse-engineered ones worked.

### What was decided

**Four phased PRs, each independently reviewable and revertible.**

- **PR #5 — Phase 1: safety net + Ashby fix.** Schema migration adds `is_verified` + `is_verified_zero` BOOLEAN columns on `companies` with partial index `idx_companies_unverified_zero`. Daily admin digest gains "Unverified zeros" section (capped at top 25 by subscriber count, "…and N more" footer). Ashby scraper at `scraper.ts:1062-1082` switched from team-name pre-filter to title-keyword filter mirroring the Greenhouse pattern at `:548`. `is_verified=true` flips one-way on any successful scrape returning >0 PMs (preserves admin verification). 21 manually-triaged legit-zeros backfilled (Block, Palantir, Wiz, xAI, Figure AI, HoYoverse, Khan Academy, Aptos Labs, Bungie, Calm, Imbue, Lattice, MasterClass, PlanetScale, FullStory, insitro, Modern Treasury, Pika, Statsig, Substack, Windsurf).

- **PR #6 — Phase 2: Apple + EA + Meta/TikTok yield.** New `scrapeAppleCareers` (~130 lines). Two-step CSRF flow against `/api/v1/CSRFToken` + `/api/v1/search`. Reverse-engineered live: cookies (`jobs=`, `jssid=`, AWSALB stickiness) captured via denylist; payload requires mandatory `format` field (without it the API silently returns 0 records). Paginates up to 8 pages, early-exit on PM-hits collapse, accepts `stats` param. EA scraper fix is a one-line regex swap: `list-item-jobPostingLocation` selector was matching only 9/20 articles per page; switched to `<span class="list-item-location">` which is present on every article (recovers ~10 jobs per page from empty-location silent drops). Meta and TikTok get hostname guards returning `[]` so the stealth tier handles them — no Puppeteer launch wasted on a known-impossible scrape.

- **PR #7 — Phase 3: PM_KEYWORDS expansion + Tesla/Wayfair yield.** Added `"product management"` to `PM_KEYWORDS`. Today's admin email showed AmEx at 1 PM after the Oracle HCM swap landed, despite the API returning 234 keyword matches. Root cause: AmEx (and JPMorgan, Oracle) put the function name in titles ("Senior Manager - Product Management", "Senior Associate-Digital Product Management") not the role name. Tesla (Akamai 403 + Workday 422 on every subdomain/board combination) and Wayfair (Workday HTTP 401 auth-gated tenant) got the Meta/TikTok yield-to-stealth treatment.

- **PR #8 — Phase 4: Shopify + eBay.** New `scrapeShopifyCareers` parses Shopify's Remix SPA. Standard Ashby hosted API returns null for `shopify`. Shopify server-renders 84 jobs into a React Flight streaming payload via `window.__reactRouterContext.streamController.enqueue(...)`. The payload is a deduplicated JSON array where field names appear once as string literals and job objects reference them by index. Parser resolves key indices dynamically (so CDN redeploys don't break it). `matchAll` on enqueue() chunks handles future stream-chunking. New generic `scrapePhenomCareers(baseDomain, label, stats?)` + `scrapeEbayCareers` wrapper parses Phenom's inline DDO between `phApp.ddo = ` and `; phApp.experimentData =`. Acknowledged limitation: Phenom only server-renders 10 jobs per page; full pagination is client-side Vue. For eBay's totalHits=455 we capture 3-4 US PMs first-page. `stats.totalScanned = totalHits` prevents the self-healing tier from misclassifying as broken.

**Catalog cleanup: hard-deleted 4 unrecoverables (0 subs, FK CASCADE):** Color Health (CareerPuck unsupported, healthcare-only postings), Allbirds (hiring contraction, ~3 company-wide openings), Solana Labs (Getro ATS unsupported), Splunk (now Cisco subsidiary, Phenom ATS, hard-delete chosen over Phenom port since 0 subs). Shopify suppressed pre-PR-8, then re-enabled when PR #8 landed.

**DB swaps applied via Supabase MCP (live, no migrations):** AmEx eightfold→oracle_hcm (`egug.fa.us2/CX_1`), HubSpot greenhouse `hubspot`→`hubspotjobs`, DocuSign iCIMS `careers-docusign`→`uscareers-docusign`, Apple generic→apple, Tesla/Wayfair/Meta/TikTok generic→NULL with hostname guards, Sony Interactive Entertainment generic→greenhouse `sonyinteractiveentertainmentglobal` (2 US PMs confirmed), Pandora generic→iCIMS `careers-siriusxmradio.icims.com` (SiriusXM parent), Zendesk smartrecruiters→workday `zendesk.wd1/zendesk` (163 PM search results), 2K Games greenhouse `2kearlycareers`→`2k`, Kraken ashby `kraken`→`kraken.com` (7 PM-titled jobs), Magic ashby `magic`→`magic.dev` (correct config though 0 PMs today), Amgen workday boardPath `en-US`→`Careers`, BeiGene workday boardPath `en-US`→`BeiGene`, Bolt/Rippling cleared to NULL for re-discovery, Shopify→shopify, eBay NULL→phenom (`https://jobs.ebayinc.com`).

**Verified next-day:** Apple landed 35 PMs (quality 93/100, in predicted range 30-60), Skydio 5, Confluent 4, Decagon 4, Whatnot 3, Zendesk 2, Kraken 2, Character.AI 2, 2K Games 1, BeiGene 1, Lemonade 1, Pinecone 1, Supabase 1.

### Alternatives considered

- **Single big PR vs phased PRs.** Considered combining all four phases into one PR. Rejected because (a) each phase has independent verification paths (different scraper APIs to curl-test), (b) the silent-zero safety net is foundational and worth landing first standalone so the rest builds on a known-clean base, (c) smaller PRs let `change-reviewer` give focused feedback per scope, (d) one revert button per phase is safer than one mega-revert.

- **Build all scrapers serially in one session vs parallel agents.** Considered sequential build. Rejected: scraper-doctor + catalog-scout were designed for this. Parallel agents for Apple, EA, Meta, TikTok, ATS rediscovery (phase 2) and Shopify + eBay (phase 4) cut multi-hour work to minutes. The user's prior-art interjection mid-flight cancelled two of the phase-2 agents' work (Meta + TikTok dropped entirely), validating that agent output is "propose," not "ship." Net agent ROI: ~70% of agent output integrated, the rest correctly discarded.

- **Trust agent's Apple reverse-engineering over user's prior art.** User mid-flight pointed at anon767/maangcrawler (the prior-art reference). Agent had already reverse-engineered `/api/v1/CSRFToken` + `/api/v1/search`. Live curl tested both: prior-art endpoints (`/api/csrfToken` + `/api/role/search`) returned 404 / 301-to-pagenotfound; agent's endpoints returned valid JSON with real results once the mandatory `format` field was added. Resolution: trust verified curl over cited prior-art when they conflict.

- **Build the Shopify Ashby-embed scraper vs accept it as un-scrapable.** Considered marking Shopify permanently `is_verified_zero=true`. Rejected: Shopify is a major hiring company with 1 active subscriber. The agent found a clean parse path (React Flight RSC streaming) and verified live (84 jobs in payload). Worth the ~half-session cost.

- **Build full Phenom Vue pagination for eBay vs accept the 10-job first-page cap.** Considered building a stealth-rendered Vue crawl for eBay (would capture all 150 US PMs instead of 3-4). Rejected for now: stealth-rendered Vue is brittle, slow, and the 10-job sample is enough to unblock auto-disable and surface real openings. Documented in code as a deliberate trade-off. If eBay subscribers complain, the path forward is clear: extend `scrapePhenomCareers` to optionally do a stealth follow-up for the remaining pages.

- **Hard-delete Splunk vs keep suppressed for future Phenom port.** Considered keeping Splunk in catalog with `is_verified_zero=true` + `auto_disabled=true` so it'd light up when we built Phenom support. Rejected: Splunk has 0 subscribers and Phenom got built tonight (for eBay) but Splunk redirects to a Cisco-tenant Phenom that we'd need a separate DB row for. Hard-delete is reversible by re-adding; suppression-forever adds visual noise. Same logic for Solana Labs (Getro is still unsupported).

- **Cisco/Splunk auto-unblock via the new generic `scrapePhenomCareers`.** Considered adding Cisco to the catalog as the first non-eBay Phenom user. Rejected: out of scope for this PR; Cisco wasn't in the audit list. Cisco is a 2-line DB add when there's actual user demand. Phenom scraper is generic-by-design for exactly this scenario.

### Key insights

- **The unverified-zeros section is what closes the silent-zero failure class.** A 0-PM scrape with `success` status is structurally indistinguishable from a broken scraper from `dailyCheck`'s perspective. The fix isn't "make the scraper smarter" — it's "force every 0-PM company through human verification once." `is_verified_zero=true` is admin's signature; `is_verified=true` is the system's signature when a scrape returns >0. Both are one-way ratchets relative to the scraper. The daily email noise during backlog triage is the intended UX, not a bug — silence is what got us into this mess.

- **Prior art is for orientation, not blind trust.** Apple's anon767/maangcrawler reference at `/api/csrfToken` is stale (the API was moved to `/api/v1/CSRFToken`). The agent's reverse-engineering caught the current state. The right discipline is: cite prior art as a starting hypothesis, always verify with live curl before committing. Saved real time on eBay (strata-harvest's Phenom parser was usable as a template), lost a few minutes on Apple when the prior-art endpoints proved stale — net positive.

- **Agents propose, main thread verifies, change-reviewer audits before merge.** This pattern caught 6 real ship-blockers tonight (Apple cookie allowlist too narrow → switched to denylist; Apple missing stats param → stealth would mis-trigger on legit-zero days; Meta hostname endsWith too loose → tightened; Shopify deref had negative-ref edge case → fixed; Shopify single-chunk regex risked silent under-count → matchAll; Phenom throw inconsistent with DDO-not-found branch → return [] for symmetric handling). 0 production regressions shipped. The cost is one extra agent invocation per PR; the benefit is high.

- **`stats.totalScanned` is the linchpin of the 3-tier self-healing model.** Without it, a legit-zero day on Apple, Phenom, or any new scraper triggers stealth fallback unnecessarily (wasting a Puppeteer launch). Both Apple and Phenom write the API's reported total to `stats.totalScanned` so `dailyCheck` can distinguish "source said 0" (legit, don't retry) from "source threw or never responded" (broken, run tier 2/3). This was added to the model on 2026-05-11 as an "obvious in retrospect" infrastructure improvement; every new scraper since has paid it back.

- **Hard-delete is reversible; permanent suppression is invisible.** For unrecoverables (Color Health on CareerPuck, Allbirds in hiring contraction, Solana on Getro, Splunk-via-Cisco on Phenom), hard-delete is cleaner than `is_verified_zero=true` + `auto_disabled=true`. The catalog visibly shrinks; if circumstances change, re-add via `/api/companies` admin endpoint. Suppression-forever just creates a slowly-growing pile of "things we gave up on" that nobody revisits.

- **Catalog hygiene happens during recovery, not during steady-state.** This session deleted 4 companies because the audit forced a per-company decision: "fix or remove?" A company that's been at 0 PMs for months without subscribers had been invisible in the old admin email. The unverified-zeros section makes that decision unavoidable — which is the point. Expect the catalog to oscillate as scrapers break and companies get re-evaluated.

### Files / artifacts

- `backend/src/scraper/scraper.ts` — 3 new functions (Apple, Shopify, Phenom), 1 generic + 1 wrapper for Phenom, 4 new hostname guards (Apple, Meta, TikTok, Tesla, Wayfair, Shopify, eBay), 2 new switch cases (apple, shopify, phenom), Ashby title-filter swap, EA regex swap, PM_KEYWORDS += "product management"
- `backend/src/jobs/dailyCheck.ts` — 7 new CUSTOM_SCRAPER_HOSTS entries (apple.com, metacareers.com, tiktok.com, tesla.com, wayfair.com, shopify.com, ebayinc.com); unverified-zeros query + handoff to admin digest; is_verified one-way ratchet on success
- `backend/src/email/sendAlert.ts` — `AdminDigestInput.unverifiedZeros` field + render block, capped at 25 with overflow footer
- Supabase migration `add_company_verification_columns` — is_verified + is_verified_zero columns + partial index idx_companies_unverified_zero
- 4 merged PRs: #5 (phase 1), #6 (phase 2), #7 (phase 3), #8 (phase 4) — all squash-merged with branches deleted
- Catalog: 220 → 216 companies (deleted Color Health, Allbirds, Solana Labs, Splunk)

### Next batch — open ideas

- **Eval set for step 8 (ground-truth check):** ~25 manually-counted companies as calibration set, then build the weekly Claude Code scheduled remote agent that visits each company's careers URL (JS-rendered) and diffs titles against our scraper's output at 90% threshold. The structural fix for "we are auditing ourselves" — independent second source.
- **Stealth-rendered Vue follow-up for Phenom** if eBay subscribers grow and 3-4 first-page PMs isn't enough. Generic enough to apply to any Phenom tenant.
- **CareerPuck scraper** if Color Health's category becomes important (low priority — only one company hit it).
- **Getro scraper** if Solana Labs comes back into scope, or if other crypto/web3 catalog adds use Getro.
- **Cisco as the second Phenom test.** Adds the generic scraper's first non-eBay user. ~2-line DB add when user wants it.
- **The unverified-zeros backlog triage.** ~49 companies remain in the section after tonight's work. Each needs admin sign-off (is_verified_zero=true) or scraper investigation. Recurring weekly task until backlog drains.

---

## 2026-05-15 → 2026-05-18 — Targeted Catalog Growth + 5 New ATS Scrapers (Catalog 216 → 244)

### Context

After the zero-jobs audit closed, two distinct catalog-growth paths emerged. The hypothesis: scale to 500-1000 companies by leveraging Common Crawl + targeted vertical batches. This entry covers what got built, what worked, what was rejected, and the strategic insight that came out of it.

### What was decided

**1. Common Crawl harvest pipeline (PR planning + tooling — 2026-05-17).**

Built `backend/src/scripts/common-crawl-harvest.js` to query CC's CDX index for known ATS hostname patterns (`boards.greenhouse.io/*`, `jobs.lever.co/*`, `jobs.ashbyhq.com/*`, `jobs.smartrecruiters.com/*`), extract candidate slugs, validate each against the ATS's own public API, and emit JSONL → SQL via the existing bulk-add toolchain. Plus a companion `harvest-to-sql.js` that converts the candidates into a paste-ready INSERT batch.

Tested end-to-end: 1352 validated companies discovered (446 Greenhouse, 305 Lever, 516 SmartRecruiters, 85 Ashby). After name-dedup against existing catalog: 1328 truly new candidates. Top results dominated by either niche tech the user hadn't heard of (Adyen, Anaplan, Astera Labs, Aurora Innovation, Applied Intuition, Celonis) or non-tech noise (BAYADA Home Health, ALO Yoga, Centria Autism, Ennoble Care, Daniels Sharpsmart).

User reaction: *"I've never even heard of most of these companies. I look mostly in banking, biotech, consulting, those kinds of companies, tech."*

**Deprioritized in favor of targeted curation per vertical.** Pipeline kept (script + JSONL + harvest-to-sql.js stay on disk) for future use if breadth becomes valuable. Decision documented in `docs/backlog.md` under "Catalog Growth Strategy — Targeted Curation."

**2. Targeted curation batches (2026-05-18, 4 phases):**

**Batch A (16 detected, all applied):** Bank of America (Workday), Citi (Eightfold), Charles Schwab (iCIMS), Mastercard (Workday), Wise (SmartRecruiters), Adyen (Greenhouse), Moderna (Workday), Johnson & Johnson (Workday), Vertex Pharmaceuticals (Workday), Biogen (Workday), Eli Lilly (Workday), Bristol-Myers Squibb (Workday), AbbVie (SmartRecruiters), Merck (Workday), Novartis (Workday), AstraZeneca (Eightfold).

**Batch B (8 detected via 3 parallel scraper-doctor agents, all applied):** Morgan Stanley (Eightfold), Wells Fargo (Workday, with curl-verified URL pattern fix), Fidelity Investments (Workday), BlackRock (Workday), Pfizer (Workday), Regeneron (Workday), PwC (Workday), Accenture (Workday).

**Batch C (5 via custom scrapers, PR #13):** Goldman Sachs (custom Higher GraphQL), EY (SuccessFactors generic), KPMG (bespoke WordPress), Klarna (Deel generic), Revolut (Next.js SSG — code shipped, DB add held pending buildId-refresh). Plus BCG via existing Phenom scraper (DB-only add).

**Batch D (verification + 1 quick win via SuccessFactors generic):** Ametek via the SuccessFactors scraper we just shipped.

**Total: 29 high-recognition catalog additions over 4 days.**

**3. Five new ATS scraper types shipped in PR #13 (merged 2026-05-18):**

- `scrapeSuccessFactorsCareers(baseUrl, label, stats?)` — generic SAP SF HTML scraper. Paginates `/search?q=product+manager&startrow=N` (25 per page). Reusable. Active for EY, Ametek.
- `scrapeGoldmanSachsCareers(stats?)` — Goldman's proprietary "Higher" platform. Unauthenticated GraphQL at `api-higher.gs.com/gateway/api/v1/graphql`. Pagination via `GetRoles`. CF lets server-side POSTs through. **~35 US PMs verified live.**
- `scrapeKPMGCareers(stats?)` — KPMG-specific WordPress + PHP search endpoint. NOT SuccessFactors despite SSO references.
- `scrapeDeelCareers(orgSlug, label, stats?)` — generic for any Deel customer's job board. Uses `RSC: 1` header to fetch React Server Components stream from `jobs.deel.com/{slug}`. Regex-parses JSON job objects.
- `scrapeRevolutCareers(buildId, stats?)` — Revolut's self-hosted Next.js. Cloudflare blocks the HTML at `/careers` but `/_next/data/{buildId}/careers.json` bypasses CF. ~681 positions.

**4. Revolut buildId auto-refresh (PR #14, merged 2026-05-18):** Wired `inferPlatformFromSniffedUrl` to recognize `www.revolut.com/_next/data/{buildId}/careers.json` and extract the buildId. Plus added `"text"` to `extractJobsFromUnknownJson` titleKey list (Revolut positions use `text` not `title`). When Revolut's buildId rotates per deploy, the configured scraper 404s → stealth tier intercepts the new URL → buildId auto-updates in `platform_config`. Risk: the "text" titleKey expansion has cross-company false-positive potential; monitor Monday digest.

**5. Honest scraper verification became a habit.** After PR #13 shipped, ran `catalog-scout` agent to simulate each of the 5 new scrapers against live data with our actual PM_KEYWORDS + HARD_EXCLUSIONS + US filter, reporting real-after-filter yield:

| Scraper | Live API total | After PM_KEYWORDS | After US filter | Verdict |
|---|---|---|---|---|
| Goldman Sachs | 819 | 38/700 sampled | **~35** | High yield, kept |
| EY (SuccessFactors) | ~75 | 7 | **2** | Marginal, kept |
| BCG (Phenom) | 868 | 1/100 sampled | **~8 extrap.** | Marginal, kept |
| KPMG (WordPress) | 59 | 0 | **0** | **Structurally 0** — marked `is_verified_zero=true` |
| Klarna (Deel) | 106 | 3 | **0** | **Structurally 0** — marked `is_verified_zero=true` |

KPMG's 59 results are all engineering leads, SAP product costing managers, and consulting product owners — none pass our filter. Klarna's 106-job Deel board is concentrated Stockholm/Milan/London; their 3 PM-keyword matches are all Europe-based. **Suppressing both from the daily email without auto-disabling working scrapers.**

**6. Companies confirmed permanently unscrapeable:**

| Company | ATS | Why |
|---|---|---|
| McKinsey | Avature | Login-gated SPA, robots.txt disallows, no public JSON API |
| Bain | Avature | Same — confirmed via `<meta name="avature.portal.id">` tag |
| Deloitte | Avature (NOT Oracle Taleo as initially assumed) | Same — keyword search isn't a title filter, so even if we built Avature support, ~3 minutes per scrape for ~5 PMs makes it impractical |
| Goldman (originally) | Custom (escaped — found GraphQL) | Now scraped via PR #13 |
| Klarna's Deel board | Working scraper, no US PMs | Suppressed |
| KPMG | Working scraper, no PM-titled roles | Suppressed |

**7. Other catalog ops:**
- **Rivian fix**: `platform_type='custom_api'` with empty config → fixed to `icims` with `baseUrl=https://careers.rivian.com` (curl-verified, returned real PMs immediately).
- **Bolt revert**: Common Crawl had suggested `bolt42` Greenhouse slug; that board returned 404 (board moved/removed). Reverted to NULL + `is_verified_zero=true`. Bolt has no public scrapable board today.
- **EA scraper rewrite (PR #10)**: per-`<article>` parsing + paginate-until-empty (replaced broken "of N results" total-count regex) + multi-location handling + `stats` out-param. Also: dailyCheck now refreshes title/location on existing-active jobs (catches in-place renames) AND re-activates archived URLs that reappear (was silently dropping them).
- **Location filter fix (PR #11)**: `isUSLocation` now short-circuits on `"United States"` / `"USA"` substring before NON_US_PATTERNS gets a chance (was rejecting "United States or Canada, 100% remote" because `Canada` matched first). Added `/\bNorth America\b/i` to US_PATTERNS. Unblocks Sumo Logic + Linear-style remote-NA jobs.
- **Add-any-URL flow (PR #12)**: `/api/companies/check` now returns `detection_method` (ats_known / ats_discovery / url_discovery / none) + `confidence` (high / medium / experimental). Plumbing for the future trust-system UI.

### Alternatives considered

**Common Crawl ⊥ targeted curation.** Considered applying all 1328 cleaned candidates → catalog would jump 214 → 1542. Rejected: the audience wants recognizable companies in their vertical, not raw count. Decision validated by the user explicitly saying *"I've never even heard of most of these companies."*

**Apply only top-50 by job count.** Same reasoning — top 50 was still mostly niche/non-tech. 24 of 50 were noise.

**Apply only 18 clearly-tech entries from top 50.** Considered. Rejected by user: even "tech" entries like Astera Labs, Anaplan, Adyen are niche to their banking/biotech/consulting target. *"I'd lean toward dropping the 18 and doing targeted batches in your verticals."*

**Build SAP SuccessFactors as priority new ATS.** Worth it — unlocks EY + Ametek + any future F500. Done in PR #13.

**Build Oracle Taleo for Deloitte.** Started; agent investigation revealed Deloitte is NOT on Taleo — it's on Avature. The "Taleo" assumption from earlier triage was wrong. No Taleo scraper built. Saved a half-day.

**Build Avature scraper for McKinsey/Bain/Deloitte.** Agent investigations confirmed Avature is intentionally bot-resistant + login-gated + the search keyword isn't a title filter. Even Puppeteer would need an auth session. Skipped indefinitely.

**Generalize Intuit TalentBrew scraper for Disney.** Investigated; Disney's TalentBrew uses a different URL pattern (server-rendered HTML with `/en/job/...` URLs, not the Intuit `/search-jobs/results?` JSON-in-HTML pattern). Would need a new index→detail crawler. Deferred — ~1 hour build for one company.

**Add `text` to titleKey list in `extractJobsFromUnknownJson`.** Required for Revolut's buildId auto-refresh path. Has cross-company false-positive risk. Accepted because mitigated by: stealth tier only runs on already-failed scrapers (small audience), Monday self-heal log surfaces every `stealth_recovery` for review.

**Run change-reviewer on PR #13.** Skipped — the 5 scrapers were each self-verified by their building agent via curl, and the integration was straightforward. Saved a session round-trip. (PR #14 had no change-reviewer either; one-line patches.)

### Key insights

- **Catalog quality > catalog quantity for our audience.** Raw breadth via Common Crawl finds long-tail SaaS the user has never heard of. PMs job-hunting in banking/biotech/consulting/big-tech want recognizable names in their vertical. The lesson generalizes: scaling along the wrong dimension is worse than not scaling.
- **Honest verification of scraper yield matters more than "endpoint works."** Built 5 scrapers, all returned 200, all parsed correctly. Verification revealed 2 of 5 (KPMG, Klarna) deliver zero user value despite working perfectly. Without the simulation pass, we'd have shipped silent zeros + added noise to the unverified-zeros email forever.
- **Industry-wide ATS patterns are real.** Avature dominates consulting (4 of 8 firms). SuccessFactors dominates Fortune-500 HR (we picked up 2 with one scraper). Workday is the safe default for biotech (all 12 pharma giants confirmed). Pattern-matching at the industry level saved enormous time vs. per-company investigation.
- **The 4-tier scraper architecture (configured → broadATSDiscovery → stealth → infer-and-auto-refresh) handles a remarkable range.** Revolut's CF challenge → stealth bypass → buildId auto-update is the most sophisticated single chain we've built. Each tier extends the others.
- **Parallel agents are the right tool when the work is independent.** Spawned 3 agents (banking/biotech/consulting) for Batch B research, 4 agents (SuccessFactors/Goldman/Klarna/Revolut) for the custom-scraper round, 5 agents (verification/Revolut-buildId/Taleo/McKinsey/Bain) for the verification round. Total: 12 parallel agent runs across the work. Net: roughly 12-15 hours of human-equivalent work compressed into ~3-4 conversation hours.
- **"Agents propose, main thread disposes" held across every PR.** No agent committed code directly. Every patch was integrated + verified + reviewed by the main thread before push. 0 production regressions across PRs #10-14.

### Files / artifacts

- **5 merged PRs**: #10 EA rewrite + dailyCheck refresh, #11 location filter, #12 add-any-URL, #13 5 new scrapers, #14 Revolut buildId auto-refresh
- **Common Crawl tooling**: `backend/src/scripts/common-crawl-harvest.js`, `harvest-to-sql.js`, `candidates_clean.jsonl` (1328 candidates), `existing-careers-urls.txt`
- **Targeted-curation tooling**: `bulk-add-targeted-20260518.js`, `targeted-20260518.jsonl`
- **Backlog updated**: `docs/backlog.md` "Catalog Growth Strategy — Targeted Curation" section + "Next-Phase Plan — Build Order (TLDR)"
- **Catalog**: 216 → 244 companies. KPMG + Klarna marked `is_verified_zero=true`. Bolt reverted to NULL + verified-zero. Rivian config fixed.

### Next batch — open ideas

- **DocuSign + Joby Aviation iCIMS deep-dive** — both return HTML SPA at `/api/jobs` (different iCIMS template than Rivian/Costco). Find their actual JSON endpoint or use Puppeteer iCIMS scraper. ~half-day.
- **Disney TalentBrew custom scraper** — index page has 645KB HTML with `/en/job/...` URLs; each detail page emits JSON-LD JobPosting. Build index→detail crawler. ~1 hour for one company.
- **Shopify prod debugging** — scraper works locally (84 jobs parsed correctly), prod cron returns 0. Likely Cloudflare blocking Railway IP. Needs prod log access.
- **Trust foundation UI** — frontend changes to show `confidence` badges (high/medium/experimental) on company cards, surface `detection_method` to admin, build user-report button feeding the future triage agent inbox.
- **Phase 1 Stripe billing** — 3-tier auth (anonymous browse / free login save / paid add-any-URL). Per existing monetization plan.
- **eBay Phenom Vue stealth crawl** — if eBay subscribers grow, build a stealth-rendered Vue crawl that goes beyond the 10-job server-render cap. Defer indefinitely until demand justifies.

---

## 2026-05-19 → 2026-05-20 — /new-home Job-First Feed + Email Quality Overhaul + Critical Pagination Bug (16 PRs in 2 days)

### Context

Two themes drove this sprint. First, the catalog hit 244 companies after the targeted-curation work — enough density that the dashboard's "list of cards" UX was starting to feel like the wrong shape for someone job-hunting. The second was a slow-accumulating set of email-quality complaints: jobs flagged "new" that weren't, recommendation block repeating the same companies, daily email getting noisier as the catalog grew.

The plan: build a parallel `/new-home` route as a data-first job feed (inspired by jobs.christran.gg's table layout), iterate on filters, and in parallel fix the email-quality issues. A bonus thread emerged late in the sprint: levels.fyi comp data was sitting in `comp_cache` mostly unused, so we plumbed it through both the feed (per-job comp tier + Min Comp filter) and the future email recommendation logic.

Then a critical bug hit on the very last day: admin (user himself) stopped receiving the daily email. No Resend record at all. Root cause turned out to be a 1-line Supabase SDK default that had been silently true since the user count crossed 50 the day before.

### What was decided

**1. `/new-home` as parallel route, not a swap (PRs #24 → #28).** Built `frontend/src/app/new-home/page.tsx` rendering a new `JobFeed.tsx` component (~700 lines). Table layout: Company / Title / Location / Level / Comp / Posted / Track. Track button is auth-aware — anonymous visitors get redirected to `/login?next=/new-home`. The old `/` page (marketing landing for anon, dashboard for auth) stayed intact. When user greenlights the swap, `/new-home` becomes `/` and the marketing landing moves to its own route.

Iterated through three rounds:
- **Round 1 (PR #24)**: basic feed. User feedback: "needs filters, sort, logo column."
- **Round 2 (PR #28)**: table layout + tiered logos (logo.dev → DuckDuckGo → Google → colored chip) + sort + company filter dropdown.
- **Round 3 (PRs #29 → #32, four PRs of filter bug-fixes)**: region server-side, sort A→Z working, Remote option added. Each PR exposed a new edge case in PostgREST behavior — see "Alternatives considered."

**2. `/api/feed` as public read endpoint (PR #24).** New router at `backend/src/routes/feed.ts`, mounted at `/api/feed` WITHOUT requireAuth (public read of shared catalog). Two endpoints: `GET /api/feed` (filtered jobs, enriched with comp tier from `comp_cache`) and `GET /api/feed/companies` (lightweight dropdown data). Server-side filter params: industry, level, region, city, company, min_comp, sort, include_closed. Track button still goes through auth-protected `/api/subscriptions` — public read, private write.

**3. Industry column + email recommendation block (PRs #22 + #23).** Added `companies.industry` text column. Backfilled all 243 companies via migration. Enum-shaped: ai, dev_tools, fintech, biotech, banking, consulting, gaming, edtech, streaming, crypto. Drives both the `/new-home` industry filter and the email "Companies you may find interesting" section (3 companies from user's subscribed industries, with logo + comp + 1-click subscribe).

**4. Per-company seniority threshold (PR #33).** Added `companies.min_relevant_seniority` (text, default 'mid'). FAANG titles are inflated industry-wide — "Google PM" is mid-level by Bay Area standards. Manually set Google/Meta/Apple/Amazon/Netflix/Microsoft to 'mid' so junior PM titles at FAANG don't email the user. New helper `passesSeniorityThreshold(jobTitle, threshold)` in `dailyCheck.ts`. Future path is comp-validated (use levels.fyi early-tier TC to set automatically) — backlogged as #28.

**5. Comp on /new-home (PR #35).** Plumbed `comp_cache` enrichment into `/api/feed`. Per-job: read `comp_cache.data.tiers` (early/mid/director ranges) by company name, map the job's classified level to the matching tier, surface as a string. Added Min Comp filter (server-side `min_comp` param). Sort by comp also works.

**6. Email quality overhaul (PRs #27, #34, #36):**
- **PR #27 — Firehose sort**: companies with ≥10 new jobs pushed to the bottom of the email. High-signal/low-volume companies surface first.
- **PR #34 — Zombie-return fix**: stopped pushing `returnedJobs` into the `newJobs` array. URL-flicker (job temporarily disappears + reappears next day) was flagging jobs first_seen in February as "new today." Also added day-of-month rotation for recommendations — wrong shape, user objected.
- **PR #36 — 2-week return rule + recommendation history**: a returned job only counts as "new" if it's been removed ≥14 days. Added `seen_jobs.last_removed_at` column (stamped when status flips active→removed). Replaced day-of-month rotation with `recommendation_history` table: cron writes after picking recommendations, then excludes companies shown in last 7 days. If pool exhausted, falls back to older history.

**7. logo.dev integration (PRs #37 + #38).** Added `NEXT_PUBLIC_LOGO_DEV_TOKEN` env var (publishable key, safe to expose like Stripe pk). When set, primary logo URL is `img.logo.dev/{domain}?token=...&size=64`; falls back to DuckDuckGo when unset. PR #38 fixed Workday subdomain extraction — `nvidia.wd5.myworkdayjobs.com` was returning full hostname, CDNs couldn't resolve. Added iCIMS + Oracle hostname patterns + `LOGO_DOMAIN_OVERRIDE` map for non-`.com` brands (linear.app, magic.dev, notion.so, confluent.io).

**8. /api/admin/email-status (PR #39).** New admin route that proxies Resend's `/emails` list API. Optional `?email=` filter to investigate "did user X get the email?" Returns `{id, to, from, subject, last_event, created_at}` per email. Built specifically because user did NOT want per-recipient send logs in our own DB: *"I don't want the user emails living in my database, right? I want them to live secretly in [Resend] so that we don't have to worry about PII getting exchanged."* Lets us diagnose missing-email reports without compromising on data minimization.

**9. CRITICAL: Supabase `listUsers()` pagination bug (PRs #40 → #41).** Admin stopped receiving the daily email on 2026-05-20. Resend showed ZERO record of an attempt. Investigation: `supabase.auth.admin.listUsers()` defaults to `perPage=50`. User count had crossed 50 on 2026-05-19 (66 total users). The 16 oldest users — including admin, who was the first to sign up — were silently paginated out of the daily cron iteration.

- **PR #40 (one-line fix)**: passed `{ perPage: 1000 }` at all 5 call-sites. Immediate unblock.
- **PR #41 (refactor)**: extracted `backend/src/lib/listAllUsers.ts` helper with proper cursor pagination (PAGE_SIZE=1000, MAX_PAGES=100 safety cap). All 5 call-sites migrated. **Convention from now on: never call `supabase.auth.admin.listUsers()` directly.**

**10. Workday cluster investigation (sidequest).** Spawned scraper-doctor agent on 7 broken/zero Workday companies (BoA, BMS, Accenture, 23andMe, Eli Lilly, Chegg, Pfizer). Three distinct failure modes identified:
- Misconfigured boardPath (BoA, BMS) → SQL fix applied via Supabase MCP.
- ATS migration (Eli Lilly → Phenom) → applied.
- Structural zero (Accenture all non-US locations, 23andMe in hiring freeze) → marked `is_verified_zero=true`.
- Deprecated tenant (Chegg) → deferred.

**11. CLAUDE.md sidecar migration (PR #18).** Trimmed the global CLAUDE.md from ~36KB to ~8KB. Subsystem detail moved to 5 sidecars (scraper, middleware, routes, jobs, components). PreToolUse hook at `.claude/hooks/sidecar-guard.js` blocks Edit/Write tool calls on those folders until the sidecar has been Read in the same session. Removes per-session re-derivation of subsystem rules.

**12. Levels.fyi catalog growth research (research-only).** Downloaded all 75 sitemap shards (~2.2GB). Extracted 61,199 distinct levels.fyi company slugs via Python. Cross-referenced with our 243-company catalog: 90% match rate (218/243). The 60,980 unmatched slugs were mostly tiny businesses — wrong shape for our audience (same lesson as the Common Crawl detour). Recommended user reach out to levels.fyi for distribution partnership. Backlogged as task #29.

### Alternatives considered

**Swap `/` → `/new-home` immediately vs parallel route first.** Considered making `/new-home` the new home immediately. Rejected: the marketing landing has a known PostHog conversion rate and Lighthouse 100 score. Parallel route lets user see the new UX live, decide if it converts/feels right, then we swap. Cheap reversibility wins.

**Client-side region filter vs server-side.** PR #28 shipped client-side: backend returned all jobs, frontend filtered. Looked instant but quickly broken when user clicked "Midwest" and saw "1 job (497 remaining)" — the page knew there were more but couldn't fetch them. Moved server-side in PR #29. Lesson: when the filter is on a big dimension (region cuts ~70% of jobs), client-only filtering is always wrong.

**Day-of-month rotation for email recommendations vs history table.** PR #34 shipped deterministic day-of-month wraparound (day 1 = companies 1-3, day 2 = companies 4-6, etc.). User objected: *"You don't have to do ABC. It could be A C E... You keep a pool of eight candidates and show a different three each day. That doesn't make sense."* Replaced with `recommendation_history` table + 7-day exclusion window in PR #36. The history table is more expensive but matches user intent.

**Log per-recipient sends to our DB vs query Resend.** Considered adding a `daily_email_sends` table to record who got what email when. Rejected: user explicitly does NOT want emails in our DB for PII reasons. Resend keeps the per-recipient send log anyway — we just need to query it. `/api/admin/email-status` proxies Resend directly. Zero new tables, zero new PII surface.

**Patch `perPage` at every call-site vs extract helper.** PR #40 patched the 5 call-sites with `{ perPage: 1000 }` to unblock immediately. PR #41 followed up with the helper. Considered skipping PR #41 (1000 is plenty of headroom for years). Did it anyway because user explicitly: *"When I get over a thousand users, the same issue will happen again?"* The helper enforces correct behavior for future call-sites too.

**Build comp-based seniority calibration vs manual FAANG seeding.** Considered using levels.fyi early-tier TC (e.g., Google early-PM TC = $183k) as input to per-company seniority threshold. Deferred: needed manual FAANG seeding NOW for the email to not be noisy; comp-validation is a separate backlogged build (task #28). Manual decision holds — FAANG titles are genuinely inflated and the threshold won't change frequently.

**Run change-reviewer on every PR vs only non-trivial.** Skipped change-reviewer on PRs #29 → #32 (filter bug-fix PRs, each 1-2 line changes). Ran it on PR #36 (recommendation history was new table + new logic) and PR #41 (pagination helper). Cost-benefit holds — agents are valuable when scope is non-trivial.

### Key insights

- **The pagination bug is the lesson of the sprint.** Default values in SDKs are dangerous when the default looks reasonable until you cross the implicit boundary. perPage=50 looked fine for the first 50 days of growth. The 51st user was the cliff. Two takeaways: (a) ANY paginated SDK call needs explicit pagination handling — never trust the default, (b) when an external system (Resend) handles the actual delivery, query IT for ground truth, don't reinvent its log.
- **Cheap reversibility beats perfect-on-first-try.** `/new-home` as parallel route, manual FAANG seniority seeding, suppressing emails via `is_verified_zero=true` rather than hard-delete — all cheap to roll back. The version that ships isn't required to be the version that lasts.
- **PostgREST has multiple silent failure modes.** Three found in one sprint: (1) nested-table ordering silently no-ops with both `foreignTable` and `referencedTable` options, (2) OR clause delimiter is comma so values with commas need double-quotes, (3) `ilike` vs `like` is case-sensitivity. Each was a 1-2 line fix once known. The cost was knowing.
- **Honest verification matters as much in feed UX as in scrapers.** Built the region filter, shipped it, "tested" by clicking the dropdown. Result: client-side filter that didn't actually filter. The verification gap was "does the visible row count match what the user expects." Same lesson as scraper verification: writing the code is necessary but not sufficient; running it against real data with real expectations is the check that matters.
- **Email quality compounds.** Every bad signal (zombie return, repeated recommendation, junior FAANG noise) trains the user to skim the email faster. Each fix is small in isolation; together they shift the email from "noise I skim" to "signal I read." The fixes weren't individually exciting but the bundle moves the product meaningfully.

### Files / artifacts

- **16 merged PRs**: #18 (sidecar migration), #19 (admin digest analysis), #20 (add-batch slash command), #21 (admin digest kill switch), #22 (industry column + backfill), #23 (recommendation block), #24 (/new-home v1), #25 (/new-home public + ?next=), #26 (cookie propagation fix), #27 (firehose sort), #28 (/new-home v2 table), #29-#32 (filter fixes), #33 (seniority threshold), #34 (zombie filter + rotation), #35 (comp on /new-home), #36 (2-week return + history table), #37 (logo.dev), #38 (Workday logo fix), #39 (email-status endpoint), #40 (perPage=1000), #41 (listAllUsers helper).
- **New backend files**: `backend/src/lib/listAllUsers.ts`, `backend/src/routes/feed.ts`.
- **New frontend files**: `frontend/src/components/JobFeed.tsx`, `frontend/src/app/new-home/page.tsx`.
- **New DB**: `companies.industry`, `companies.min_relevant_seniority`, `seen_jobs.last_removed_at` columns; `recommendation_history` table.
- **Migrations folder created**: `backend/migrations/` with 3 dated SQL files.
- **Slash command + hook**: `.claude/commands/add-batch.md`, `.claude/hooks/sidecar-guard.js`, `.claude/settings.json`.
- **5 subsystem sidecars**: `backend/src/scraper/SCRAPER.md`, `middleware/AUTH.md`, `routes/ROUTES.md`, `jobs/JOBS.md`, `frontend/src/components/COMPONENTS.md`.
- **2 memory files saved**: `feedback_response_style.md`, `feedback_pr_summary_format.md`.

### Next batch — open ideas

- **Swap `/new-home` → `/`** when user greenlights the new feed as the default surface.
- **Comp-based email recommendations** (backlog #28) — mirror `/new-home`'s Min Comp filter inside the email recommendation picker.
- **Levels.fyi distribution partnership** — research route deferred; outreach instead of scraping.
- **Vercel preview env points to stable Railway preview backend** (backlog #19) — currently previews hit prod backend, which is risky for any backend-touching PR.
- **Phase 1 Stripe billing** — 3-tier auth model from existing monetization plan.
- **Comp-based auto-seniority calibration** — per-company `min_relevant_seniority` set automatically from levels.fyi early-tier TC.

---

## 2026-05-20 evening — Home Swap, Login Redesign, Dashboard Cleanup, ADMIN_EMAIL Pivot (PRs #42 → #51)

### Context

Earlier the same day we shipped the listUsers pagination fix (PR #41). With the JobFeed at `/new-home` having stabilized through the filter bug-fix cluster, the evening sprint pivoted to user-facing polish + the swap that retires `/new-home` as a parallel route and makes it the canonical homepage. A second mini-theme emerged: the Dashboard had operator-grade UI (Errors stat, four filter pills) that didn't fit a user-facing surface, and the login page was a blank "Sign In" header that felt jarring next to the visually-dense new home.

### What was decided

**1. `/new-home` hero + DST timestamps + login welcome (PR #42).** Extracted the existing landing hero into a reusable `LandingHero.tsx` component (~489 lines). `/new-home` now reuses it. Added DST-aware PT/ET label alongside the existing "14:00 UTC" via `Intl.DateTimeFormat`. Login page gained "Welcome to NewPMJobs" + value-prop checklist + "Free. No fees." Function filter added to JobFeed (Product Management only — placeholder for future functions).

**2. Compact hero variant (PR #43).** Full-viewport hero was wrong; user wanted "2/3 hero + 1/3 jobs peek." Added `compact={true}` prop to `LandingHero` that drops min-height, tightens top padding, hides the "Tracking daily" company strip. `/new-home` consumes it; `/` stays full-bleed.

**3. Global NavBar restoration + login dark gradient + stat strip (PR #44).** Fixed wrapper on `/new-home` had `z-30` which hid the global NavBar. Dropped to `z-0` with `pt-[54px]` to clear the NavBar. Login got dark gradient bg + two decorative radial orbs + colored glow shadow on the card + stat strip ("Tracking 240+ companies · Updated daily · Made by a PM").

**4. Time format consistency (PR #45).** JobFeed scrape-time line was mixed-format: "14:00 UTC · 7am PT · 10am ET". Switched UTC to 12-hour via the same `Intl.DateTimeFormat` helper used for PT/ET — now uniform: "2pm UTC · 7am PT · 10am ET."

**5. Login decorative cards (PR #46 + #47).** Filled the dark login bg with 10 floating company cards (3-2-2-3 corner arrangement, `lg:` only, `pointer-events:none + aria-hidden`). Different mix from the `/new-home` hero (Apple/Microsoft/Amazon/Meta/Anthropic/Linear/Notion/Moderna/Goldman/Tesla) so the two pages feel distinct. PR #47 upgraded the cards to real brand logos (logo.dev → DuckDuckGo fallback chain, same pattern as JobFeed) and swapped Moderna → Pfizer (more recognizable to general audience) + Meta → OpenAI. Added the same 60px grid texture overlay the hero uses (rgba 0.015 opacity) for depth.

**6. The Home swap (PR #48).** The big one. `/` now renders the JobFeed home (was the LandingPage/Dashboard split). `/welcome` is a new route preserving the original marketing landing for rollback. `/companies` is a new route rendering Dashboard directly (the Tracked Companies view authed users used to see at `/`). `/new-home` deleted; `frontend/next.config.ts` gets a permanent 308 redirect `/new-home → /` so bookmarks keep working. AuthNav got a "Sign In" button for unauth visitors (was returning null). JobFeed Track button: redirect `?next=/new-home` → `?next=/` so post-login the user lands back on the new home. **Rollback path documented in the PR**: change `frontend/src/app/page.tsx` to render `LandingPage` again, drop the redirect, /welcome and /companies routes can stay.

**7. Hotfix auth-aware Home (PR #49).** PR #48 shipped `/` as JobFeed for ALL users including authed. Authed users clicking "Home" in the NavBar dropped into the public feed instead of their own Tracked Companies. PR #49 restored the original auth-aware split: authed → Dashboard ("Tracked Companies" same as before the swap), unauth → JobFeed home. Both states still get the new global NavBar. `/companies` still renders Dashboard directly (redundant for authed-`/` but harmless; can dedupe later).

**8. Dashboard colors + Starred page perf (PR #50).** Two unrelated UX fixes bundled because both small. (a) Extended `BRAND_COLORS` from 25 → ~70 hand-mapped companies (Snap, Visa, Capital One, Expedia, Adobe, Salesforce, Shopify, Snowflake, Notion, Linear, Pfizer, Moderna, Eli Lilly, J&J, Goldman, JPM, Morgan Stanley, Mastercard, Amex, Robinhood, Coinbase, Klarna, Tesla, Lyft, Pinterest, LinkedIn, Spotify, Twitch, HubSpot, Atlassian, Asana, GitHub, Databricks, Oracle, Intel, NVIDIA, Twilio, Dropbox, etc.). Added djb2 hash-based palette fallback (16-color brand-style palette) so unknown companies get a deterministic color instead of generic gray #6B7280. Same company = same color across refreshes. (b) New backend endpoint `GET /api/favorites/jobs` returns user's starred jobs already joined with company info. Replaces the "fetch ALL jobs across ALL subscriptions, filter client-side" flow which sent 1000+ rows to display ~10-50 stars. Frontend at `frontend/src/app/jobs/page.tsx` uses the new endpoint when `?filter=starred`. Saves a separate `/api/favorites` call too — favorite IDs derived from returned jobs. Expected ~5-10x faster first load on `/jobs?filter=starred` for users tracking many companies.

**9. Dashboard cleanup + ADMIN_EMAIL → Gmail (PR #51).** Dashboard: added "Total Companies" stat box (left of Roles + New Today). Removed Errors stat box (operator metric, not user-facing). Removed All/New/Healthy/Errors filter pills next to Search. Dropped filter state, `filters` array, `FilterKey` type, `filterCompanies` helper, and the now-orphaned `errorCount` calc. Search bar stays. ADMIN_EMAIL: code fallback in `backend/src/lib/constants.ts` changed from `vik@viktoriousllc.com` → `vikrant.agar@gmail.com`. **CAVEAT shipped as a known follow-up:** Railway `ADMIN_EMAIL` and Vercel `NEXT_PUBLIC_ADMIN_EMAIL` env vars still explicitly set to the old VLLC address. Env vars override code fallback, so prod admin still resolves to VLLC until user updates both dashboards manually. Captured in `docs/backlog.md` Future Ideas as a P1 follow-up.

### Alternatives considered

**Swap `/` → JobFeed immediately vs keep `/new-home` parallel longer.** Considered keeping the parallel route for another week to gather more PostHog conversion data. Rejected: the iteration loop on `/new-home` had stabilized, the user had visually validated the hero in compact mode + NavBar restoration + login redesign, and continuing the parallel route was adding mental overhead ("which home is the real one?") without buying real signal. Cheap reversibility was the safety net — `/welcome` preserves the old landing and the rollback is a one-line change.

**Bundle home-swap + login redesign vs sequence them.** Considered shipping home-swap first, then iterating on login over the next few days. Bundled them because the login redesign was driven by visual coherence with the new home — landing on a blank "Sign In" after the rich JobFeed felt jarring. Bundling kept the visual story coherent in one merge.

**Manual brand-color extension vs algorithmic palette only.** Considered just shipping the djb2 hash palette as the universal fallback without hand-mapping the additional ~45 companies. Rejected: hand-mapping is high-leverage for known brands — Pfizer should be Pfizer-blue, not a hash-assigned random color. Did both: hand-mapped the top ~70 brands, palette fallback for the long tail.

**Code-level ADMIN_EMAIL fallback only vs full env-var update.** Could have flipped both the code fallback AND the env vars in Railway/Vercel in one motion. Did only the code fallback because env-var changes require dashboard access we don't have via CLI in this session. Flagged the manual step explicitly in the PR description and end-of-task summary. User correctly noted that code-only didn't actually change prod behavior — captured as a feedback memory: `feedback_env_var_override_gotcha.md`.

**Hotfix authed-Home in a separate PR vs amend PR #48.** Could have force-pushed an amendment to PR #48. Did a separate hotfix PR (#49) because PR #48 was already merged when the bug was caught. Standard pattern: hotfix forward, not rewrite history.

### Key insights

- **The swap is anticlimactic when the parallel route is honest.** Two days of `/new-home` running in parallel with the marketing landing meant the swap itself was a 4-file PR with documented rollback. The risk had been amortized across the build phase, not concentrated in the swap moment.
- **Visual coherence drives UX work.** Once the JobFeed became the public face of the product, the gaps (blank login, Errors stat on Dashboard, gray brand bars) became visible in a way they weren't before. The polish PRs (#46, #47, #50, #51) weren't planned — they emerged from looking at the new home with fresh eyes.
- **Env-var overrides code-level defaults silently.** This is the lesson of PR #51. A code-level change that looks like a config flip doesn't actually do anything in prod when an env var of the same name is set. Going forward: any `process.env.X || 'fallback'` change needs an explicit env-var-status check before reporting "done." Captured as a feedback memory so future-me doesn't re-ship the silent no-op.
- **Bundle small unrelated UX fixes when scope is genuinely small.** PR #50 bundled brand colors + Starred perf — two unrelated changes, each small. The alternative (two separate PRs) would have been more orthodox but pointless friction. Same logic for PR #51 (Dashboard cleanup + ADMIN_EMAIL). The bundling rule: if both fit in one PR description without needing distinct test plans, ship together.

### Files / artifacts

- **10 merged PRs**: #42 (hero preamble + DST + login welcome), #43 (compact hero), #44 (NavBar restoration + login dark gradient), #45 (12-hour time format), #46 (login decorative cards), #47 (login real logos + Pfizer/OpenAI swaps), #48 (Home swap), #49 (hotfix auth-aware Home), #50 (brand colors + Starred perf), #51 (Dashboard cleanup + ADMIN_EMAIL Gmail).
- **New frontend files**: `frontend/src/components/LandingHero.tsx` (extracted), `frontend/src/app/welcome/page.tsx` (rollback backup), `frontend/src/app/companies/page.tsx` (Dashboard direct).
- **Deleted frontend files**: `frontend/src/app/new-home/page.tsx` (replaced by `/` + redirect).
- **New backend route**: `GET /api/favorites/jobs` in `backend/src/routes/favorites.ts`.
- **Frontend redirect**: `frontend/next.config.ts` permanent 308 `/new-home → /`.
- **New memory file**: `feedback_env_var_override_gotcha.md`.

### Next batch — open ideas

- **Update Railway `ADMIN_EMAIL` + Vercel `NEXT_PUBLIC_ADMIN_EMAIL`** env vars to `vikrant.agar@gmail.com` so prod admin actually resolves to Gmail. ~2 min in dashboards. Backlogged as F.X.
- **Dedupe `/` (authed Dashboard) and `/companies` (Dashboard direct)** — both render the same component for authed users. Consider whether `/companies` stays or redirects to `/`.
- **PostHog conversion comparison** between the old marketing landing and the new JobFeed home. Should reveal whether the swap was a win.
- **Add more Function filters** to JobFeed (Engineering, Design, Data) — the dropdown is currently single-option. Backlog item if user wants to expand audience beyond PMs.
- **Login page swap-out for unauth `/` cards** — the marketing landing at `/welcome` could be retired once the new home has a few weeks of PostHog data validating it.

---

## 2026-05-22 — Weekly LinkedIn-draft Digest Email + Voice Infrastructure (PR #52)

### Context

Vik wanted to start producing a weekly LinkedIn post off the catalog data. There's already a "by level" jobs poster on LinkedIn the user follows; Vik wanted differentiation. The brainstorm produced 5 candidate cards: by vertical, by hiring velocity, by comp, by level, by AI cut.

After exploring each card with real numbers from the past 7 days (524 new PM roles across the 244 tracked companies — Capital One alone posted 121, banking took 45% of all new hiring, 43 AI-tagged roles), Vik landed on a **single weekly post with multiple sections** rather than rotating one card per week. Rationale: a single rich post is a better content artifact and gives him room to audible to the strongest lead each week from the same data.

A separate thread: Vik dropped his **voice style guide + calibration samples** into `docs/Viks Voice/` (gitignored, ~35KB across 2 files). The voice work matters because I literally violated his anti-slop list in the first draft attempt — "That's not a backfill week. That's a company scaling a function" is the banned "X. It's about Y" false-dichotomy reframe. Vik flamed it correctly. The voice files are now required reading before drafting any user-voice content.

### What was decided

**1. Single weekly post format (locked editorially).** Approved 2026-05-22 structure:

> Intro: "I track 244 companies' PM job postings every day at newpmjobs.com. Starting this week, I'll share the highlights every Friday."
>
> "This week, N new PM roles were posted. Here are the key insights:"
>
> **Banking is on a tear.** 45% in banking. (Industry breakdown inline)
>
> **Top 10 companies by volume:** (numbered list, raw counts)
>
> Top company sample role areas (Capital One: Card Partnerships, AI Acceleration, Enterprise Platform, Payment Networks, Financial Ledger)
>
> **Where the new AI PM roles landed (N this week):** (top 5 companies, example titles)
>
> "Where are you applying right now? And what else would you want to see in next week's summary?"

The reader-question close serves double duty: standard LinkedIn engagement driver + crowdsources future content angles.

**2. Auto-trigger inside the daily cron (not a separate Railway schedule).** Embedded `sendWeeklyDigest()` inside `runDailyCheck()` after the consolidated admin digest with a `new Date().getUTCDay() === 5` gate. Railway daily cron at 14:00 UTC → scrape ~15-25 min → per-user alerts → comp_cache refresh ~3 min → admin digest → weekly digest. Email fires around 14:25-14:35 UTC on Fridays. This is the canonical pattern for any future weekly job — don't add new Railway cron entries.

**3. Three manual triggers.** `POST /api/admin/weekly-digest/send` (admin JWT) for ad-hoc fires from devtools, `GET /api/admin/weekly-digest/preview` (admin JWT) to inspect the computed data + rendered post + HTML without sending, `GET /api/cron/weekly-digest` (CRON_SECRET) as an alternative entrypoint. `/api/cron/trigger` also accepts `?forceWeeklyDigest=true`.

**4. Voice file infrastructure.** Saved `memory/reference_vik_voice_files.md` as a reference memory linked from MEMORY.md's index. The pattern: don't inline voice content into memory (the files are big and will evolve); instead, save a pointer that says "READ these two files before drafting any user-voice content." MEMORY.md is loaded at every session start, so the pointer surfaces automatically.

**5. Framing rule Vik insisted on.** Always say "the N companies I track at newpmjobs.com" — never just "companies I track" (omits the brand) and never frame the numbers as if they're exhaustive ("236 banking PM roles posted this week" implies all of banking; "236 of the roles tracked at newpmjobs.com" is honestly curated).

### Alternatives considered

**5-week rotation vs single weekly post.** Initial proposal: rotate one card per week (velocity → by-level → AI → vertical → state-of-month). Rejected by Vik: he wanted a richer dashboard each Friday with the option to audible. Single-post-with-sections won. Tradeoff: less content runway per data window (vs 5 weeks from one week's data), but each post is heavier and harder to ignore in a LinkedIn feed.

**Comp-led post vs comp as supporting data.** Earlier draft led with "Top 10 highest-paying new PM roles this week — $840k ServiceNow, $631k Salesforce..." Vik rejected: comp data only exists for ~34% of roles (the levels.fyi-tracked set), and leading with comp risks calling out specific companies for being LOW (e.g., Instacart, where he's interviewing). Comp moved to supporting data, not a lead.

**By-level post vs the cross-cuts.** The competitor on LinkedIn already does pure by-level (VP/Director/Sr Director/Group PM/Principal). Vik decided to differentiate via cross-cuts (industry, AI) rather than compete directly. By-level is parked as a possible future post.

**Inline voice samples into memory vs reference pointer.** Considered putting Vik's voice patterns directly into memory entries. Rejected: voice files are large (35KB) and will be edited by Vik over time. Pointer in MEMORY.md is the right shape — always loaded at session start, always points to the latest version of the files.

**Trigger via separate Friday cron vs embed in daily cron.** Could have added a second Railway cron entry for Fridays. Rejected: Railway cron is an operational surface that should be minimized. One canonical entry point (`/api/cron/trigger`) with day-of-week gates inside the code is cleaner.

### Key insights

- **Voice work is required reading, not aesthetic preference.** I violated the anti-slop list (banned "X. It's about Y" template, contrived retrospection) on the first draft, despite having saved a memory pointer to the voice files moments earlier. Saving the pointer didn't change my behavior — only reading the files would have. New rule: when about to draft user-voice content, the first tool call is `Read` against both voice files. Not "Hmm, do I know Vik's voice?" — just read them.
- **Editorial structure should be locked once approved.** Spent multiple turns iterating with Vik on the post structure. Once he said "this is pretty perfect," the structure is now fixed in `renderLinkedInPost()`. Future edits to that function need re-approval. Documented this in JOBS.md.
- **The pointer pattern for memory is correct for large/evolving reference content.** Voice files, prior-art research dumps, vendor docs — all should live in `docs/` (or equivalent) with a reference memory pointing at them. Saves memory context budget and keeps the source of truth singular.
- **Verification gap when the action lives in an external system.** I cannot directly verify "did Resend send the weekly email" from this terminal because the admin endpoint requires Vik's admin JWT (which lives in his browser session, not in CLI). Fallback pattern: schedule a `CronCreate` one-shot at fire-time + 10min, plus give Vik a devtools snippet he can paste to verify directly. Same pattern applies for any future "did vendor X do Y" verification.
- **Cron-day-of-week gate inside `runDailyCheck()` is the new canonical pattern.** For any future weekly task (Sunday retention email, Monday leaderboard, etc.), embed inside `runDailyCheck()` with a UTC day gate + a `forceXDigest` option. Don't add new Railway cron entries.

### Files / artifacts

- **Merged**: PR #52 (Weekly LinkedIn-draft digest) + PR #53 (savecc docs for PRs #42-#51).
- **New backend module**: `backend/src/jobs/weeklyDigest.ts` (256 lines) — `computeWeeklyDigest`, `renderLinkedInPost`, `renderEmailHtml`, `sendWeeklyDigest`.
- **New endpoints**: `GET /api/cron/weekly-digest`, `POST /api/admin/weekly-digest/send`, `GET /api/admin/weekly-digest/preview`. `/api/cron/trigger` accepts `?forceWeeklyDigest=true`.
- **Modified**: `backend/src/jobs/dailyCheck.ts` — Friday auto-trigger after admin digest; `forceWeeklyDigest` option in `runDailyCheck`.
- **JOBS.md sidecar updated** with the Weekly Digest section.
- **New voice files** (gitignored): `docs/Viks Voice/vik_voice_style_guide.md` + `vik_calibration_samples.md`.
- **New memory**: `memory/reference_vik_voice_files.md` (pointer to voice files, indexed in MEMORY.md).
- **Scheduled task**: `CronCreate` one-shot at 07:43 PDT 2026-05-22 (session-only — verifies the natural Friday cron fired the digest; session may close before fire time).

### Next batch — open ideas

- **Watch the first 2-3 weekly emails land** and tune the post text based on what Vik actually wants to copy-paste vs edit by hand.
- **By-level cross-cut** as a separate occasional post — what we already have data for (`seen_jobs.job_level`), just not part of the weekly recurring format. Use for one-off LinkedIn posts when the level distribution shifts.
- **Resend dashboard link** in the email footer so Vik can verify delivery in one click without devtools.
- **Track engagement on the weekly LinkedIn posts** — manually for the first month, then add a column to a tracking sheet if it grows into a real channel.
- **Voice file enforcement via hook?** Currently the reference memory + MEMORY.md pointer is honor-system. A PreToolUse hook that blocks user-voice drafting unless the voice files have been Read in the current session would be belt-and-suspenders. Defer unless I slip again.

---

## Phase 25 — Linear Feedback Workflow + Auth Incident + Three-Layer Defense-in-Depth (2026-05-22 to 2026-05-25)

**Three threads ran in parallel.** The session started as a Linear workspace setup. It pivoted into a real incident response when two users emailed about missing login emails. It ended with three independent prevention layers shipped, plus a workflow migration to Linear for ongoing feedback management. 12+ PRs merged in the window.

### Headline decisions

**1. Feedback migrated from Supabase tables to Linear (User Feedback team).** Old `help_submissions` and `scrape_issues` tables hold pre-cutover history; no new rows are written. `POST /api/help` and `POST /api/issues` now create Linear issues with proper Type + Source labels and email admin with the Linear URL inline. The admin email lands the same way it always did, but every email is now also a link straight into a triage workflow.

**2. The auth incident root cause was misdiagnosed in two ways.** First, I'd shipped a broken Supabase Auth template (`{{ .ConfirmationURL }}` instead of `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...`) and assumed that was the whole story. Second, the related Linear issue (DEV-3) was titled "Magic Link fix — non-Gmail, Safari mobile" because that's what the user reports looked like. The actual bug was universal — `NextResponse.redirect()` in `/auth/confirm` drops cookies set by Supabase SSR's `verifyOtp()`. Same class of bug PR #26 fixed in middleware.ts but never backported to the route handlers. Eleven users were in "confirmed but no session" state before my template change even happened.

**3. Three layers of defense, not one fix.** A single "remember to read AUTH.md before deploying" rule has 100% failure mode — I broke it within a week of the sidecar existing. Three independent layers each catch the bug class:
- **PR-time (DEV-12 CI auth template check)**: GitHub Action asserts deployed Supabase Auth templates match AUTH.md format. Fails any PR touching auth code if the templates regress. Requires SUPABASE_PAT_CI in repo secrets (pending Vik to add).
- **6-hour (DEV-13 PostHog auth funnel)**: 4 events instrument the magic-link flow. Drop-off between `auth.signin_link_clicked` and `auth.signin_success` is the exact signature of the cookie bug. A 50% conversion alert would have paged me ~6 hours after the broken templates deployed.
- **24-hour (DEV-11 daily code audit)**: Heuristic GitHub Action cron scans last 24h diff for 4 known risk patterns. Catches drift even if it bypasses the PR check (e.g., changes made via the Supabase Dashboard directly).

**4. Defense work happens IN PARALLEL with incident response, not after.** Built the CI check (PR #64), the admin recovery endpoint (PR #63), and the cookie fix (PR #62) before all 18 stuck users were even recovered. Prevention is most valuable while the failure mode is fresh in mind.

**5. PostHog + Sentry MCPs over UI clicks for ongoing analytics work.** Configuring one funnel via PostHog UI is ~10 minutes. Configuring funnels across the next 12 months (Stripe onboarding, paywall conversion, referral, Twilio events) is hours of click-work. MCPs installed once make every future analytics ask conversational, same as Linear MCP today. Setup pending.

### Alternatives considered

**Dual-write vs Linear-only for feedback** (Vik chose Linear-only). Could have kept writing to both Supabase tables AND Linear as a belt-and-suspenders. Rejected: dual-write means Linear is no longer the source of truth and we'd need a reconciliation story when they diverge. Plus the admin email IS the failsafe — if Linear API fails, admin still gets emailed with a "Linear creation failed" callout in the body. Single canonical surface (Linear) with email as ground-truth backup is cleaner.

**Manual clicks in Supabase Dashboard vs admin endpoint for recovery** (Vik picked the endpoint after seeing the count grow to 18). The dashboard works but doesn't scale — every future stuck-user scenario would need the same clicks. The admin endpoint took ~30 min to build and is reusable forever, plus it becomes the foundation for DEV-14 [stuck-user reminder system] and DEV-15 [admin recovery UI].

**Pasting SUPABASE_SERVICE_KEY vs building the admin endpoint** (Vik rejected paste). Service key has very high blast radius — anyone holding it can read all user data and rewrite the database. Pasting into chat creates exposure even if brief. The admin endpoint uses the service key already in Railway env (no new exposure) and gates access by admin JWT. Cleaner forever.

**CronCreate-based daily audit agent vs GitHub Actions** (chose GitHub Actions). Original DEV-11 spec called for a daily remote agent that spawns Claude specialist sub-agents. Discovered CronCreate is session-only — jobs die when Claude session ends. GitHub Actions cron is the right primitive for reliable 24/7 background audits. Heuristic regex matching is less powerful than agent reasoning but is reliably executable. Full agent-spawning version deferred to a v2 if/when we want the deeper analysis.

**Tier-2 e2e smoke test deferred.** DEV-12's Tier 1 (static template check via Management API, no email sent) catches yesterday's specific bug. Tier 2 (actual signup → click → session flow via Playwright) would catch a broader class. Deferred because: (a) Tier 1 alone closes the specific gap we hit, (b) sending real emails in CI uses Resend quota (low concern given Pro plan but worth noting), (c) the cookie-bug class would be caught by DEV-13's PostHog alert independently.

**MCP install path: PostHog wizard vs manual `claude mcp add`** (had to fall back to manual). PostHog's `npx @posthog/wizard@latest mcp add` only detects Cursor + VS Code, not Claude Code CLI. Manual `claude mcp add --transport http posthog https://mcp.posthog.com/mcp -s user` is the documented fallback per PostHog's Claude Code docs.

### Key insights

- **"Cosmetic" tasks aren't cosmetic when they touch load-bearing config.** I framed the email template work as design polish. The variable name (`{{ .ConfirmationURL }}`) should have prompted "what does this generate?" but I treated the documented default as inherently safe. The structural fix isn't "read sidecars next time" (honor system) — it's automated enforcement (CI check). The honor system is fine for behavior nobody actually performs; for behavior performed regularly, automate the constraint.
- **A "preview file" that doesn't simulate the actual user action isn't a preview.** Standalone HTML previews of the auth templates looked great in a browser. They didn't catch the bug because they couldn't exercise the real template-variable substitution that happens at send time. Real previews require the actual send + click loop.
- **Mislabeled issues hide root causes for months.** DEV-3 was titled by symptom ("Safari Mobile / non-Gmail") rather than architectural artifact ("auth route handlers drop session cookies on redirect"). The title encoded the wrong mental model and made the bug feel niche. Going forward: title issues by the broken artifact, not the user-visible failure.
- **Observability lives in observability tools, not the application database.** Reflex when I see "we need to monitor X" is "add a column or table." That conflates application data with monitoring surface. Right split: errors → Sentry, funnels → PostHog. Codified as `feedback_telemetry_to_posthog_sentry.md`.
- **SDK defaults are landmines, again.** Phase 23 was `listUsers` defaulting to perPage=50. Phase 25 was Supabase Auth's template variable defaulting to `{{ .ConfirmationURL }}`. Pattern: every SDK has invisible cliffs hidden behind reasonable-looking defaults. New rule: never use SDK defaults for anything load-bearing — explicit values only, with a comment explaining why.
- **Linear as canonical feedback surface compounds.** Moving feedback to Linear felt like a workflow change. It's actually an architecture change. Supabase tables were data without workflow. Linear is data + workflow + labels + assignees + status + cross-references in one place. Future expansions (DEV-14, DEV-15) build on the Linear primitive rather than building a parallel admin surface in our own app.
- **Reference-an-Issue-ID requires a 2-3 word descriptor in brackets.** Saving `DEV-3` alone forces Vik to remember what DEV-3 is. `DEV-3 [Safari Mobile / non-Gmail auth]` does not. Captured as `feedback_linear_id_descriptors.md`. Same pattern applies to USRFDBK-N references.
- **18 users in the broken state was 9x my initial estimate.** Vik reported 2 complaints. The database query found 11 stuck "confirmed no session" + 7 "never confirmed" = 18 affected. Always query the data rather than trusting the count from user reports — most stuck users won't email you.

### Files / artifacts

- **Merged this phase**: PR #55 (Linear feedback wiring), #56 (branded feedback emails), #57 (dashboard Available + feature_request), #58 (5-stat dashboard layout rewrite), #59 (em/en dash sweep), #60 (weekly digest appendix), #61 (digest intro rewrite), #62 (DEV-3 cookie fix), #63 (admin send-magic-link), #64 (DEV-12 CI auth template check), #65 (DEV-11 daily code audit), #66 (DEV-13 auth funnel events).
- **New backend modules**: `backend/src/lib/linear.ts` (Linear GraphQL client), `backend/src/lib/feedbackEmail.ts` (branded HTML helper), `backend/src/scripts/update-auth-templates.mjs` (one-shot Supabase Auth template deploy).
- **New frontend module**: `frontend/src/lib/serverAnalytics.ts` (PostHog HTTP capture from route handlers).
- **New CI infrastructure**: `.github/workflows/auth-template-check.yml`, `.github/workflows/daily-code-audit.yml`, `.github/ci/check-auth-templates.mjs`, `.github/ci/daily-code-audit.mjs`, `.github/ci/README.md`.
- **New Linear issues created this phase**: DEV-9 [staging env], DEV-10 [email design pass], DEV-11 [daily code audit, shipped v1], DEV-12 [CI auth smoke test, shipped Tier 1], DEV-13 [PostHog auth funnel, code shipped], DEV-14 [stuck-user reminder system], DEV-15 [admin recovery UI]. Plus USRFDBK-1..5 for migrated feedback.
- **New feedback memories**: `feedback_share_learnings_before_executing.md`, `feedback_ai_ml_capitalization.md`, `feedback_no_em_en_dashes.md`, `feedback_no_ansi_escapes.md`, `feedback_linear_id_descriptors.md`, `feedback_supabase_auth_sidecar.md`, `feedback_telemetry_to_posthog_sentry.md`. Plus `reference_railway_project.md` (the Railway project that hosts prod is "new job alert tool production", not "profound gratitude production").

### Next batch — open ideas

- **Run the 19-user recovery DevTools snippet** — top priority, real users still locked out as of 2026-05-25 evening.
- **Add `SUPABASE_PAT_CI` GitHub repo secret** so DEV-12 [CI auth template check] starts passing on every PR.
- **Install PostHog + Sentry MCPs** via `claude mcp add` commands so future analytics + alert work is conversational, not UI clicks.
- **Configure the PostHog funnel + alert and Sentry alert rule** — via MCPs once installed, otherwise manually via UI per PR #66 description.
- **Move DEV-3 to Done in Linear** — code bug fixed in PR #62 even though title misdiagnosed the cause.
- **DEV-15 [admin recovery UI]** — replaces the DevTools snippet pattern for stuck-user recovery. Becomes the foundation for the digest preview/send button too.
- **DEV-14 [stuck-user reminder system]** — daily cron checks for users who got a link but didn't click, OR signed in but added zero companies. Sends one reminder per category. Uses the admin send-magic-link endpoint already shipped.
- **DEV-10 [email design pass]** — broader cleanup across all transactional emails (magic link, confirm signup, daily alerts, weekly digest, admin alerts). Priority bumped given the auth incident showed how much email-quality matters.
- **DEV-9 [staging environment]** — the Vercel preview CSP locking connect-src to api.newpmjobs.com means there's no true pre-merge end-to-end test environment. Worth standing up before any feature with non-graceful failure modes (Stripe especially).
- **CI Tier-2 e2e smoke test** — the deferred half of DEV-12. Real signup + click + session-verify via Playwright. Catches a broader class of auth regression than the static template check alone.

### Phase 25 follow-up (2026-05-26) — the cookie regression we shipped fixing the cookie bug

PR #62 fixed the original "session cookie not propagated to redirect" bug by copying cookies onto every auth redirect using `cookieStore.getAll()`. That fix worked for the immediate symptom (cookies reached the browser) but introduced a subtle regression — `cookieStore.getAll()` from `next/headers` returns `RequestCookie[]` which is `{name, value}` only. Every cookie attribute (`maxAge`, `expires`, `sameSite`, `httpOnly`, `secure`) is stripped silently. Supabase's persistent refresh-token cookie became session-only, dying on browser close. Users had to sign in every time they reopened Chrome. Filed and fixed same day as **DEV-17 (PR #67)**.

The fix mirrors `redirectPreservingSession` in `frontend/middleware.ts` — capture cookies INSIDE the `setAll` callback into a local array (where Supabase passes the full `{name, value, options}` tuple) and re-apply onto the redirect with full attributes preserved.

**Lessons:**

- **Newly-built defenses are tuned to the specific incident that motivated them — they don't generalize automatically.** DEV-11's daily code audit had a rule for "NextResponse.redirect near auth without cookieStore.getAll() copy" (the ORIGINAL bug pattern, absence). DEV-17's regression was the OPPOSITE — wrong PRESENCE of cookieStore.getAll(). The audit rule fired on absence; it didn't catch the misuse. Captured as a v1.1 rule for DEV-11: flag `cookieStore.getAll()` used in a `response.cookies.set` pattern in auth route handlers. Strongly correlates with the attribute-strip footgun.
- **The same fix in two places can have different gotchas.** middleware.ts uses `supabaseResponse.cookies.getAll()` (Response cookies — full attributes). PR #62 used `cookieStore.getAll()` (Request cookies — attributes stripped). Both look like "copy cookies onto the redirect" but only one preserves attributes. The right pattern is to capture inside the setAll callback, not after the fact from any cookieStore.
- **18 users initially affected by Phase 25 doubled the blast radius to also include "everyone who signed in 2026-05-25 → 2026-05-26."** Every magic-link sign-in during that window got session-only cookies. Next sign-in after PR #67 deploys, they're back to persistent. No backfill needed but worth noting how a fix can quietly affect more users than the original bug.

---

## 2026-05-25 → 2026-05-26 — Post-incident hardening sweep + proactive auto-fix layer

The days after the auth incident closed out with a cluster of small fixes and one real new capability. Logged here because the in-repo log had lapsed and none of these got an entry at the time.

**Proactive auto-fix layer (PR #76, DEV-19) — the substantive one.** A rule-based layer (`backend/src/jobs/autoFixRules.ts`) that runs before each per-company scrape in the daily cron. Each rule is a pure `detect()` plus a `fix()` that corrects the DB in place, and the same-day scrape immediately uses the corrected config. The first rule, `phenom_basedomain_missing_https`, catches the exact class that left Eli Lilly broken for 5 days (a `baseDomain` missing its `https://` prefix). Fixes log to `scraper_events` and show up in the admin digest's green "auto-fixed today" section. Reactive, error-message-driven rules were scoped to a v2 because they need a catch-and-retry refactor. The point: stop waiting days for a human to notice a known-shape regression; fix it on the next cron tick.

**The rest of the sweep:**
- **PR #69 (DEV-11 v1.1):** a second daily-audit rule that flags `cookieStore.getAll()` used to copy cookies onto a response (the attribute-strip footgun from DEV-17). The original rule only caught the *absence* of a cookie copy; this one catches the *wrong presence*.
- **PR #70 (DEV-16):** escape route for the onboarding Add-Company modal that trapped brand-new users with zero subscriptions.
- **PR #75 (DEV-18):** Rivian iCIMS routing fix (its clean REST endpoint was being short-circuited to Puppeteer). The Jibe-template work for DocuSign / Pandora / Joby / Schwab stays open under DEV-18.
- **PR #73:** the Eli Lilly Phenom `baseDomain` https-prefix fix that motivated #76. **PR #72:** allowlisted 3 read-only MCP tools. **PR #74:** npm audit fix (4 moderate). **PR #77:** README.

---

## 2026-05-26 → 2026-05-29 — Interview / voice-AI feature stream (DEV-31, PRs #78-#100)

The largest user-facing build in this window, spread across ~15 PRs and admin-gated for now (ElevenLabs minutes are real money). It's the headline of the upcoming Pro tier.

**What shipped (admin-only, `/interview-test`).** A real-time spoken mock interview. One ElevenLabs conversational agent is reused across all three interview types via per-call prompt overrides; the browser connects straight over WebSocket on a short-lived signed URL minted by `POST /api/interviews/token` (we never proxy audio). Three types: behavioral, product sense, analytics. Post-call, the transcript is scored by three LLMs in parallel (Claude `claude-sonnet-4-6`, Gemini `gemini-2.5-pro`, OpenAI `gpt-4o`), all in Vik's voice via a shared eval system prompt, shown side by side. Dimensional rubrics distilled from Vik's coaching docs + real interviewer personas shipped in PR #100; the live agent is a clean interviewer (calibrates on role + seniority, one question at a time, probes "I" vs "we", stays in character, no mid-call coaching) and all scoring/coaching happens after the call. Persistence in `interview_sessions` (raw transcript + 3 evals, wiped after 7 days) plus a rolling per-user summary that survives the wipe and is injected into the next session's agent prompt (multi-session memory). `elevenlabs_conversation_id` column added (PR #95) so the raw audio can be re-fetched later for delivery analysis (only protects future sessions; past ids were never stored).

**The spike that de-risked the moat (DEV-31).** The differentiator is feedback on *how you sounded*, which transcript-only competitors can't give. Validated on a real 2:26 recording before building: a hybrid of ElevenLabs Scribe (word-level timestamps, so WPM, pause length/location, and filler counts are computed deterministically) for the numbers, and Gemini multimodal for the tone/emotion judgment. Proof it was real: both engines independently flagged the same two pauses, which means Gemini is listening to the audio, not paraphrasing the transcript. Build note that fell out of it: real pause detection must exclude spans where the *other* diarized speaker is talking (Scribe flagged a 12s "pause" that was actually the interviewer's turn; Gemini correctly ignored it). Source-of-truth split: numbers from Scribe (tighter), judgment from Gemini.

**Decisions / alternatives considered.**
- **ElevenLabs** for the live voice layer (real-time, server-minted signed URLs, per-call overrides, browser-direct). Predates this window; not re-litigated.
- **Three-LLM A/B kept, not yet collapsed.** Whether to keep all three evaluators or collapse to one + the delivery report is deliberately undecided until they can be compared head-to-head on the upgraded rubric.
- **Hume AI rejected** as the emotion engine: it sunsets 2026-06-14. Don't build on it.
- **Gemini billing wrinkle:** the free tier 503'd and 429'd ("prepayment credits depleted"); after a ~$10 top-up, `gemini-2.5-pro` verified working and set as `GEMINI_MODEL` on Railway. Keep the model-fallback + backoff chain even on paid (it still 503s under load).

**Deferred (the main remaining build).** The server-side delivery endpoint (fetch audio by conversation_id → Scribe metrics → Gemini tone → synthesized report → cache + show on the results page) is NOT built; design in `docs/specs/dev-31-voice-delivery-analysis.md`. The pause-detection turn-boundary fix must land in that build. The new interviewer personas (PR #100) are live but untested by ear and need a listen-through to tune.

**Monetization fit.** Headline Pro feature ($20/mo Pro; 30 voice minutes included, paid add-on minutes, a BYOK option) under DEV-22. The delivery/tone report (DEV-31) is positioned as the v1 differentiator and the real moat.

---

## 2026-05-28 — Auth hardening: HS256 → JWKS / ES256 JWT verification (PR #93, #94)

**What changed.** Supabase migrated this project off the legacy HS256 shared secret; tokens are now ES256 (asymmetric). The backend was still pinned to HS256 only, so every JWT verification *failed* and fell through to a ~150ms network round-trip per authenticated request. Found by poking around Railway logs, not by an alert. Fix: verify with the `jose` library + `createRemoteJWKSet` against Supabase's published keys, keep the network call as a defense-in-depth fallback, and add a boot-time probe that surfaces a misconfig early. PR #94 added a PostHog `auth.jwt_verify_path` event so the fast-vs-fallback split is finally visible.

**Why it stayed silent.** Same family as DEV-27: Sentry warnings with no alert rule sit unread, the fallback hid all user-facing impact, and there was no telemetry on the verify path. A correctness-and-latency regression on every authed request, invisible until someone read the logs by hand. The recurring lesson: a "graceful" fallback that masks a failure is indistinguishable from health.

---

## 2026-05-29 — Daily-email reliability: failure detection + send-count tripwire + pagination (DEV-34 / 35 / 36)

A wave of hardening on the email pipeline, triggered by a second silent email-disappearance.

**The recurrence (PR #97).** `sendPerUserAlerts` read `user_subscriptions` with an unbounded select, which PostgREST silently caps at 1000 rows, dropping ~43% of subscribers (the most recent signups) from the daily email. Same failure *class* as the 2026-05-20 `listUsers perPage=50` bug (Phase 23 / journey), different code path. Fixed with range-pagination.

**Failure detection (PR #102, DEV-35).** The Resend SDK returns API errors (401 rotated key, 429 rate limit, 422 validation) inside `{data, error}` and does NOT throw. `sendBatchAlerts` did `sent += batch.length` on any non-throw, so up to 100 non-delivered emails per batch were counted as "sent" and the catch never fired. Now it branches on `error`: failures count as failed, push to an errors array, and `Sentry.captureException`; single-sends throw so callers see the failure.

**The tripwire (PR #103, DEV-34).** The alarm so an outage can't hide for weeks again. Two gaps had let the 1000-row truncation survive: a swallowed throw left the result as `{sent:0}` and the admin digest self-suppresses on quiet non-Monday days, so a total outage looked identical to a slow day; and nothing compared *eligible subscribers* to *emails actually built*. Now the crash path captures to Sentry and forces the digest; every run logs `{eligibleSubscribed, payloadsBuilt, companiesWithNewJobs}`; and if 25 or more eligible subscribers produce zero emails on a day companies DID post new jobs, it fires `Sentry.captureMessage` and forces the admin digest. Had it been live, the 36-user outage would have tripped on day one.

**Pagination, generalized (PR #101, DEV-36).** The weekly-digest surge baseline read `seen_jobs` with two unbounded selects; the prior-4-week window already runs ~992 rows and crosses 1000 routinely, so flat companies were being reported as "surging" in the Friday LinkedIn draft. Extracted a shared `fetchAllRows.ts` helper (the 4th site to need pagination). DEV-36 stays open for the remaining latent unbounded selects (`/api/jobs`, the recommendation pool, company dropdowns) plus a CI grep guard.

**Theme.** Three of these four are the same lesson the log keeps relearning: a silent cap or a swallowed error makes "broken" look exactly like "healthy." The tripwire is the structural answer — stop trusting "no error" and start asserting that the expected work actually happened.

---

## 2026-05-29 — Onboarding: pre-check 5 starter companies for brand-new users (PR #99)

24 users had signed in but tracked zero companies. With nothing tracked they get no daily email and can hit the Add-Company modal trap (DEV-16), so they bounce having gotten zero value. Now a user with zero subscriptions opens the modal to find five companies pre-checked: Google, Anthropic, OpenAI, Stripe, Capital One (Amazon deliberately excluded as a listing firehose). It's opt-in and reversible — nothing is subscribed until they click "Add Selected," and they can uncheck any of them. Existing users (subscriptions > 0) see the empty modal as before. The five names are matched against the live catalog, so an unmatched name is simply skipped rather than erroring.

---

## 2026-05-29 — DEV-27: Sentry observability blindness + doc-cadence reset

> **Doc-cadence note:** This log lapsed 2026-05-23 → 2026-05-28. Those sessions captured to the external auto-memory dir (`MEMORY.md`) and Linear instead of committing here, because these two root docs sit on branch-protected `main` and need a PR, which recent sessions skipped. PRs #55-#100 (auth JWKS migration, interview voice work, onboarding pre-check, the daily-email 1000-row pagination fix, etc.) — the substantive ones are now back-filled in the entries immediately above (the 2026-05-25 → 2026-05-29 wave, added 2026-05-29 during the docs reconciliation); the rest are summarized in MEMORY.md + Linear. Resuming the in-repo log with this entry.

**What changed.** Fixed DEV-27 (Sentry alert for `phase:auth-fallback` never emailing) and discovered the root cause was far deeper than the ticket: **backend Sentry had been a silent no-op since it was added 2026-02-11 (commit 67e92be), ~3.5 months blind**, because `SENTRY_DSN` was never set on Railway and `Sentry.init({dsn:undefined})` no-ops by design. Three instances of the same truncated/missing-key bug were found and fixed: backend `SENTRY_DSN` (a dashboard re-add truncated it to `.../4510870`, a valid-looking but nonexistent project; fixed via CLI to the full 95-char value), backend `POSTHOG_API_KEY` (entirely missing, so `capturePosthogEvent` from PR #94 was also no-oping; set from the project's publishable key), and frontend `NEXT_PUBLIC_SENTRY_DSN` on Vercel (truncated; fixed across all envs + `vercel redeploy`).

Shipped a liveness probe (`backend/src/lib/sentryHealth.ts`, content landed on main via PR #97 — branch entanglement carried it, so the dedicated PR #96 was closed as an empty diff). It POSTs a synthetic event to the Sentry ingest endpoint and checks acceptance at boot (`index.ts`) and daily (`dailyCheck.ts`); on failure it emails admin + emits PostHog `observability.sentry_unhealthy`, deliberately not via Sentry. Added `backend/.env.example` (the missing documentation), gotchas in CLAUDE.md + JOBS.md, and a `sendAdminEmail()` helper.

**Caught a second bug in the fix itself.** The probe guards used `process.env.NODE_ENV === "production"`, but `NODE_ENV` was never set on Railway, so the probes (and auth.ts's own fail-closed JWKS safety nets) were dead code in prod. Root-fixed by setting `NODE_ENV=production` on Railway after auditing every backend `NODE_ENV` usage for blast radius (all safe: Sentry tags already default to "production"; auth.ts fail-closed won't throw because `jwksUrl` is set; the JWKS boot probe simply activates).

**Decisions / alternatives considered.**
- **Probe technique:** ingest-endpoint POST + HTTP-status check (no extra credential needed) chosen over (a) a heartbeat verified via the Sentry API (needs an auth token) and (b) a mere "is the var set" check (would miss a truncated-but-well-formed DSN — exactly today's bug). Verified against live ingest across all 4 states; the truncated case returns HTTP 403 `with_reason: ProjectId`.
- **Alert channel:** admin email + PostHog, never Sentry (it can't report its own outage).
- **NODE_ENV root-fix vs scoped guard:** chose to set `NODE_ENV=production` (one var, also re-arms auth.ts's dormant safety nets) over changing the guard to `RAILWAY_ENVIRONMENT_NAME`. Follow-up noted: making the probe guard depend on the auto-injected `RAILWAY_ENVIRONMENT_NAME` would be more robust than a manually-set `NODE_ENV` (which could be silently cleared — the same failure class this work is about).

**The meta-lesson (why nothing caught it for 3.5 months):** we had monitoring but nothing monitored the monitoring. Every guardrail checks a different layer (code diffs, auth config, scraper DB); none pushed an event through Sentry to confirm receipt. And silent-failure observability makes "broken" indistinguishable from "healthy" — an empty dashboard reads as good news. Same class as the recurring "absence of bad signal looks like good signal" failures (Phases 15/21/25).

---

## 2026-05-29 (later) — Parallel-session cleanup + docs reconciliation

**Context.** Ran four Claude Code sessions in parallel through the evening (feature dev, a workflow/docs session, the DEV-27 observability fix, and the daily-email work). By night's end there were four open PRs, a diverged local `main`, an uncommitted journey-doc edit, and four session windows each proposing a different cleanup plan. A fifth session reconciled it, verifying ground truth before touching anything.

**What was verified (read-only) — because the windows disagreed:**
- **The "DEV-27 code is unmerged" alarm was false.** The Sentry liveness code (`backend/src/lib/sentryHealth.ts` + wiring in `index.ts`/`dailyCheck.ts`/`email/sendAlert.ts` + `.env.example`) IS live on `main`, squash-merged via PR #97 (commit `badafe6`). The "orphan branch with 3 unmerged commits" one window flagged was a squash-merge artifact: byte-identical content, different SHAs (proven by an empty `git diff main:file branch:file`). Nothing to rescue.
- **`main` is governed by a repository ruleset (id 16381419), not classic branch protection.** It requires a PR but needs **0 approving reviews** to merge — so direct pushes are blocked, but `gh pr merge` works without a human approver. The "user merges via GitHub" line in CLAUDE.md is a convention, not a technical gate.
- **A real Phase-25 collision:** PR #68's journey entry and an uncommitted working-tree journey edit both claimed "Phase 25." #68 = the auth-lockout incident (2026-05-22→25); the uncommitted edit = the auto-verify-zeros + auth-alert work (2026-05-28). Resolved chronologically: #68 stays Phase 25, the auto-verify-zeros entry becomes Phase 26.

**What was done.**
- Merged **PR #98** (`0cfe46a` — remove stale zombie jobs after 2 healthy-zero days; the one outstanding code fix, CI green on Railway + Vercel, migration already applied to prod).
- Closed **PR #4** (15-day-old zero-jobs diagnostic; stale, conflicting, its plan long since executed via PR #90).
- Merged **PR #68** (`50a0254` — auth-incident Phase 25 + CLAUDE.md CI/feedback sections + project-history block).
- Folded **PR #104**'s DEV-27 history entry (the section directly above) into this consolidation PR and closed #104 — it could not merge alongside #68 without a project-history append conflict, so its content was reproduced verbatim here to preserve chronological order.
- Landed the renumbered **journey Phase 26** (the auto-verify-zeros / admin-loop story) that had been sitting uncommitted in the working tree, never branched.

**Lessons.**
- **Parallel sessions converge on facts but diverge on framing.** Four sessions surveying the same repo produced four different option menus; the divergence was entirely in recommendation, not in the underlying git state. When sessions disagree, re-derive ground truth from git/`gh` rather than trusting any one session's summary — and watch for false alarms born of git artifacts.
- **Squash-merges make a fully-merged branch look unmerged.** `git log origin/main..branch` lists commits that exist only as distinct SHAs even though the content is already on main. Confirm with a content diff before concluding work is orphaned.
- **The savecc trap is real.** The journey Phase 26 work was complete and even written, but never committed, because the in-repo docs need a PR and prior sessions stopped at the external memory dir. Capturing it required a deliberate consolidation pass.

**PRs this pass:** merged #98, #68, and this consolidation PR; closed #4 and #104 (folded).

---

## 2026-05-30 — Reliability + observability hardening wave (Linear backlog burndown)

**Context.** With the parallel-session PR mess cleared and zero open PRs, worked the remaining engineering backlog in one sitting. These are not user-facing features — they're the "make the silent failures loud" follow-ups that the DEV-27 observability incident and the 2026-05-29 zombie-job sweep had each spun off as tickets. Implemented in parallel isolated worktrees via a workflow, each independently code-reviewed before merge.

**What changed (one backend PR + one frontend PR + a DB repoint):**

- **DEV-47 — prod guards moved off `NODE_ENV`.** The Sentry boot/daily liveness probes and `auth.ts`'s fail-closed + JWKS boot probe were gated on `process.env.NODE_ENV === "production"`, but `NODE_ENV` had sat unset on Railway for months (the root cause behind DEV-27 staying invisible). Re-gated all three on `RAILWAY_ENVIRONMENT_NAME === "production"`, which Railway auto-injects and can't be silently cleared. Added a boot log of the resolved value so a future env rename surfaces in deploy logs in under a minute. `NODE_ENV` now only feeds the Sentry `environment` label. Verified `RAILWAY_ENVIRONMENT_NAME=production` on the live service before merge.
- **DEV-36 — paginated the last unbounded reads in the cron.** Four PostgREST selects in `dailyCheck.ts` (per-company seen_jobs history, and the three recommendation-pool queries) had no row cap and would silently truncate at 1000 — the same footgun that dropped 43% of subscribers from the daily email earlier in the week. Routed them through the existing `fetchAllRows` helper; re-sorted the recommendation pool in Node since id-keyed paging drops the most-recent-first order the picker depends on.
- **DEV-37 — checked the ignored DB writes.** ~12 supabase writes/updates/deletes/counts in the cron ignored their returned `{ error }`. Added a `reportWriteError` helper (logs + Sentry, never throws) on each, so a write that silently fails — e.g. the active-job count that, if null, would falsely flag a company as zero-PM and trip auto-disable — is now visible.
- **DEV-38 — surfaced silent-zero and low-quality scrapes.** A scrape that returns 0 jobs from a reachable source (especially a company that had jobs yesterday) or a far-below-normal quality score now emits a Sentry warning instead of passing as "success." This is the silent-scraper-break signal that previously only showed up days later as an auto-verified-zero.
- **DEV-40 — made swallowed failures observable.** Several catch blocks (weekly digest, comp refresh, recommendation-history write, admin digest, the backend PostHog capture helper) only `console.error`'d. Added Sentry capture. The PostHog capture path — which fires on every authed request — is throttled to one report per 5 minutes and fingerprinted, so a dead analytics pipeline produces one dedupable issue rather than flooding Sentry and burying real errors.
- **DEV-33 — stale-removal now covers keyword-search scrapers.** The 2026-05-29 anti-flap removal only worked for full-board scrapers (a 0 `totalScanned` proved the source was reachable). Keyword-search/DOM scrapers (amazon, icims-api, oracle_hcm, intuit) always report `totalScanned = 0`, so their delisted "zombie" jobs lingered forever. Added `sourceReachable` to `ScrapeStats`, set after a successful HTTP 200 (these scrapers throw on non-ok, so it's only ever set on a real success), and made the cron's `sourceHealthy = totalScanned > 0 || sourceReachable === true`. Both signals are reset before the broad-ATS-discovery re-scrape so a stale flag can't green-light removal. This is the one piece that changes behavior on live data — flagged for an eye on the first cron run.
- **DEV-39 — frontend Sentry liveness probe.** Backported the backend's ingest-probe pattern to the Next.js server runtime (`frontend/src/lib/sentryHealth.ts`, fired from `instrumentation.ts` at Vercel server boot). Catches the missing/truncated/wrong-project DSN class the SDK swallows. Alerts via PostHog (no admin email — Vercel has no Resend wiring). `NEXT_PUBLIC_SENTRY_DSN` (the one truncated in DEV-27) is required and alerts on any problem; `SENTRY_DSN` is probed only when set, to avoid a standing false alarm. Healthy path is console-only since `register()` runs on every cold start.
- **DEV-32 — Plaid repointed Lever → Ashby.** Plaid migrated its board off Lever months ago; the Lever API still 200'd empty, so the scraper reported "success" while returning 0 PMs and 20 subscribers saw stale Feb listings. Repointed to the Ashby board (`jobs.ashbyhq.com/plaid`, confirmed ~5 US PM roles survive the pipeline) and flushed the orphaned Lever-era `seen_jobs` rows (verified safe: 0 user favorites on them).

**Decisions / alternatives considered.**
- **`RAILWAY_ENVIRONMENT_NAME` over re-setting `NODE_ENV`:** the earlier DEV-27 fix set `NODE_ENV=production` as a one-var root-fix, but explicitly noted the more robust move was an auto-injected var. DEV-47 is that move — a manually-set guard variable is the same failure class the guard exists to catch.
- **Throttle the PostHog→Sentry report rather than drop it:** the DEV-40 goal is visibility, but per-request capture on a dead pipeline is anti-visibility (quota burn + buried errors). Once-per-5-min + fingerprint keeps one signal.
- **Optional `SENTRY_DSN` probe on the frontend:** treating a legitimately-unset server DSN as "unhealthy" would train us to ignore the alert. Required vs optional per-DSN keeps the alert trustworthy.
- **Bundled all doc updates into the backend PR** (this entry + the CLAUDE.md guard/Sentry gotchas + JOBS.md/SCRAPER.md `sourceReachable` notes) so the two PRs don't collide on shared files.

**Lessons.** The whole wave is one theme: *a guard, a write, or a scrape that fails silently is worse than one that fails loudly, because silence reads as health.* Every ticket here replaces a silent path with a loud one — and the meta-trap (DEV-47) was that even the loud paths had been silently disabled by an unset env var. The new boot log exists so that can't happen invisibly again.

---

## 2026-05-30 (later) — DEV-41: daily self-check becomes a parallel, self-verifying workflow

**Context.** The daily self-check agent walked the suspect companies serially, one `scraper-doctor` at a time, single perspective. That shape mislabeled delisted companies as "healthy" for weeks — it's what let the 2026-05-29 zombie-job bug hide. A manual parallel sweep with an adversarial refute step is what finally caught it. DEV-41 makes that shape permanent.

**What changed.** New committed workflow `.claude/workflows/daily-self-check.js`: `pipeline(suspects, diagnose, adversarialVerify)`. Each suspect gets a `scraper-doctor` diagnosis that hits the live ATS board itself, then a second independent `scraper-doctor` that tries to *refute* the diagnosis in both directions (prove a "broken" verdict is a false alarm; prove a "healthy" verdict is secretly broken). Only diagnoses that survive as a real, subscriber-affecting, fixable problem are reported; empty list = no email, preserving "email only if actionable." Capped at 20 suspects with overflow reported, never silently dropped. Had to un-ignore `.claude/workflows/` in `.gitignore` (the dir was excluded) so the workflow versions and reaches the remote routine.

**Suspect scoping.** The key correction: the raw "looks off" filter matched 79 companies, but 67 were auto-managed `is_verified_zero` (known-zero, already handled) — not real suspects. Excluding those gives ~12 true suspects, which is the right fan-out size. The suspect query lives in the trigger, documented in JOBS.md.

**Validated on 3 live suspects** (Plaid, Slack, Cloudflare). All three correctly cleared as false alarms (0 actionable → no email): Plaid's repoint confirmed working (verifier independently found 5 live US PM roles on the Ashby board), Slack and Cloudflare confirmed genuinely 0-PM from healthy boards. Cost ~83k tokens/company, so ~1M for a full ~12-company run — in the approved band. Useful side finding: today's 12 suspects are all the stale `quality: 0/100` label that PR #98 retired but hadn't overwritten yet (it merged the day before); the 14:00 cron clears them, so the daily suspect set shrinks toward zero on its own.

**Decisions.** Trigger = daily auto-run (~14:30 UTC remote routine), chosen by Vik over a session-start sweep or on-demand, because the watchdog's whole value is catching breakage while he's away; the scoped suspect set + sonnet `scraper-doctor` agents keep it bounded. Workflow kept as a pure pipeline (suspects passed in by the trigger) rather than self-fetching, so the DB query stays in one place.

**Note:** DEV-45 (voice delivery-analysis endpoint) is Vik's own build, not a Claude task — independent of this.

**Trigger wiring (same day).** Discovered while setting it up: scheduled remote agents (the `/schedule` skill / `RemoteTrigger`) run in Anthropic's cloud with a git checkout but **no Supabase MCP and no local secrets** (the only attachable connectors are the user's claude.ai ones — Granola, Gamma). So the routine can't query the `companies` table directly. Closed the gap with a small CRON_SECRET-gated endpoint `GET /api/cron/self-check-suspects` (in `index.ts`, mirrors `/api/cron/trigger` + `safeCompareSecret`, paginated via `fetchAllRows` since the catalog is growing toward 1000): it returns today's suspect set as JSON. The daily 14:30 UTC routine curls it, passes the suspects to the `daily-self-check` workflow, and surfaces the confirmed report. The CRON_SECRET lives in the routine's prompt (stored in Vik's own cloud account — no env/secret-injection field exists for routines). Same constant-time auth surface as the existing cron endpoints.

---

## 2026-05-30 (later) — DEV-43: weekly digest rotating "My take" lead + Hot Take banner

**Context.** The weekly LinkedIn digest opened with a hardcoded `**Banking is on a tear.**` every Friday — only the percentage was dynamic. Worse, "banking on a tear" was usually an artifact of catalog onboarding: a bulk-add of banks lands their existing openings as "new" that week, so the recurring headline was the data pipeline talking, not the market.

**What changed.** The lead now rotates. `buildLeadCandidates()` computes this-week SNAPSHOT angles only (AI share, top company, big-tech concentration, top pay, top city, seniority) — deliberately no week-over-week trend claims, which on this data are onboarding-contaminated. Code picks the lead by priority + a freshness rule (`weekly_lead_history`, last 2 weeks excluded); the LLM only PHRASES it in Vik's voice. `weeklyLeadWriter.ts` injects Vik's voice guide + calibration samples VERBATIM (bundled as `vikVoiceFull.ts` since repo-root `docs/Viks Voice/` isn't in the backend deploy), Opus by default (`WEEKLY_DIGEST_MODEL`), prompt-cached, deterministic fallback if the key/parse/API is unavailable. The post was restructured to the "hot take" format: dated volume opener, `My take this week:`, a numbered stats block with @-tagged companies, CTA — plain text (Vik bolds in AuthoredUp), no em/en dashes. A rotating-style "Hot Take" banner (`weeklyDigestImage.ts`, nano banana) is generated and attached when Gemini is reachable; the text prompt is always included so Vik can regenerate free via his consumer plan. Cost footer on each send. New table `weekly_lead_history` (migration applied to prod).

**Verified.** tsc green; change-reviewer no blockers (fixed its one finding — the AI "1 in N" ratio no longer floors at 2, so it can't misstate a high AI share). Ran `computeWeeklyDigest` and a real `sendWeeklyDigest` against prod via `railway run`: the Opus call works, prompt caching works, the lead rotated to AI, the post renders, and a real test email landed in Vik's inbox.

**Decisions / alternatives.**
- **Snapshots, not trends, for the lead.** A multi-agent analysis against the live DB showed the "obvious" fix (lead with the biggest week-over-week mover) would just relabel the onboarding artifact ("Biotech exploded 36x" off a 0→18 bulk-add). Within-week snapshots are immune to that. Trend angles deferred until the catalog stops moving.
- **Code selects, LLM phrases.** Keeps the angle choice deterministic + freshness-controlled and removes the model's ability to pick a contaminated or repeated angle; the model only does the thing it's good at (voice).
- **Voice files injected verbatim, not summarized.** Multiple rounds of drafts came out as generic LinkedIn slop while the model was fed a paraphrase; only injecting the actual files fixed it. The build bundles them into the deploy rather than reading repo-root docs/.
- **Single LLM call + human gate.** No critic/refine pass in v1 (the build-proof run used one); the email goes only to Vik, who reviews before posting. Add the critic if voice drifts.

**Lesson.** Two. (1) Your own data pipeline can manufacture a fake trend that reads exactly like insight — the headline I'd repeated for weeks was my catalog growth, not the market, and I only checked because the repetition annoyed me. (2) "Read the voice guide" is not "use the voice guide": even the AI building the feature silently substituted its own summary until the real files were structurally injected into the prompt.

---

## 2026-05-30 — Pre-Stripe system audit (read-only) and the fix wave it triggered

**Context.** Before adding payments (Stripe) and the voice feature — both of which widen the attack and data surface — ran a deliberate read-only end-to-end audit of the live system: scraping, security headers, auth, cross-user data isolation, RLS, and app-layer performance. The ask was a plain-language findings report first, not fixes-in-flight (Vik was AFK and wanted to read it before any change). Report lives at repo-root `auditreportMay30.md` (kept local, not committed). The audit confirmed the system was fundamentally sound but surfaced a tier of "silent failure" gaps — same theme as the hardening wave — plus two genuinely scary ones. The fixes then shipped as a series of independently change-reviewed, CI-gated PRs:

- **#115 — dependency health.** Next.js 16.2.6 security bump; committed a Dependabot config (it had been opening ungrouped PRs).
- **#116 — the last truncation reads.** A repo-wide sweep for unbounded PostgREST selects (the 1000-row silent-cap class that had already dropped 43% of subscribers from one daily email). Routed the remaining ones through `fetchAllRows`; added a CI guard that fails the build on a new unbounded `.select()` against a growing table. An exhaustive re-sweep found zero stragglers.
- **#123 — cron correctness + stop fighting blockers.** Fixed an N+1 in the Monday weekly-digest path (pre-fetch the weekly snapshot once). Turned OFF the puppeteer-extra-stealth tier aimed at Meta/Tesla/TikTok/Wayfair — it was ~0 yield and the one piece of real DMCA-1201 / post-block legal exposure the scraping-legality review (DEV-30) had flagged. Fixed an iCIMS "zombie jobs" bug where the scraper could over-remove live roles: `page.goto` doesn't throw on a 4xx/5xx, so `sourceReachable` is now gated on `gotoResp.ok()` — a non-200 no longer counts as "source confirmed empty, safe to delist."

**Decisions / alternatives.**
- **Report first, fix second.** Vik explicitly wanted a read-only overhaul he could read while AFK before any change. Kept the audit and the fixes as separate phases so the findings weren't contaminated by in-flight edits.
- **Stop the stealth arms race rather than escalate it.** Heavier anti-detection loses on both axes (still ~0 yield against these four, highest legal-exposure surface). Retiring it and sourcing those employers legitimately (see the scraping-blocked entry below) is cheaper and safer.

**Lesson.** The audit's recurring finding was the same sentence as the weekly-digest lesson and the hardening wave: *silence reads as health.* The two scary ones — an email path that could silently drop recipients, and two tables readable by the anon key — were both invisible-until-exploited, which is why they got dedicated fixes below.

---

## 2026-05-30 — DEV-49: email defense-in-depth so recipients can't silently drop at scale (#128)

**Context.** The scariest audit finding, and the one Vik flagged as "the biggest issue": earlier in the week a single unbounded query had silently dropped 43% of subscribers from a daily email (PostgREST's 1000-row cap), and nothing noticed until a user did. The #116 sweep fixed the *known* truncation reads, but Vik wanted structural insurance — "a backup, and a backup for the backup" — so no future bug (truncation or otherwise) can quietly send to fewer people than it should.

**What changed — six layers in `dailyCheck.ts`, from "can't happen" to "we'd know within a day":**
- **L1 / L2 — paginate the inputs.** `user_subscriptions` and `user_preferences` both read through `fetchAllRows`, so the recipient list can't be truncated at the source (the original bug class).
- **L3 — wipeout tripwire.** If the build produces *zero* email payloads on a day that has eligible subscribers, alert immediately, before sending. (First written as a partial-drop *ratio* — payloads < 90% of eligible — which change-reviewer correctly flagged as a daily false-positive: "built" (users with a new job today) is naturally far below "eligible" (all subscribers). Narrowed to wipeout-only; partial-drop detection moved to L5 on a stable metric.)
- **L4 — built-vs-sent reconciliation.** After the send loop, compare payloads built against sends attempted; a gap means the loop dropped someone mid-flight — surfaced, not swallowed.
- **L5 — daily baseline.** New `email_send_log` table records, per run, the day's eligible / built / sent counts. `checkEmailBaseline` compares today's `eligible` against the recent trend and alerts on an unexplained drop. `eligible` is the right metric because it's stable day-to-day (unlike "built," which swings with how many companies posted), so a real drop in reachable subscribers stands out.
- **L6 — history.** The log is durable, so the baseline has something to compare against and the trend is auditable.

**Verified.** tsc green; change-reviewer no blockers after the L3 fix; `email_send_log` confirmed RLS-on in prod.

**Lesson.** Defense-in-depth means layering checks at *different altitudes*: prevent the known cause (paginate), catch the catastrophic case before sending (wipeout), reconcile the actual send (built-vs-sent), and detect slow erosion after the fact (baseline). A single check at one layer is what let the original 43% drop hide.

---

## 2026-05-30 — RLS backfill + a guard so a new table can't ship without it (#129)

**Context.** The audit's data-isolation pass found two tables readable by the Supabase anon key: `weekly_lead_history` (low-sensitivity) and `help_submissions` (user-submitted PII from the legacy feedback flow). The backend uses the service-role key (which bypasses RLS), so these were invisible in normal operation — but the anon key ships to the browser, so the rows were technically reachable.

**What changed.** Migrations enable RLS on both (and audited all 14 tables — the rest were already covered). Added a CI audit guard that fails the build when a new table is created without an RLS policy, so this can't recur silently. Tamed Dependabot in the same PR — it had been opening ~9 ungrouped PRs per run; now one grouped PR per ecosystem per week.

**Lesson.** "The backend uses the service key so RLS doesn't matter" is true right up until the anon key touches the same table — RLS-by-default plus a CI guard is cheaper than auditing it by hand each time.

---

## 2026-05-30 — "Scraping blocked": telling users the truth, and the decision to license the data (#130 / #133 / #134)

**Context.** Four employers — Meta, Tesla, TikTok, Wayfair — actively block automated access to their careers sites. The scraper returned 0 for them, so the UI showed "0 roles," which reads as "this company has no PM openings" — false, and it makes the product look broken. #123 had already turned off the futile stealth arms race against them; this is the user-facing half.

**What changed.** New `companies.scrape_blocked` flag (set true for those four). Everywhere a company's role count shows — the catalog, dashboard cards, the company page, the job feed — a blocked company now shows a **"Scraping blocked"** badge with a tooltip explaining the employer blocks scraping and to apply on their site directly, instead of a misleading "0 roles." In the Add-Companies catalog they're non-selectable (you can't track what we can't pull); anyone already tracking one keeps it (not auto-removed). The label went through a naming jam — Restricted (implied *we* restrict it) → Unlisted → Apply Direct → "Scraping blocked," which Vik picked because the audience is technical and the word is honest about whose decision it is.

**The strategic decision (next-session build).** Rather than escalate the bot-detection fight, license the roles from a third-party jobs-data API (Fantastic.jobs on RapidAPI — both the LinkedIn and ATS feeds, now subscribed; key `RAPIDAPI_KEY` on Railway). Once wired, the four blocked employers get real jobs back and the badge disappears. Captured as a handoff for a fresh session.

**Lesson.** When the system can't do something, say so plainly in the UI — a misleading "0" costs more trust than an honest "we can't see this one." And when a fight is unwinnable and low-value (stealth vs. these four), buy the data instead of escalating the arms race.

---

## 2026-05-31 — Catalog expansion to 519, add-by-category UI, scrape-on-demand, and a process lesson

**Context.** A long session aimed at growing the catalog toward 1,000 and clearing the engineering follow-ups before pivoting to voice/UI/Stripe. Linear: DEV-52 (scrape-on-demand), DEV-53 (this record); DEV-51 (RapidAPI) remains due July 1.

**What shipped (all merged):**
- **Catalog 247 → 519.** 87 vetted companies (catalog-scout) + 185 from a Levels.fyi top-1500 detection pass — Levels publishes a public 33.8k-company roster at `/js/companyList.json` (their jobs feed is NOT openly accessible; only the company list is), which became the discovery backbone. Detection fanned out via the Workflow tool (board-verification required after the first pass shipped some wrong greenhouse tokens). Configs were then verified + recovered: re-derived real greenhouse boards (Grafana→grafanalabs, Gong→gongio, etc.), nulled genuinely-broken ones so they auto-detect. **Important nuance:** inserting a company does NOT populate its jobs — that happens on the 14:00 UTC cron or via the new scrape-only endpoint.
- **#139 scrape-on-demand (DEV-52)** — `POST /api/cron/scrape-only` (CRON_SECRET-gated) extracts the per-company scrape + seen_jobs upsert into a shared `scrapeAndRecordCompany()` (verbatim relocation, independently reviewed) and runs it with NO email-distribution step. Decouples scraping from emailing so a freshly-added company can be backfilled immediately instead of waiting for the daily cron.
- **#140 add-by-category UI** — `companies.sub_industry` migration; catalog grouped by industry with **tech split into AI / Dev Tools / SaaS / Big Tech / Security / Consumer apps** (226/229 tagged; Big Tech limited to the 5 giants); "Add all in {category}" delta button (only adds untracked, skips scraping-blocked).
- **#138 + #141 Sentry noise** — stopped reporting routine JWT expiries and *expected* scrape failures (board-not-found, source-unreachable) at error level; they're warnings now (visible, no high-priority email). Same "silence the expected, surface the real" pattern. Also: Dependabot now ignores puppeteer* (Docker-pinned; closed the unsafe #137 bump).

**Lesson (process, on me).** These shipped via **manual git** (branch → commit → PR → merge), NOT the `/ship` command — so the savecc-on-ship discipline (`/ship` bundles the project-history entry + CLAUDE.md/sidecar currency into the PR, then updates MEMORY + Linear) was silently skipped, and the docs + Linear lagged a full session until the user caught it. The manual fast-path re-introduced exactly the drift `/ship` was built to prevent. Fix: use `/ship` (or run its full doc+Linear discipline) for every change — the catch-up (this entry, the CLAUDE.md endpoint, DEV-52→Done, DEV-53) is this PR.

---

## 2026-05-31 — Weekly LinkedIn digest: @-tag the lead, copyable post block, spottable subject

Three small fixes to the Friday weekly-digest email, all from real use:

1. **@-tag every company in the lead.** The structured sections (top-10, AI roles) always @-tagged company names, but the Claude-written "My take this week" lead is free text and mentioned companies without the `@`, so the user was hand-adding them each week before posting. New `tagCompanyMentions()` helper @-prefixes any company name (from the week's top-companies + AI-companies set) wherever it appears in the lead. Guards: longest-name-first (so "American Express" tags before "American"), word boundaries (won't tag inside "Metadata"), no-double-`@`, and case-sensitive (won't tag the lowercase word "adobe"). Verified against the real lead + edge cases.
2. **Copyable post block.** The post sat in a `<br/>`-in-a-`div` that collapsed to a single line when pasted into LinkedIn. Switched to a `<pre>` with real newlines + `font-family:inherit` — the plain-text clipboard flavor now preserves line breaks, so it pastes correctly without the Notepad round-trip.
3. **Spottable subject.** Prefixed the subject with `📬📬📬` (open mailbox with raised flag) so the weekly draft is findable at a glance in the inbox.

Behavior-only; the lead engine, data window, and image pipeline are unchanged.

---

## 2026-05-31 — RapidAPI auto-restore for the scraping-blocked employers (DEV-51), date-gated to fire itself

**Context.** Four employers (Meta, Tesla, TikTok, Wayfair) hard-block automated scraping, so they carry `scrape_blocked=true` and show a "Scraping blocked" badge instead of jobs. The plan (from the 2026-05-30 honest-badge work) was to buy their roles back via the Fantastic.jobs RapidAPI LinkedIn feed instead of escalating a stealth arms race. The wrinkle: the free RapidAPI quota was already exhausted this month, so the integration **cannot be live-tested until the quota resets on July 1.**

**What shipped.** `backend/src/scraper/rapidApiBlocked.ts`: `pullRapidApiBlockedEmployers()` queries every `scrape_blocked=true` company, pulls its US Product Manager roles from the LinkedIn feed, runs them through the same PM-keyword + US-location filter as every other scraper, and **inserts/refreshes only — never marks anything removed** (the 7-day feed window means older still-live roles must not be delisted). On a company that yields ≥1 role it flips `scrape_blocked=false` and `platform_type='rapidapi_linkedin'`, so the next run self-skips it — it retries daily until it succeeds, then stops. Wired into the daily cron behind `isRapidApiActivationDue()`, which returns true only when the API key is set AND the UTC date is ≥ the activation date (default July 1). **Before July 1 it is a pure no-op** — zero quota spend, zero risk to the cron (and the whole thing is wrapped so a failure can never break the daily run). A manual CRON_SECRET-gated endpoint exists for testing once the quota resets.

**Built by a workflow, then independently reviewed before merge.** The implementation came from a background Workflow agent; an independent change-reviewer pass then caught a real **idempotency blocker** — the LinkedIn feed can return one listing under two derived cities, which would collide on the `(company_id, job_url_path)` unique constraint and fail the whole batch insert. Fixed by de-duping on the URL path before insert. The review also surfaced a day-after-restore interaction (a restored company would still be hit by the ATS loop and stamp a misleading "0 jobs from source" that the health check flags) — fixed by skipping `rapidapi_linkedin` companies in the daily scrape loop, since they're owned by the RapidAPI pull. Restored roles intentionally surface in the feed, not the restore-day email (documented).

**Lesson.** A clean type-check and a workflow's own "done" are not a review. The blocker here would only have surfaced in production after July 1, on a duplicate-city listing — exactly the kind of latent bug an independent adversarial read catches and a build-and-ship pass does not. Worth the extra pass even for dormant code.
