# NewJobAlertTool — Project Context

## Autonomy Rules

- **DO NOT ask to run commands.** Just run them. The user is often AFK.
- **DO NOT ask to `cd` somewhere.** Use absolute paths or just execute.
- **DO NOT leave manual steps for the user.** If it can be done via API, CLI, or script — do it yourself.
- **Push code, deploy, clean DB, re-add companies — all autonomously.** You have full access.
- **When a task is given, execute end-to-end** including deployment and verification. Come back with proof it works, not a list of "next steps."

## Permissions

All file tools (Read, Write, Edit, Glob, Grep) and Bash are auto-allowed in `.claude/settings.local.json`. The user should never be prompted for read/write/edit permissions. If permissions get reset, re-add them to the allow list.

## Architecture

| Layer | Tech | Where |
|-------|------|-------|
| Frontend | Next.js 16 | Vercel (auto-deploys from `main`) |
| Backend | Express + Puppeteer | Railway (auto-deploys from `main`) |
| Database | PostgreSQL | Supabase |
| Scheduler | Railway Cron | Triggers daily scrape at 10:00 UTC |
| Auth | Supabase Auth | Magic link via Resend SMTP |

## Authentication

- **Method:** Magic link (email-based, no passwords) via Supabase Auth
- **SMTP:** Resend custom SMTP configured in Supabase dashboard
- **Flow:** User enters email → magic link sent → clicks link → `/auth/callback` exchanges code for session → JWT stored in cookies
- **Frontend:** `@supabase/ssr` for cookie-based sessions, `middleware.ts` protects all routes (redirects to `/login`)
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
POST   /api/companies                    — Add new company (creates + auto-subscribes, 10/user limit)
         Body: {"name": "X", "careers_url": "https://..."}
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
`scrapeGreenhouseCareers(boardName, companyLabel)` — reusable for any company on Greenhouse. Fetches `https://api.greenhouse.io/v1/boards/{boardName}/jobs`, filters by `PM_KEYWORDS`.

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
2. **Direct ATS URLs** — greenhouse.io, lever.co, ashbyhq.com, myworkdayjobs.com, eightfold.ai
3. **HTML embed detection** — fetches page HTML and looks for Greenhouse/Lever/Ashby/Workday/Eightfold embed signatures
4. **Puppeteer fallback** — renders SPA and re-checks for embeds
5. **Generic** — falls back to Puppeteer scraper

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

- `backend/src/scraper/scraper.ts` — All scraper logic (Greenhouse, Lever, Ashby, Workday, Eightfold, custom APIs, generic Puppeteer)
- `backend/src/scraper/detectPlatform.ts` — ATS platform auto-detection engine
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
- `frontend/src/components/PostHogProvider.tsx` — PostHog init + SPA pageview tracking provider
- `frontend/sentry.client.config.ts` — Sentry browser-side init
- `frontend/sentry.server.config.ts` — Sentry server-side init
- `frontend/instrumentation.ts` — Next.js instrumentation hook for Sentry
- `backend/src/middleware/auth.ts` — JWT verification middleware (extracts userId + userEmail)
- `backend/src/index.ts` — Express server entry point
- `frontend/src/lib/supabase.ts` — Browser Supabase client (`@supabase/ssr`)
- `frontend/src/lib/api.ts` — Authenticated fetch wrapper (attaches JWT, caches token)
- `frontend/src/app/api/auth/token/route.ts` — Server-side route to extract JWT from HttpOnly cookies
- `frontend/src/app/login/page.tsx` — Magic link login page
- `frontend/src/app/auth/callback/route.ts` — Magic link code exchange
- `frontend/middleware.ts` — Route protection (redirects to /login if unauthenticated)
- `frontend/src/components/AuthNav.tsx` — User email + sign out in navbar
- `frontend/src/app/page.tsx` — Dashboard UI (tile grid + AddCompanyModal + onboarding)
- `frontend/src/app/add/page.tsx` — Redirects to `/?addCompany=true` (modal handles everything)
- `frontend/src/app/company/[id]/page.tsx` — Company detail page (with job status, saved inactive jobs)
- `frontend/src/app/jobs/page.tsx` — "View All Jobs" flat table (active jobs only)
- `frontend/src/app/settings/page.tsx` — Email preferences (daily/off)
- `frontend/src/app/layout.tsx` — Root layout with navbar + HelpButton
- `frontend/src/components/AddCompanyModal.tsx` — Two-path modal: catalog browse + new company submission
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
| `/login` | `login/page.tsx` | Magic link login (email input + send link) |
| `/auth/callback` | `auth/callback/route.ts` | Exchanges magic link code for session |
| `/` | `page.tsx` | Dashboard — tile grid of subscribed companies + AddCompanyModal |
| `/add` | `add/page.tsx` | Redirects to `/?addCompany=true` |
| `/company/[id]` | `company/[id]/page.tsx` | Company detail — active jobs + saved inactive section |
| `/jobs` | `jobs/page.tsx` | All Jobs — active jobs across subscribed companies |
| `/settings` | `settings/page.tsx` | Email preferences (daily / weekly / off) |
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
- **Sent from:** `alerts@newpmjobs.com` (via Resend API in `sendAlert.ts`)
- **Magic link emails:** Sent from `noreply@newpmjobs.com` (via Supabase custom SMTP → Resend)
- **Per-user logic:** `dailyCheck.ts` gets all users via `listUsers()`, checks `user_preferences.email_frequency`, filters alerts to subscriptions
- **Company logos:** Email includes Google favicon images for each company
- **Unsubscribe:** Footer links to `/settings` page where users can set email to "off"
- **API key:** Only in Railway production env vars (`RESEND_API_KEY`). Empty locally — cannot send from local.

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
| PostHog | Product analytics (pageviews, events, user identity) | Frontend only (`posthog-js`) |
| Sentry | Error monitoring + tracing | Frontend (`@sentry/nextjs`) + Backend (`@sentry/node`) |
| UptimeRobot/BetterUptime | Uptime monitoring | External SaaS, pings `/api/health` |

- **PostHog:** Initialized in `PostHogProvider.tsx`, SPA-aware pageview tracking via `usePathname()`, user identification on auth. Events: `company_added`, `company_deleted`, `job_starred`, `job_unstarred`, `dashboard_filter`.
- **Sentry:** DSN shared between frontend and backend. Frontend uses `withSentryConfig()` in `next.config.ts` + `instrumentation.ts`. Backend uses `Sentry.init()` + `Sentry.setupExpressErrorHandler(app)`.

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
- **Supabase redirect URLs:** Must include both `https://<your-domain>/auth/callback` AND `https://www.<your-domain>/auth/callback` due to Vercel's www redirect.
- **NEXT_PUBLIC_ env vars:** Baked at build time. After changing in Vercel, must trigger a redeploy for changes to take effect.
- **Cloudflare proxy (orange cloud):** Must be OFF (grey cloud / DNS only) for Vercel and Railway custom domains — they manage their own SSL.
- **Supabase SMTP location:** Dashboard → Authentication → Notifications → Email → SMTP Settings (not under "Project Settings").
- **Duplicate companies:** Name-based dedup is unreliable ("Open ai" vs "OpenAI"). Always validate by URL domain when adding companies. Extract domain from careers_url and check against existing companies.
- **Subscription N+1:** When subscribing to N companies, don't loop 2N sequential queries. Batch the subscriber_count update. Same pattern for unsubscribe.
- **Anon key for read queries:** The Supabase anon key works for tables with `USING (true)` SELECT policies (companies, seen_jobs). Useful for CLI debugging without a user JWT.
- **Local .env placeholders:** The local `backend/.env` has placeholder values for SUPABASE_SERVICE_KEY. Production keys are only on Railway. For local DB queries, use anon key against Supabase REST API with appropriate RLS policies.

## Multi-User Overhaul Status

The app was converted from single-user to multi-user in Feb 2026. Key changes:
- Companies are a shared catalog (one Uber entry, scraped once)
- Users subscribe via `user_subscriptions` to track companies
- Per-user email alerts based on subscriptions + preferences
- Old `favorites` table replaced by `user_job_favorites`
- Job status lifecycle: active → removed → archived (replaces hard delete)
- **Phase 6 cleanup ready:** `user_id` removed from companies INSERT. Run `scripts/phase6-cleanup.sql` in Supabase SQL Editor to drop old `favorites` table + `companies.user_id` column.
- **Admin email:** Extracted to `backend/src/lib/constants.ts` — reads `ADMIN_EMAIL` env var (Railway), falls back to `vik@viktoriousllc.com`
- **Admin dashboard:** `/admin` page (frontend) + `/api/admin/*` routes (backend). Access restricted to `ADMIN_EMAIL`.
- **Test account:** Use `test-account@example.com` (Gmail `+` alias → same inbox, separate Supabase user). Reset script at `scripts/reset-test-user.sql`.
- **Rate limiting:** General API: 100 req/15min. Write endpoints (POST /api/companies, /api/help): 20 req/15min. Uses `express-rate-limit`.
- **Toast notifications:** Frontend errors show toast notifications instead of silent console.error. Provider in layout.tsx, hook via `useToast()`.
- **URL dedup:** Company creation checks for existing companies with the same domain. ATS-hosted URLs (Greenhouse, Lever, etc.) use hostname/slug as dedup key.

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
