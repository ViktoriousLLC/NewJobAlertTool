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
- **Backend:** `requireAuth` middleware extracts `Bearer <token>` from `Authorization` header, verifies via `supabase.auth.getUser(token)`, attaches `req.userId`
- **Data scoping:** `companies` and `favorites` have `user_id` column. `seen_jobs` scoped through company's `user_id`
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

All `/api/companies` and `/api/favorites` routes require `Authorization: Bearer <token>` header.

### Companies
```
GET    /api/companies                    — List all companies
GET    /api/companies/{id}               — Get company + all jobs
POST   /api/companies                    — Add company (triggers initial scrape)
         Body: {"name": "X", "careers_url": "https://..."}
DELETE /api/companies/{id}               — Delete company (cascades to jobs)
```

### Scrape Issues
```
POST   /api/issues                       — Report a scrape issue
         Body: {"company_id": "uuid", "issue_type": "wrong_jobs|missing_jobs|bad_locations|other", "description": "..."}
```

### Compensation
```
GET    /api/compensation                 — Comp data for all user's tracked companies (batch)
GET    /api/compensation/{companyName}   — Comp data for a single company (levels, tiers, levels.fyi link)
```
Returns levels.fyi PM compensation data with 24hr cache. Includes `attribution` and `levelsFyiUrl` fields.

### Scraping
```
GET    /api/cron/trigger                 — Trigger full scrape (requires Authorization: Bearer <CRON_SECRET> header)
```
The CRON_SECRET is set in Railway env vars.

## Database Schema

### `companies` table
- `id` (uuid PK), `name`, `careers_url`, `created_at`, `last_checked_at`, `last_check_status`, `total_product_jobs`, `user_id` (FK → auth.users), `platform_type` (text), `platform_config` (jsonb), `levelsfyi_slug` (text, optional override)
- Index on `user_id`
- `platform_type`: detected ATS platform (greenhouse, lever, ashby, workday, eightfold, custom_api, generic)
- `platform_config`: ATS-specific config (e.g., `{ "boardName": "discord" }` for Greenhouse)
- `levelsfyi_slug`: optional override for levels.fyi company slug (auto-derived from name if not set)

### `seen_jobs` table
- `id` (uuid PK), `company_id` (FK → companies, CASCADE delete), `job_url_path`, `job_title`, `job_location`, `first_seen_at`, `is_baseline`, `job_level` (text)
- Unique index on `(company_id, job_url_path)`, index on `job_level`
- `is_baseline = true` for initial scrape, `false` for newly discovered jobs
- `job_level`: `'early'`, `'mid'`, or `'director'` — classified by title keywords via `classifyJobLevel()`
- Non-baseline jobs older than 30 days are auto-cleaned
- No `user_id` — scoped through company's `user_id`

### `comp_cache` table
- `id` (uuid PK), `company_slug` (text, UNIQUE), `company_name` (text), `data` (jsonb), `fetched_at` (timestamptz)
- Caches levels.fyi PM compensation data with 24hr TTL
- `data` contains: `levels` (array of {level, medianTC}), `overallMedianTC`, `tiers` ({early, mid, director} ranges), `levelsFyiUrl`
- No RLS — uses service key for read/write

### `scrape_issues` table
- `id` (uuid PK), `company_id` (FK → companies, CASCADE delete), `user_id` (FK → auth.users), `issue_type` (text), `description` (text), `created_at`
- RLS: users can insert/view their own issues
- Issue types: `wrong_jobs`, `missing_jobs`, `bad_locations`, `other`

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
- `backend/src/jobs/dailyCheck.ts` — Daily cron job logic
- `backend/src/routes/companies.ts` — API route handlers (user-scoped, with platform detection + validation)
- `backend/src/routes/favorites.ts` — Favorites API (user-scoped)
- `backend/src/routes/issues.ts` — Scrape issue reporting API (user-scoped)
- `backend/src/routes/compensation.ts` — Levels.fyi compensation API (user-scoped)
- `backend/src/lib/classifyLevel.ts` — Job level classification (early/mid/director) by title keywords
- `backend/src/lib/levelsFyi.ts` — Levels.fyi fetcher, parser, and comp_cache manager
- `frontend/src/lib/jobFilters.ts` — Shared `isUSLocation()`, job level labels/colors
- `backend/src/middleware/auth.ts` — JWT verification middleware
- `backend/src/index.ts` — Express server entry point
- `frontend/src/lib/supabase.ts` — Browser Supabase client (`@supabase/ssr`)
- `frontend/src/lib/api.ts` — Authenticated fetch wrapper (attaches JWT, caches token)
- `frontend/src/app/api/auth/token/route.ts` — Server-side route to extract JWT from HttpOnly cookies
- `frontend/src/app/login/page.tsx` — Magic link login page
- `frontend/src/app/auth/callback/route.ts` — Magic link code exchange
- `frontend/middleware.ts` — Route protection (redirects to /login if unauthenticated)
- `frontend/src/components/AuthNav.tsx` — User email + sign out in navbar
- `frontend/src/app/page.tsx` — Dashboard UI (tile grid)
- `frontend/src/app/add/page.tsx` — Add company UI
- `frontend/src/app/company/[id]/page.tsx` — Company detail page (with next-company nav)
- `frontend/src/app/jobs/page.tsx` — "View All Jobs" flat table across all companies
- `frontend/src/app/layout.tsx` — Root layout with navbar
- `cron/index.js` — Railway cron trigger script
- `supabase-schema.sql` — Database schema

## Frontend Pages

| Route | File | Description |
|-------|------|-------------|
| `/login` | `login/page.tsx` | Magic link login (email input + send link) |
| `/auth/callback` | `auth/callback/route.ts` | Exchanges magic link code for session |
| `/` | `page.tsx` | Dashboard — tile grid of all tracked companies, sorted by activity |
| `/add` | `add/page.tsx` | Add a new company form |
| `/company/[id]` | `company/[id]/page.tsx` | Company detail — jobs grouped by date, US filter, "Next Company" nav |
| `/jobs` | `jobs/page.tsx` | All Jobs — flat table of every job across all companies |

### Navbar (`layout.tsx`)
Sticky top nav with: Logo + "NewPMJobs" | [Starred] [View All Jobs] [+ Add Company] | email + Sign Out

### Shared patterns
- **US Only toggle**: Checkbox filter using `isUSLocation()` regex matcher — shared logic in company detail and all-jobs pages
- **`first_seen_at`**: Used as "Date Added" in the all-jobs table (per-job, not per-company)
- **`last_checked_at`**: Used in company detail page stats (per-company scrape timestamp)

## Favorites

### `favorites` table
- `id` (uuid PK), `job_id` (uuid FK → seen_jobs, CASCADE delete), `user_id` (uuid FK → auth.users), `created_at`
- Unique index on `(user_id, job_id)` — each user can star a job once
- RLS policies scoped to `auth.uid() = user_id`
- API: `GET /api/favorites`, `POST /api/favorites/:jobId`, `DELETE /api/favorites/:jobId` (all require auth, scoped by user)
- Frontend: star icons on All Jobs and Company Detail pages, "Starred" navbar button → `/jobs?filter=starred`

## Email

- **Daily alerts:** Sent from `alerts@<your-domain>` (via Resend API in `sendAlert.ts`)
- **Magic link emails:** Sent from `noreply@<your-domain>` (via Supabase custom SMTP → Resend)
- **Recipient:** Set via `ALERT_RECIPIENT_EMAIL` env var in Railway
- **API key:** Only in Railway production env vars (`RESEND_API_KEY`). Empty locally — cannot send from local.
- **To send one-off emails:** Add a temporary protected endpoint, push to deploy, call via curl, then clean up.

## Gotchas & Lessons

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
