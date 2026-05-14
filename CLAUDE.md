# NewJobAlertTool — Project Context

## Autonomy Rules

- **DO NOT ask to run commands.** Just run them. The user is often AFK.
- **DO NOT leave manual steps for the user.** If it can be done via API, CLI, or script — do it yourself.
- **Push code, deploy, clean DB, re-add companies — all autonomously.** Full access granted.
- **Execute end-to-end** including deployment and verification. Come back with proof it works, not "next steps."
- **Never ask before pushing — to a feature branch.** `main` is branch-protected (added 2026-05-14). Push to `claude/<slug>` branches and open PRs with `gh pr create`. The user merges via GitHub.
- **Session start health check:** At the start of every conversation, query the `companies` table for scrape failures (`last_check_status` containing 'error' or 'quality: 0/100'). If any exist, investigate and fix them immediately before doing anything else. Don't report failures — fix them, push, and show proof.

## Architecture

| Layer | Tech | Where |
|-------|------|-------|
| Frontend | Next.js 16 | Vercel (auto-deploys from `main`) |
| Backend | Express + Puppeteer | Railway (auto-deploys from `main`) |
| Database | PostgreSQL | Supabase |
| Scheduler | Railway Cron | 14:00 UTC daily scrape |
| Auth | Supabase Auth | Magic link via Resend SMTP |
| DNS | Cloudflare | Grey cloud (DNS only) for Vercel/Railway |
| Monitoring | Sentry + PostHog | Error tracking + product analytics |

## Deployment

`main` is branch-protected (GitHub rule set, added 2026-05-14). Direct push to `main` is rejected. Every change goes through a PR.

**Workflow:**
1. Create feature branch: `git checkout -b claude/<slug>`
2. Edit + commit + `git push -u origin <branch>`
3. Open PR: `gh pr create --title "..." --body "..."`
4. Vercel + Railway auto-deploy preview environments on the PR
5. User reviews preview URLs → clicks "Merge" on GitHub
6. Merge to `main` auto-deploys to production (~60s Railway, ~30s Vercel)

**Vercel preview URLs** post automatically to the PR via the Vercel bot. Pull Request Comments must stay enabled in Vercel project settings.

**Railway PR environments**: `Base = Production` (env vars cloned from prod), `Bot PR Environments = on`, `Focused PR Environments = on`. Preview URLs are unguessable but still touch the prod Supabase + Resend — do not share publicly.

```bash
curl -s "https://api.<your-domain>/api/health"   # verify backend after merge
```

## Subagents (Claude Code)

13 specialized agents live in `.claude/agents/`. Full catalog: `.claude/agents/README.md`. Agents are auto-discovered at session start. They propose patches/findings in their output; the main agent handles git ops after user review.

| Agent | What it does | Model |
|---|---|---|
| `scraper-doctor` | Diagnose one broken scraper | sonnet |
| `catalog-scout` | Research new companies + detect ATS | sonnet |
| `security-auth` | Audit login/JWT/cookie code | opus |
| `security-data-isolation` | Audit cross-user data leaks + RLS | opus |
| `security-infra` | Audit npm/env/headers/limits | opus |
| `change-reviewer` | Independent code review before push | opus |
| `code-refactorer` | Behavior-preserving cleanup | sonnet |
| `incident-triage` | Production incident root-cause | opus |
| `debugger` | Fix one specific dev bug | sonnet |
| `db-optimizer` | Postgres query/index tuning | opus |
| `performance-engineer` | App-layer perf review | sonnet |
| `threat-modeling-expert` | STRIDE on new feature surfaces | opus |
| `spec-writer` | Feature idea → backlog table spec | sonnet |

**Invoke style:** describe the task ("the Coinbase scraper is broken" → scraper-doctor) or name the agent explicitly. Six more agents identified but deferred until their trigger fires — see `.claude/agents/README.md` deferred section.

## Authentication

- **Magic link** (no passwords): email → `/auth/confirm` verifies `token_hash` via `verifyOtp()` → JWT in HttpOnly cookies
- **Legacy PKCE** fallback at `/auth/callback` — same-browser only
- **Email template** (Supabase Dashboard): `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink`
- **Token flow**: Browser can't read HttpOnly cookies → `apiFetch` calls `/api/auth/token` server route → caches in memory
- **Backend auth**: `requireAuth` middleware does local JWT verification via `SUPABASE_JWT_SECRET` (~0ms), fallback to Supabase API (~150ms)
- **Data scoping**: Companies are shared catalog. Users subscribe via `user_subscriptions`. Dashboard/jobs filtered by subscription.
- **Protected routes**: Middleware redirects to `/login` except `/`, `/auth/callback`, `/auth/confirm`, `/privacy`
- **Env vars needed**: `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_KEY` (must be `service_role`, NOT `anon`)

## API Endpoints

All routes require `Authorization: Bearer <token>` unless noted.

```
# Companies (user-scoped via subscriptions)
GET    /api/companies                    — User's subscribed companies
GET    /api/companies/{id}               — Company + jobs + next_company
POST   /api/companies/check              — Preview scrape (no DB write). Body: {careers_url, feedback?}
POST   /api/companies                    — Add company (auto-subscribe, 10/user limit). Body: {name, careers_url, jobs?, platform_type?, platform_config?}
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
POST   /api/help                         — Feedback email + DB. Body: {issue_type, message, page_url}
POST   /api/issues                       — Scrape issue. Body: {company_id, issue_type, description}

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
         Optional: ?forceMondayDigest=true — Forces the Monday-style weekly digest (system health + 7-day self-heal log + npm-audit) on any day. Use with skipEmails for on-demand admin reports.
```

## Database Schema

| Table | Key columns | Notes |
|-------|------------|-------|
| `companies` | id, name, careers_url, platform_type, platform_config (jsonb), total_product_jobs, subscriber_count, is_active, last_checked_at, last_check_status, levelsfyi_slug | Shared catalog. `is_active` = subscriber_count > 0. Scraper checks ALL companies regardless. CASCADE deletes jobs. |
| `seen_jobs` | id, company_id (FK CASCADE), job_url_path, job_title, job_location, first_seen_at, is_baseline, job_level, status, status_changed_at | Status: active → removed → archived (60 days). Unique on (company_id, job_url_path). |
| `user_subscriptions` | id, user_id, company_id (FK CASCADE) | UNIQUE(user_id, company_id). Links users to tracked companies. |
| `user_job_favorites` | id, user_id, seen_job_id (FK CASCADE) | UNIQUE(user_id, seen_job_id). Star icons on jobs pages. |
| `user_new_company_submissions` | id, user_id, company_id | Rate limit: 10/user, admin bypass. |
| `user_preferences` | id, user_id (UNIQUE), email_frequency | daily/weekly/off. |
| `comp_cache` | id, company_slug (UNIQUE), data (jsonb), fetched_at | levels.fyi cache, 24hr TTL. No RLS. |
| `scrape_issues` | id, company_id (FK CASCADE), user_id, issue_type, description | wrong_jobs/missing_jobs/bad_locations/other. |
| `help_submissions` | id, user_id, user_email, issue_type, message, page_url | Index on created_at DESC. |
| `scraper_events` | id, company_id, company_name, event_type, details (jsonb), created_at | Audit log of self-healing actions: stealth_recovery, auto_remediation, auto_disabled, auto_re_enabled. Queried by Monday weekly digest. |
| `security_snapshots` | id, snapshot_date, total_vulns, by_severity (jsonb), vuln_fingerprints (jsonb) | Weekly npm audit snapshot. Monday cron writes new row, diffs against previous to surface new/resolved vulns in admin digest. |

**Self-healing columns on `companies`** (added 2026-05-08): `consecutive_failure_count INTEGER DEFAULT 0` (resets to 0 on success, increments on each catch-block failure) and `auto_disabled BOOLEAN DEFAULT FALSE` (set true at 7+ consecutive failures, cron loop skips). Partial index `idx_companies_consecutive_failures` on `consecutive_failure_count > 0`.

**Key indexes**: `(company_id, job_url_path)` unique, `(company_id, is_baseline, first_seen_at)`, `(company_id, status)`, `(status, first_seen_at DESC)`, `(is_active)`.

## Scraper Architecture

**File**: `backend/src/scraper/scraper.ts`

**Routing order** (as of 2026-03-07 — hostname checks run BEFORE Puppeteer launch):
1. `platform_type` switch (if company has it set in DB) → direct to ATS scraper
2. Hostname checks for custom scrapers (EA, Atlassian, Netflix, Stripe, Uber, Google)
3. ATS registry lookup (`atsRegistry.ts`) — hostname → known ATS mapping
4. Direct ATS URL checks (jobs.lever.co, jobs.ashbyhq.com, *.myworkdayjobs.com, eightfold.ai, jobs.smartrecruiters.com, *.icims.com)
5. **Only then**: `puppeteer.launch()` for truly generic/unknown companies (~6 currently)

| Platform | Detection | Examples |
|----------|-----------|---------|
| Greenhouse | API: `api.greenhouse.io/v1/boards/{board}/jobs` | DoorDash, Discord, Reddit, Instacart, Figma, Airbnb, a16z, Twitch, Datadog, LinkedIn |
| Lever | API: `api.lever.co/v0/postings/{handle}` | Auto-detected from jobs.lever.co |
| Ashby | GraphQL API | OpenAI, auto-detected from jobs.ashbyhq.com |
| Workday | JSON API | Slack, auto-detected from *.myworkdayjobs.com |
| Greenhouse | API | Anthropic (migrated from Ashby 2026-03-19) |
| Eightfold | API | PayPal, Microsoft (custom domain: apply.careers.microsoft.com) |
| Custom API | Per-company | Atlassian, Uber, Netflix, Amazon |
| iCIMS REST API | JSON: `{base}/api/jobs?keywords=` | Rivian, Costco (no Puppeteer) |
| Oracle HCM | REST API: `recruitingCEJobRequisitions` | JPMorgan Chase, Oracle |
| TalentBrew | HTML-in-JSON parser | Intuit (jobs.intuit.com) |
| Puppeteer | HTML scraping (120s timeout) | Google, eBay, Ametek, Apple, Meta, Wayfair, Tesla, TikTok, fallback for unknown |

**ATS registry** (`atsRegistry.ts`): Single source of truth mapping hostnames → ATS platform + config. Used by both `detectPlatform.ts` and `scraper.ts`.

**Platform auto-detection** (`detectPlatform.ts`): Known hostnames → direct ATS URLs → HTML embed detection → Puppeteer SPA render → speculative Greenhouse/Lever API probes → generic fallback. Cached in `companies.platform_type` + `platform_config`.

**broadATSDiscovery guard**: `CUSTOM_SCRAPER_HOSTS` blocklist in `dailyCheck.ts` prevents broadATSDiscovery from overwriting custom scraper companies (Stripe, EA, Atlassian, Netflix, Uber, Google, Amazon, Intuit, Rivian, Costco).

**Post-scrape validation** (`validateScrape.ts`): Two-pass filtering: (1) PM_KEYWORDS (17 keywords), (2) US location filter via `isUSLocation()` from `lib/locationFilter.ts`. Non-US jobs never enter the DB. Also flags zero results/vague locations/dupes, returns quality score + `nonUsFilteredCount`. Company-specific extra exclusions (`COMPANY_EXTRA_EXCLUSIONS`) filter out non-PM program manager variants (TPMs, business PMs, etc.) even when company extra keywords match.

**Daily quality eval** (`dailyEval.ts`, simplified 2026-04-26): Runs after scraping, before emails. Only flags actionable issues: sudden spikes/drops (>100%/50% change AND >10 absolute), zero jobs for subscribed companies, first-scrape results. Removed noisy checks: absurd job counts, high non-US ratio, low quality scores. Sends admin email with per-company scorecard (issues at top, clean at bottom). Critical issues also go to Sentry.

**Company name detection** (`detectCompanyName.ts`): 40+ known hosts, ATS slug fallback, generic hostname fallback.

**Scrape failure alerting** (upgraded 2026-03-20): Admin email now shows two sections: green "Auto-fixed" (platform changes the cron self-healed) and red "Still needs attention" (actual failures). Only sends email if there's something to report. Sentry captures each failure with company/phase tags. If >25% of companies fail, cron returns HTTP 500.

**Auto-remediation** (added 2026-03-19): When ANY company (not just generic) returns 0 raw jobs, cron runs `broadATSDiscovery` to detect platform changes. If a new platform is found and produces results, auto-updates the DB and logs to Sentry. Still guarded by `CUSTOM_SCRAPER_HOSTS` blocklist.

**Three-tier self-healing recovery** (added 2026-05-08, refined 2026-05-11): When any company's source returns 0 raw jobs (NOT just 0 PMs), the cron runs three recovery tiers in order:
1. **Configured platform scraper** (existing) — uses `platform_type` from DB. Filter-heavy scrapers (Greenhouse/Workday/Ashby) write their pre-PM-filter count to a `ScrapeStats` out-param so we distinguish "source returned 0" (try recovery) from "source returned 50 but 0 PMs" (no recovery needed).
2. **broadATSDiscovery** (existing) — auto-detects new ATS, updates DB. Skipped for `CUSTOM_SCRAPER_HOSTS`
3. **`stealthFallbackScrape`** (in `scraper.ts`) — generic last-resort using `puppeteer-extra` + `puppeteer-extra-plugin-stealth`. Sniffs all JSON XHR responses for arrays of objects with title+id-like fields, falls back to DOM extraction. Returns the sniffed URL plus the jobs. **Layer 1 auto-fix** (added 2026-05-11): `inferPlatformFromSniffedUrl()` tries to map the sniffed URL to a known ATS pattern (Greenhouse, Lever, Ashby, SmartRecruiters). If matched, auto-updates `platform_type` + `platform_config` so the next run hits the API directly and skips stealth entirely.

**Auto-disable** (added 2026-05-08): Companies that fail 7 consecutive days are auto-disabled — `auto_disabled=true` and skipped from cron. Threshold = `AUTO_DISABLE_THRESHOLD` constant in `dailyCheck.ts`. Successful scrape resets `consecutive_failure_count=0` and `auto_disabled=false`. To manually re-enable: `UPDATE companies SET auto_disabled = false, consecutive_failure_count = 0 WHERE name = '...';`

**Monday watch-list probe** (added 2026-05-08): Every Monday UTC (`PROBE_DAY_OF_WEEK = 1`), the cron retries each auto-disabled company once. Successful probe → automatic re-enable + green "Watch-list re-enabled" section in admin email. Failed probe → counter stays at threshold, doesn't ratchet higher.

**Stealth Puppeteer dependencies**: `puppeteer-extra@3.3.6` + `puppeteer-extra-plugin-stealth@2.11.2` (both pinned, see `backend/package.json`). Stealth plugin spoofs `navigator.webdriver`, window.chrome runtime, permissions API, and other headless-Chrome tells.

**Double-filtering gotcha**: Most scrapers (Greenhouse, Workday, Lever, etc.) filter by PM_KEYWORDS internally before returning results. Then `validateScrapeResults` filters again. This means `rawJobs.length === 0` can mean "no PM jobs" (legit) OR "scraper broken" -- can't distinguish at the `dailyCheck` level. Actual scraper failures throw exceptions caught by the `catch` block.

**Key rules**:
- After adding/fixing a scraper, always delete + re-add the company to flush stale data
- Stripe scraper takes ~2-3 min (Puppeteer pagination + detail pages)
- To fix broken scraper: identify platform → add handler in `scrapeCompanyCareers()` → push → delete + re-add company
- Never let broadATSDiscovery run on custom scraper companies — it can overwrite platform_type with a false ATS match

## Key Files

### Backend
- `src/scraper/scraper.ts` — All scraper logic (hostname routing before Puppeteer launch)
- `src/scraper/atsRegistry.ts` — Shared ATS hostname → platform mapping (single source of truth)
- `src/scraper/detectPlatform.ts` — ATS platform auto-detection
- `src/scraper/detectCompanyName.ts` — Company name from URL
- `src/scraper/validateScrape.ts` — Post-scrape quality validation + US location filtering
- `src/scraper/dailyEval.ts` — Daily quality evaluation (per-company scorecard)
- `src/lib/locationFilter.ts` — US location detection (isUSLocation + NON_US_PATTERNS)
- `src/jobs/dailyCheck.ts` — Daily cron: scrape all companies, quality eval, per-user email alerts, job status tracking
- `src/routes/companies.ts` — Companies CRUD (subscription-scoped, check-then-add)
- `src/routes/admin.ts` — Admin API: stats, issues, companies management, users
- `src/routes/subscriptions.ts` — Subscribe/unsubscribe
- `src/routes/catalog.ts` — Shared company catalog
- `src/routes/compensation.ts` — levels.fyi comp data
- `src/middleware/auth.ts` — JWT verification (userId + userEmail)
- `src/lib/constants.ts` — ADMIN_EMAIL (env var, fallback hardcoded)
- `src/lib/levelsFyi.ts` — Comp data fetcher + 3-tier cache
- `src/lib/classifyLevel.ts` — Job level: early/mid/director
- `src/index.ts` — Express entry point

### Frontend
- `src/app/page.tsx` — Auth-gated: LandingPage (unauth) or Dashboard (auth)
- `src/app/company/[id]/page.tsx` — Company detail + jobs + saved inactive section
- `src/app/jobs/page.tsx` — All Jobs flat table
- `src/app/admin/page.tsx` — Admin: stats, errors, reports, companies management (hard-delete), users
- `src/app/settings/page.tsx` — Email preferences
- `src/app/login/page.tsx` — Magic link login
- `src/app/auth/confirm/route.ts` — Token-hash verification (cross-device)
- `src/app/auth/callback/route.ts` — PKCE exchange (legacy)
- `src/components/LandingPage.tsx` — Above-fold (Nav + Hero) + shared utils
- `src/components/LandingBelowFold.tsx` — Below-fold (sections 3-10), lazy-loaded
- `src/components/AddCompanyModal.tsx` — Catalog browse + check-then-add (4 states: input → checking → preview → retry)
- `src/components/NavBar.tsx` — Sticky nav, active route detection
- `src/lib/api.ts` — Authenticated fetch (attaches JWT, caches token via /api/auth/token)
- `src/lib/jobFilters.ts` — `isUSLocation()`, job level labels
- `src/lib/brandColors.ts` — Brand color map, `softenColor()`, `getFaviconUrl()`
- `middleware.ts` — Route protection

### Scripts / Config
- `cron/index.js` — Railway cron trigger
- `scripts/reset-test-user.sql` — Test account wipe
- `scripts/phase6-cleanup.sql` — Drop legacy favorites + companies.user_id
- `docs/specs/NEWPMJOBS-LANDING-SPEC.md` — Landing page spec

## Email

- **Daily/weekly alerts**: Per-user, filtered by subscriptions + preferences. Batch send via `resend.batch.send()` (100/call, 1s delay).
- **From**: `alerts@newpmjobs.com` (API), `noreply@newpmjobs.com` (magic links via SMTP)
- **Resend limits**: Free = 100 emails/day, 3K/month, 2 req/s. SMTP + API share quota.
- **API key**: Only in Railway env vars. Empty locally.
- Failure notifications sent to ADMIN_EMAIL after cron if email batches fail.
- **Consolidated admin digest** (added 2026-05-11, expanded 2026-05-12): `sendAdminDigest()` replaces three previous admin emails (failures, quality report, batch-send failures) with one. Daily: fires ONLY if action items present (failed scrapes, watch list, auto-disabled, subscribed company dropped to 0, email send failures). **Monday AND Tuesday (UTC)**: always fires with system health + past-7-days self-heal log queried from `scraper_events` table + npm-audit security check (`runSecurityCheck()` in `backend/src/jobs/securityCheck.ts`) showing new/resolved vulns vs the previous week's `security_snapshots` row. Two-day window gives admin a chance to review the weekly report if Monday gets buried. Security check diff queries snapshots ≥6 days old so both Mon and Tue show real week-over-week deltas. Most days = no admin email.

## Delete Semantics

- **Dashboard "Remove"** = unsubscribe only. Updates subscriber_count and is_active.
- **Companies with 0 subscribers** stay in catalog, keep getting scraped.
- **Admin hard-delete** (`DELETE /api/companies/{id}?hard=true`) from admin page — cascades to jobs, subscriptions, etc.

## Performance Rules

**Follow automatically on ALL changes:**
1. Audit for N+1 queries — use `Promise.all()` for independent queries, batch operations
2. Parallel over sequential for independent DB calls
3. Minimize round-trips — one batch query over N individual
4. Check if new WHERE/ORDER BY columns need indexes
5. Don't re-fetch data already available — pass via props/context

## Security

- **Headers** in `frontend/next.config.ts`: X-Frame-Options DENY, nosniff, HSTS, CSP (dynamic from env vars)
- **CSP connect-src**: self, backend API, Supabase HTTPS+WSS, PostHog, Sentry
- **Input validation**: UUID regex on IDs, HTTPS-only URLs, LinkedIn blocked, SSRF protection (no private IPs)
- **Auth hardening**: Open redirect prevention on `/auth/confirm`, HTML-escaped user input in emails, PII removed from logs
- **JWT verification** (`backend/src/middleware/auth.ts`): HS256 pinned, validates `audience: "authenticated"` and `issuer: <supabase-url>/auth/v1`. Fails closed at boot in production if `SUPABASE_JWT_SECRET` missing. Sentry warning fires when local-verify fails and code falls back to Supabase API.
- **Cookies are HttpOnly** (`frontend/middleware.ts`, `auth/confirm`, `auth/callback`): Supabase defaults preserved. Browser JS reads tokens via `/api/auth/token` server route — never directly. **Do NOT override `httpOnly: false` on cookie set calls.**
- **Cron / shared-secret bearer tokens**: Use `safeCompareSecret()` in `backend/src/index.ts` (constant-time `crypto.timingSafeEqual` with length equalization). Applied to `/api/cron/trigger` and `/api/admin/add-company`. Reuse for future Stripe/Twilio webhook signature verification.
- **Body limits**: `express.json({ limit: "256kb" })` globally. Per-route caps: `/api/help.message` ≤ 5000, `/api/issues.description` ≤ 5000.
- **Data isolation**: Every read endpoint on user-scoped or subscription-gated data MUST check the requester's subscription before returning. Pattern: load `user_subscriptions` for `req.userId`, return 403 if target not in list. Applies to `GET /api/companies/:id`, `POST /api/favorites/:jobId`, `POST /api/issues`. **Never trust client-supplied user_id; always derive from JWT.**
- **PostHog**: User ID hashed with SHA-256 (no raw emails)
- **DNS**: DMARC + DKIM + SPF configured
- **Security log**: `docs/security-log.md` (gitignored) — running record of audits, fixes, deferred items. Append to it after every audit. Includes "why didn't last audit catch this" answer.
- **Audit framework**: Three parallel specialized review agents (auth flow / data isolation / infra + monetization-readiness), NOT one general pass. See `docs/security-log.md` "Process notes" section.

## Gotchas

- **Supabase DDL**: Cannot run CREATE/ALTER TABLE via supabase-js. Use SQL Editor in dashboard.
- **SUPABASE_SERVICE_KEY**: Must be `service_role` key. Anon key causes empty results for user-scoped queries.
- **HttpOnly cookies**: Browser JS can't read them. Use `/api/auth/token` server route.
- **CORS + www**: Backend CORS must allow both root and www origins. Code auto-adds www variant from FRONTEND_URL.
- **Supabase redirect URLs**: Need all 4 (root + www) x (callback + confirm).
- **NEXT_PUBLIC_ env vars**: Baked at build time. Must redeploy after changing in Vercel.
- **NEXT_PUBLIC_ADMIN_EMAIL**: Required in Vercel for admin button to appear.
- **Vercel project name**: `new-job-alert-tool` (not `frontend`). `vercel link --yes` auto-creates — verify with `vercel project ls`.
- **Cloudflare proxy**: Must be OFF (grey cloud) for Vercel/Railway custom domains.
- **Cron endpoint**: Must `await runDailyCheck()` — Railway auto-sleep kills fire-and-forget.
- **Railway Cron only**: No in-process schedulers (node-cron) — causes duplicate runs.
- **Duplicate companies**: Dedup by URL domain, not name. ATS URLs use hostname/slug key.
- **PM_KEYWORDS false negatives**: Some companies use non-standard titles (e.g., "Product Growth"). Check if 0 PM roles but company has jobs.
- **Salesforce trap**: `careers.salesforce.com` redirects to marketing page. Use Workday URL directly: `salesforce.wd12.myworkdayjobs.com/External_Career_Site`.
- **Stale scraper data**: After changing a scraper, delete + re-add the company.
- **Windows sleep**: Use `powershell -command "Start-Sleep -Seconds N"` (not `timeout`).
- **Git CRLF**: `git config core.autocrlf input` to suppress warnings.
- **Test account**: Gmail + alias. Reset: `scripts/reset-test-user.sql`.
- **Local .env**: Placeholder keys only. Production keys on Railway.
- **broadATSDiscovery overwrite**: Can silently change a custom scraper company's `platform_type` if a matching ATS board exists (e.g., Greenhouse board "stripe"). Guarded by `CUSTOM_SCRAPER_HOSTS` blocklist in `dailyCheck.ts`. Never remove this guard.
- **Local CRON_SECRET mismatch**: The local `.env` CRON_SECRET doesn't match Railway production. Can't trigger manual cron from local — use Railway dashboard or wait for scheduled run.
- **ATS API null responses**: External APIs (Ashby, Greenhouse, etc.) can return null payloads on transient failures even with HTTP 200. Always null-check before destructuring API response objects.
- **Eightfold custom domains**: Microsoft uses `apply.careers.microsoft.com` (not `*.eightfold.ai`). Domain extraction must handle both: eightfold subdomains (`paypal.eightfold.ai` → `paypal.com`) and custom domains (`apply.careers.microsoft.com` → `microsoft.com`). The API also sometimes returns 200 with HTML "Not Found" instead of JSON.
- **Anthropic moved from Ashby to Greenhouse** (2026-03-19): Ashby GraphQL returns `jobBoard: null`. Greenhouse board token is `anthropic`. Added to `atsRegistry.ts`.
- **Scrapers pre-filter by PM_KEYWORDS**: Most ATS scrapers return only PM-matching jobs, not all jobs. This means `rawJobs.length === 0` is ambiguous -- could be "no PM roles" or "broken API". Don't use raw job count to detect failures.
- **Backend US location filtering (added 2026-03-22)**: `validateScrapeResults` now filters non-US jobs via `isUSLocation()` in `lib/locationFilter.ts`. Non-US jobs never enter `seen_jobs` table. Frontend `isUSLocation` toggle in `jobFilters.ts` is now redundant but kept for backward compatibility. If a location doesn't match any US or non-US pattern, it defaults to excluded (safer).
- **NON_US_PATTERNS coverage**: 60+ patterns for India, UK, Germany, France, Canada, Australia, Singapore, Japan, China, Ireland, Netherlands, Israel, Brazil, Mexico, Sweden, Switzerland, Spain, Italy, Poland, South Korea, Taiwan, Philippines, Vietnam, Thailand, Malaysia, Indonesia, Nigeria, Kenya, plus EMEA/APAC/LATAM region codes. Add new countries as needed to `lib/locationFilter.ts`.
- **Microsoft TPM inflation (fixed 2026-04-01)**: Microsoft's "program manager" exception was bypassing ALL hard exclusions, letting TPMs, business PMs, customer experience PMs through. `COMPANY_EXTRA_EXCLUSIONS` in `validateScrape.ts` now rejects non-product PM variants while keeping pure Program Manager/Product Manager titles. Cut Microsoft from 123 to ~75 jobs.
- **US state abbreviations vs country codes (fixed 2026-04-23)**: The April 1 fix for "ON,CA" (Ontario, Canada) rejected ALL 2-letter codes != "US", including US state abbreviations. "San Francisco, CA" was treated as Canada. Fix: `US_STATES` set in `locationFilter.ts` exempts state abbreviations from the country code check. Canadian provinces handled via explicit `NON_US_PATTERNS` (ON,CA; BC,CA; etc.). This bug silently rejected US jobs for ~3 weeks.
- **Puppeteer mass failure (fixed 2026-04-21)**: All 10 Puppeteer-dependent companies crashed with `posix_spawn` error (Chrome binary issue in `:latest` Docker image). Migrated 7 to API scrapers: Datadog/LinkedIn (Greenhouse), Amazon (custom JSON API), Rivian/Costco (iCIMS REST API), Intuit (TalentBrew HTML parser), Zerodha (custom REST API). Pinned Docker image to `24.2.0` for remaining 3 (Google, eBay, Ametek).
- **iCIMS API keyword search inconsistency**: iCIMS `q=` param doesn't filter at Rivian (returns all 668 jobs). Use `keywords=` param instead (works for Costco: 9 results). Different iCIMS instances behave differently.
- **Docker `:latest` tag drift**: `ghcr.io/puppeteer/puppeteer:latest` pulled a broken Chrome build. Always pin Docker base images to a specific version.
- **Puppeteer version must match Docker image**: Docker image `24.2.0` bundles Chrome for puppeteer 24.2.0. If package.json has `^24.2.0`, npm installs 24.36.1 which wants Chrome 144 (not in image). Must pin exact: `"puppeteer": "24.2.0"` (no caret).
- **Oracle HCM API**: Uses `recruitingCEJobRequisitions` REST endpoint. Requires `tenantUrl` (e.g. `https://jpmc.fa.oraclecloud.com`) and `siteNumber` (e.g. `CX_1001`). Returns all keyword matches, not just PM titles.
- **Phase 6 migration complete (2026-04-22)**: Dropped legacy `favorites` table and `companies.user_id` column. Both replaced months ago by `user_job_favorites` and `user_subscriptions`.
- **Empty locations default to excluded (fixed 2026-04-22)**: `isUSLocation("")` now returns `false`. Previously returned `true`, which included jobs with no location data.
- **Oregon pattern case-sensitive (fixed 2026-04-22)**: `/\bOR\b/` (no `i` flag). Was matching the English word "or" in locations like "Bangalore or Remote".
- **Coinbase deleted public Greenhouse board (2026-05-08)**: `boards-api.greenhouse.io/v1/boards/coinbase/*` returns 404 on every endpoint (jobs, embed/jobs, embed/departments). Coinbase migrated to a custom SPA at `coinbase.com/careers/positions` (server-redirects to `/careers`) that fetches `/api/v2/careers` from `api.coinbase.com`. The internal API returns HTTP 400 even from inside a stealth-rendered Puppeteer SPA with proper X-CB-* headers — server-side rejection of public scraping. Custom scraper at `scrapeCoinbaseCareers` returns `[]` on capture failure so the `stealthFallbackScrape` tier gets a chance. Will land in auto-disable after 7 days unless Coinbase reopens the API. May coincide with their public layoff announcement (hiring freeze).
- **Throw vs return [] in custom scrapers**: Tier-1 scrapers that throw bypass tiers 2 and 3. To let auto-healing run, return `[]` instead of throwing for known/expected failures. Reserve exceptions for genuinely unexpected errors.
- **Stealth fallback won't run if Tier 1 throws**: `dailyCheck` checks `rawJobs.length === 0` to trigger the stealth tier. If the configured scraper throws, the catch block fires and stealth fallback is skipped. Pattern: `try { ... return jobs } catch { console.warn; return [] }` for scrapers prone to non-fatal failures.

## Check-Then-Add Flow

States: `input` → `checking` → `preview` → `retry`

1. User enters URL only (name auto-detected)
2. `POST /api/companies/check` scrapes without saving → returns preview
3. User confirms → `POST /api/companies` with pre-checked data (skips re-scrape)
4. "No, Try Again" → retry with feedback → "Cancel" files feedback via `/api/help`
5. URL match → offers to subscribe to existing company

## Landing Page

Fixed overlay at `/` for unauthenticated visitors. 10 sections: Nav → Hero → Problem → How It Works → Product Screens → Latest Jobs → Comp Callout → Stats → CTA → Footer.

- Code-split: above-fold `LandingPage.tsx` + lazy `LandingBelowFold.tsx`
- Pre-computed `COMPANY_COLORS` map, deferred PostHog init
- Desktop Lighthouse: 100. Mobile: ~72-77 (React DOM bottleneck).
- Spec: `docs/specs/NEWPMJOBS-LANDING-SPEC.md`
