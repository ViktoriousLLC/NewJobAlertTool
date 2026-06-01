# NewJobAlertTool — Project Context

## Autonomy Rules

- **DO NOT ask to run commands.** Just run them. The user is often AFK.
- **DO NOT leave manual steps for the user.** If it can be done via API, CLI, or script — do it yourself.
- **Push code, deploy, clean DB, re-add companies — all autonomously.** Full access granted.
- **Execute end-to-end** including deployment and verification. Come back with proof it works, not "next steps."
- **Never ask before pushing — to a feature branch.** `main` is branch-protected. Push to `claude/<slug>` branches and open PRs with `gh pr create`. The user merges via GitHub.
- **Session start health check:** At the start of every conversation, query the `companies` table for scrape failures: `last_check_status` containing 'error', or `'success (0 jobs from source)'` (a healthy-looking scrape that returned nothing from the source — the scraper may be broken). NOTE: `'success (0 PMs)'` is HEALTHY (source works, just no PM roles right now), not a failure. (`'quality: 0/100'` was retired by PR #98 — don't grep for it.) If any real failures exist, investigate and fix them immediately before doing anything else. Don't report failures — fix them, push, and show proof.

## Sidecar Docs (READ BEFORE EDITING)

These folders have a `.md` sidecar next to the code. **You MUST `Read` the sidecar before any `Edit`, `Write`, or new file in that folder, once per session.** Not optional. Not "if relevant." A PreToolUse hook (`.claude/hooks/sidecar-guard.js`, wired in `.claude/settings.json`) enforces this and blocks the tool call if you skip it. NOTE: the guard script existed but was NOT wired into settings until 2026-06-01 (DEV-60) — so this was honor-system before; it now actually fires.

| When you touch this folder | First read this sidecar |
|---|---|
| `backend/src/scraper/` | `backend/src/scraper/SCRAPER.md` |
| `backend/src/middleware/` | `backend/src/middleware/AUTH.md` |
| `backend/src/routes/` | `backend/src/routes/ROUTES.md` |
| `backend/src/jobs/` | `backend/src/jobs/JOBS.md` |
| `frontend/src/components/` | `frontend/src/components/COMPONENTS.md` |

The sidecars hold subsystem detail (gotchas, platform-specific notes, historical fixes) that doesn't belong in this global file.

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

`main` is branch-protected. Direct push to `main` is rejected. Every change goes through a PR.

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

## Git & PR Workflow — always `/ship`

**Every change reaches `main` through `/ship`** (`.claude/commands/ship.md`). It removes the per-session improvisation (branch vs local main, worktree or not, cleanup, savecc) that caused a 4-window `main` divergence on 2026-05-29. Just say "ship it"; it asks once, then runs the whole chain: branch off `origin/main` → commit → review → PR → merge → delete the branch + reset local main → bundle the doc updates into the same PR.

**Rules (hold even outside `/ship`):**
- **Never commit to local `main`.** Branch off `origin/main` (`claude/<slug>`), always.
- **One worktree per parallel session** (`git worktree add ../<dir> -b claude/<slug> origin/main`) so two sessions never collide on files or branches. Skip `npm ci` unless the change needs it (Windows long-path).
- **After any merge, reset local main:** `git fetch origin --prune && git checkout main && git reset --hard origin/main`. Keeps your local main matching GitHub — avoids the "real main vs stale local main" trap that misled a window on 2026-05-29.
- **`main` is a repository ruleset (id 16381419), 0 required approvals** — not classic branch protection. Direct push is blocked; `gh pr merge` works without a human approver, so `/ship` can merge (it's a convention gate, not a hard one). (The "Deployment" steps above describe the manual long-form of this.)
- **Docs ride in the change's PR (savecc-on-ship):** the project-history entry + any CLAUDE.md/sidecar currency fix go in the same PR; MEMORY.md updates right after.
- **Every PR has a Linear task — no exceptions, manual git included.** Find the `DEV-N` the work belongs to, or **create one** in the Development team before opening the PR; reference it in the PR body; move it to its new state (In Progress when work starts, Done on merge) + link the PR. This binds whether you run `/ship` OR push a branch by hand — **the manual-git fast-path does NOT get to skip the Linear task or the docs.** Bypassing `/ship` is exactly what let docs + Linear lag a full session on 2026-05-31; the user had to ask four times. Docs AND Linear, every PR.
- **A pre-merge hook now ENFORCES the above mechanically (DEV-60, 2026-06-01).** `.claude/hooks/pre-merge-guard.js` (wired in `.claude/settings.json`) blocks `gh pr merge <N>` unless the PR's diff includes a `project-history.md` entry AND a `DEV-N` is referenced (body/title/branch/commits). Fails open (never locks the shell). This is the fix for "manual git keeps dropping a doc/Linear step" — it can't be silently skipped now, whether via `/ship` or raw git. **Still judgment calls (reminded in the block message, NOT auto-blocked): the product-development-journey.md phase for a capability shift, and CLAUDE.md/sidecar currency for endpoint/schema/env changes** — when you write the forced project-history entry, run the full savecc checklist.
- **Never merge to `main` during the daily-cron window (13:55-16:00 UTC).** A merge auto-redeploys Railway, restarting the container; on 2026-05-31 that killed the in-flight 14:00 daily cron at company 31/519 with no email and no alarm (P0, DEV-57). Enforced by the `cron-window-guard` required CI check (blocks the merge) and `/ship` refuses in-window; the airtight fix is the worker migration (the run lives off the web service, so web deploys can't touch it). The catalog-doubling lengthened the run, so widen the window if it grows.

## Subagents

13 specialized agents in `.claude/agents/`. Full catalog: `.claude/agents/README.md`. Auto-discovered at session start.

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

Agents propose patches/findings; the main agent handles git ops after user review.

## API Endpoints (top-level)

All routes require `Authorization: Bearer <token>` unless noted. See `backend/src/routes/ROUTES.md` for body shapes, validation rules, and the full reference.

```
GET    /api/companies, /api/companies/{id}, /api/catalog, /api/jobs
POST   /api/companies/check, /api/companies, /api/subscriptions, /api/favorites/{jobId}, /api/help, /api/issues
DELETE /api/companies/{id}, /api/subscriptions/{companyId}, /api/favorites/{jobId}
GET    /api/favorites/jobs                   (user's starred jobs, pre-joined with company — backs /jobs?filter=starred)
GET    /api/preferences, PUT /api/preferences
GET    /api/compensation, /api/compensation/{companyName}
GET    /api/feed, /api/feed/companies        (PUBLIC — no auth — drives the JobFeed home at /)
GET    /api/admin/* (requires ADMIN_EMAIL)
GET    /api/admin/email-status               (proxies Resend list-emails API; optional ?email= filter)
GET    /api/admin/weekly-digest/preview      (returns { data, linkedinPost, emailHtml } — no send)
POST   /api/admin/weekly-digest/send         (fires the weekly LinkedIn-draft email immediately)
POST   /api/admin/users/send-magic-link      (admin JWT; body: {email}; sends fresh magic link to existing user; powers stuck-user recovery + DEV-14 reminder system)
POST   /api/interviews/token                 (ADMIN ONLY; mints a short-lived ElevenLabs signed URL + per-call prompt overrides for the voice mock-interview)
POST   /api/interviews/evaluate              (ADMIN ONLY; scores a transcript with 3 LLMs in parallel; accepts the ElevenLabs conversation_id)
GET    /api/cron/trigger (requires CRON_SECRET; see JOBS.md)
GET    /api/cron/weekly-digest (requires CRON_SECRET; see JOBS.md)
GET    /api/cron/self-check-suspects (requires CRON_SECRET; feeds the DEV-41 daily self-check remote routine — it has no DB access; see JOBS.md)
GET    /api/cron/run-health (requires CRON_SECRET; DEV-57: reports whether today's daily run reached completion (reads cron_runs) — polled by the out-of-band GitHub-Actions watchdog; see JOBS.md)
POST   /api/cron/email-only (requires CRON_SECRET; DEV-58: re-sends the daily alert from already-scraped seen_jobs WITHOUT re-scraping — DRY-RUN by default, ?dryRun=false to actually send, refuses double-send unless ?force=true; see JOBS.md)
POST   /api/cron/scrape-only (requires CRON_SECRET; DEV-52: scrapes companies + reconciles seen_jobs with NO email — body {companyIds?}; default = is_active companies with 0 seen_jobs. Decouples scraping from the daily email; see JOBS.md)
POST   /api/cron/rapidapi-blocked (requires CRON_SECRET; DEV-51: on-demand RapidAPI restore of scrape_blocked employers — NOT date-gated, for manual testing once quota resets. The daily cron runs the SAME pull auto-gated to RAPIDAPI_ACTIVATION_DATE (default 2026-07-01). No email; see JOBS.md)
```

**`POST /api/subscriptions`** (subscribe to companies; body `{company_ids}`) fires a fire-and-forget background scrape (`scrapeCompaniesByIds` in dailyCheck.ts, NO email) for any just-subscribed company that has zero jobs and isn't `scrape_blocked`, capped at 25 — so a freshly-added catalog company populates within minutes instead of waiting for the 14:00 cron. The daily cron is the guaranteed backstop, and the scrape is idempotent, so a partial run self-heals. Response includes `populating: <count>`. (DEV-54, 2026-05-31.)

The whole `/api/interviews/*` router is `requireAdmin` (`req.userEmail === ADMIN_EMAIL`) — ElevenLabs minutes cost real money, so the voice mock-interview is admin-gated for now. The planned "how you sounded" delivery-analysis endpoint is DEV-45.

`/api/feed` filters: `industry`, `level`, `region`, `city`, `company`, `min_comp`, `sort`, `include_closed`. Region filter is server-side; sort=company uses fetch-and-sort in Node because PostgREST silently ignores nested-table order. Comp tier enriched per-job from `comp_cache`.

**Frontend routes (after the 2026-05-20 home swap, PR #48):** `/` is the JobFeed home (auth-aware: unauth gets hero + public feed; authed gets Dashboard). `/welcome` is the old marketing landing (permanent backup, can roll back swap). `/companies` is the authed Tracked Companies view (Dashboard direct). `/new-home` deleted; permanent 308 redirect → `/` in `frontend/next.config.ts`. **`/interview-test`** is the admin-only voice mock-interview page (non-admins get Access Denied).

## Database Schema

| Table | Notes |
|---|---|
| `companies` | Shared catalog. `is_active` = subscriber_count > 0. `auto_disabled` + `consecutive_failure_count` for self-healing on errors. `is_verified` + `is_verified_zero` + `consecutive_zero_days` (2026-05-28) for self-healing on silent zeros — see auto-verify-zeros rules in JOBS.md / dailyCheck.ts. **`is_verified_zero` is now auto-managed**: cron auto-sets it after 7 days of zero from a verified scraper, auto-flips back to false when >0 PMs reappear. Don't toggle manually. `industry` (enum-shaped text, drives email recommendations + /new-home filter). `min_relevant_seniority` (early/mid/director — filters daily email + feed; FAANG=mid by default). `consecutive_healthy_zero_days` (2026-05-29, PR #98) is SEPARATE from `consecutive_zero_days`: it counts days a *healthy* source (totalScanned > 0) returns 0 PMs, and after 2 it removes stale "zombie" jobs — don't conflate the two counters. CASCADE deletes jobs. **`scrape_blocked`** (2026-05-30, #130/#134): employer blocks automated access (Meta/Tesla/TikTok/Wayfair) — UI shows a "Scraping blocked" badge instead of "0 roles" and they're non-addable in the catalog (existing trackers keep them). Roles restored via the Fantastic.jobs RapidAPI feed (`RAPIDAPI_KEY` on Railway; see MEMORY topic project-rapidapi-jobs-source). **SHIPPED 2026-05-31 (#144, DEV-51):** `backend/src/scraper/rapidApiBlocked.ts` auto-pulls them on/after `RAPIDAPI_ACTIVATION_DATE` (default July 1, when free quota resets); on success sets `platform_type='rapidapi_linkedin'` + clears `scrape_blocked`. Dormant/no-op before then. **`sub_industry`** (2026-05-31, #140): catalog sub-category for the add-by-category UI; `tech` splits into ai / dev-tools / saas / big-tech / security / consumer-apps. |
| `seen_jobs` | Status: active → removed → archived (60 days). `last_removed_at` (2026-05-19) stamped on active→removed; used for 2-week return rule. Unique on (company_id, job_url_path). |
| `user_subscriptions` | Links users to tracked companies. UNIQUE(user_id, company_id). |
| `user_job_favorites` | Star icons on jobs pages. UNIQUE(user_id, seen_job_id). |
| `user_new_company_submissions` | Rate limit: 10/user, admin bypass. |
| `user_preferences` | email_frequency: daily/weekly/off. |
| `comp_cache` | levels.fyi cache, 24hr TTL. No RLS. |
| `recommendation_history` | Actual columns: `(id, company_id, shown_date, industry, created_at)` — **no `user_id`**, so the 7-day rotation is GLOBAL (a company shown to anyone recently is excluded for everyone), not per-user. Cron writes after picking email recommendations. |
| `weekly_lead_history` | `(id, week_ending, angle, headline, art_style, created_at)`. Backend-only, no RLS. The weekly digest logs the chosen lead angle + banner art style each Friday send; `computeWeeklyDigest` reads the last 2 rows so the rotating "My take" lead + image style don't repeat week to week. See JOBS.md (DEV-43). |
| `scrape_issues`, `help_submissions` | Bug-reporting tables. |
| `scraper_events` | Audit log of self-healing actions. See JOBS.md. |
| `security_snapshots` | Weekly npm audit snapshot. See JOBS.md. |
| `interview_sessions` | Voice mock-interview: raw transcript + 3-model evals (JSONB) per session; wiped 7 days after creation. `elevenlabs_conversation_id` (PR #95) stored so audio can be re-fetched for delivery analysis (DEV-45). |
| `interview_user_summary` | Rolling per-user interview summary; survives the 7-day wipe and is injected into the next session's agent prompt (multi-session memory). |
| `email_send_log` | DEV-49 (#128): per-run daily-email counts (eligible / built / sent) backing the L5 baseline drop tripwire in dailyCheck.ts. RLS-on. UNIQUE(run_date). |
| `cron_runs` | DEV-57 (#after the 2026-05-31 P0): daily-run lifecycle — `started_at` written at the TOP of the run, `completed_at`/`status` at the end, so a run killed mid-way (e.g. a deploy SIGTERM) leaves `completed_at IS NULL`. Drives `GET /api/cron/run-health` + the out-of-band watchdog. RLS-on, service-role only. UNIQUE(run_date, kind). |

Indexes, exact column lists, and partial-index details live in the migrations + JOBS.md/ROUTES.md sidecars as needed.

**Migrations live in `backend/migrations/YYYY-MM-DD-description.sql`** (folder added 2026-05-19). Run via Supabase MCP `apply_migration` or paste into SQL Editor.

## CI Workflows (.github/workflows/)

- **`auth-template-check.yml`** (DEV-12) — on every PR touching auth code + nightly at 15:05 UTC. Fetches deployed Supabase Auth config via Management API. Fails build if templates don't use `{{ .TokenHash }}` format documented in AUTH.md. **Requires `SUPABASE_PAT_CI` GitHub repo secret.**
- **`daily-code-audit.yml`** (DEV-11) — daily at 15:00 UTC. Heuristic scan of last 24h diff for 4 risk patterns (auth template anti-pattern, cookie-drop, JWT-in-source, unguarded routes). Emails admin only on findings. Uses `RESEND_API_KEY` secret (NOTE: this secret was actually MISSING until 2026-06-01, so this alert was silently dead until then — set during the DEV-57 work).
- **`cron-watchdog.yml`** (DEV-57) — out-of-band daily cron watchdog at 16:00 + 17:00 UTC. Hits `GET /api/cron/run-health` (CRON_SECRET); if today's daily run did NOT reach completion (or the backend is unreachable), emails admin via Resend. The one alarm that lives OUTSIDE the Railway process, so a run that never finished (deploy kill / OOM / hang) is caught. **Requires `CRON_SECRET` + `RESEND_API_KEY` GitHub repo secrets** (both set 2026-06-01).
- **`cron-window-guard.yml`** (DEV-57) — required status check; FAILS on any PR to main evaluated during the daily-cron window (13:55-16:00 UTC) so a deploy can't land mid-run. Belt-and-suspenders with the worker migration.
- **`alerting-liveness.yml`** (DEV-59) — monthly (1st, 12:00 UTC) + on-demand. Fails loudly if any required GitHub secret (`RESEND_API_KEY` / `CRON_SECRET` / `SUPABASE_PAT_CI`) is missing, AND sends a test email via Resend so the *absence* of the monthly "OK" email is itself the signal the alert pipe is down. Closes the meta-gap (a code scan can't see a missing secret; an alert that only fires "on findings" can't tell "clean day" from "I'm dead") that left `RESEND_API_KEY` silently unset and the daily-code-audit email dead.
- **`typecheck.yml`** (DEV-62) — backend + frontend `tsc --noEmit` on every PR; the `backend` + `frontend` contexts are REQUIRED status checks on the `main` ruleset (16381419), so a PR that breaks the typecheck can't merge/auto-deploy. Deterministic + no runtime env needed (the full build is still exercised by the Vercel/Railway preview deploys).

## Feedback Workflow

User feedback (`POST /api/help`, `POST /api/issues`) files Linear issues in the User Feedback team (USRFDBK-N) + emails admin with Linear URL inline. Legacy `help_submissions` / `scrape_issues` tables hold pre-2026-05-22 history only — no new rows written. **Required env var: `LINEAR_API_KEY`** (Personal API Key with Full access; set on Railway).

## Conventions

- **Always use `listAllUsers()` from `backend/src/lib/listAllUsers.ts`**, never `supabase.auth.admin.listUsers()` directly. The raw call defaults to `perPage=50` — on 2026-05-20 this silently paginated the 16 oldest users (including admin) out of the daily email iteration. The helper does proper cursor pagination (`PAGE_SIZE=1000`, `MAX_PAGES=100` safety cap).
- **`/api/admin/email-status` is the diagnostic for "did user X receive email Y?"** Queries Resend's `/emails` API directly. We do NOT log per-recipient sends to our DB (PII concern — user prefers email metadata stays in Resend).

## Performance Rules

**Follow automatically on ALL changes:**
1. Audit for N+1 queries — use `Promise.all()` for independent queries, batch operations
2. Parallel over sequential for independent DB calls
3. Minimize round-trips — one batch query over N individual
4. Check if new WHERE/ORDER BY columns need indexes
5. Don't re-fetch data already available — pass via props/context

## Security (cross-cutting)

- **Headers** in `frontend/next.config.ts`. **CSP** dynamic from env vars.
- **Input validation**: UUID regex on IDs, HTTPS-only URLs, LinkedIn blocked, SSRF protection (no private IPs).
- **JWT verification**: HS256 pinned, validates audience + issuer. Fails closed at boot in prod if `SUPABASE_JWT_SECRET` missing. See AUTH.md.
- **Cookies HttpOnly enforced** — see AUTH.md for the `/api/auth/token` bridge pattern. Do not override.
- **Cron / shared-secret tokens**: use `safeCompareSecret()` (constant-time). Reuse for future Stripe/Twilio webhook signature verification.
- **Body limits**: 256kb global. Per-route caps documented in ROUTES.md.
- **Data isolation**: every user-scoped read endpoint MUST check subscription before returning. Pattern in ROUTES.md.
- **Never trust client-supplied `user_id` or `platform_config`** — both derive server-side.
- **Security log**: `docs/security-log.md` (gitignored) — running record of audits, fixes, deferred items.
- **Audit framework**: three parallel review agents (auth flow / data isolation / infra), not one general pass.

## Cross-cutting Gotchas

- **Supabase DDL**: Cannot run CREATE/ALTER TABLE via supabase-js. Use SQL Editor in dashboard or MCP `apply_migration`.
- **Supabase `listUsers()` defaults to perPage=50.** Bit us on 2026-05-20 — admin (oldest user) silently dropped out of daily email. Use the `listAllUsers()` helper (see Conventions above).
- **PostgREST nested-table ordering is silently ignored.** `order("seen_jobs.something", { foreignTable: "..." })` AND `{ referencedTable: "..." }` both no-op. For sort-by-nested, fetch and sort in Node (with a cap).
- **PostgREST OR clause delimiter is comma.** Values containing commas must be wrapped in double-quotes. `or=field.eq."Holmdel, NJ"` not `or=field.eq.Holmdel, NJ`.
- **`like` vs `ilike` in PostgREST is case-sensitivity, not glob.** `, NE` case-insensitive matches "Ne" in "New Jersey". For abbreviation matching use `like` (case-sensitive) + a country/state anchor.
- **NEXT_PUBLIC_ env vars**: Baked at build time. Must redeploy after changing in Vercel. `NEXT_PUBLIC_LOGO_DEV_TOKEN` is a publishable key (safe to expose, like Stripe pk).
- **Prod-only guards key off `RAILWAY_ENVIRONMENT_NAME === "production"` (auto-injected by Railway), NOT `NODE_ENV`** (DEV-47, 2026-05-30). The Sentry boot/daily liveness probe + `auth.ts`'s fail-closed + JWKS boot probe were once gated on `NODE_ENV`, which sat unset on Railway for months and made them dead code — a manually-set var that can be cleared can't guard the thing that detects silent breakage; the platform-injected var can't. `index.ts` logs the resolved value at boot (`[boot] RAILWAY_ENVIRONMENT_NAME=... → prod-only guards ACTIVE/INACTIVE`) so a future env rename is visible in <60s. `NODE_ENV=production` is still set on Railway but is now used only for the Sentry `environment` tag (a label, not a guard). Caveat: these guards now fire ONLY on the prod service, not on Railway PR/preview environments (different env name even though Base=Production).
- **Interview LLM/voice gotchas**: Gemini needs the PAID tier (`GEMINI_MODEL=gemini-2.5-pro` on Railway; free tier 503s/429s "prepayment credits depleted") — keep a model-fallback/backoff chain even on paid. Hume AI sunsets 2026-06-14 (do not build on it). ElevenLabs audio retention must be ON or `has_audio=false`.
- **Sentry (and PostHog) fail SILENT on a missing/wrong key.** `Sentry.init({ dsn: undefined })` and `capturePosthogEvent` with no key both no-op by design, so a dead pipeline looks identical to a healthy one (empty dashboard = "no errors" not "we're blind"). `SENTRY_DSN` was added in code 2026-02-11 but never set on Railway → backend reporting was dead 3.5 months (DEV-27). Required vars are now documented in `backend/.env.example`, and `backend/src/lib/sentryHealth.ts` actively probes the Sentry ingest endpoint at boot + daily (emails admin on failure). `frontend/src/lib/sentryHealth.ts` (DEV-39, 2026-05-30) does the same at Vercel server boot for the frontend DSNs, alerting via PostHog `observability.sentry_unhealthy` (no admin email — Vercel has no Resend wiring); `NEXT_PUBLIC_SENTRY_DSN` is required (alerts if missing/broken), `SENTRY_DSN` is probed only when set. Frontend needs `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` on Vercel; backend needs `SENTRY_DSN` + `POSTHOG_API_KEY` on Railway. A truncated DSN is valid-looking but points at a nonexistent project and is dropped silently — paste the FULL value.
- **Supabase SSR + Next.js redirects.** `NextResponse.redirect()` does NOT inherit cookies from supabaseResponse. Must copy cookies onto every redirect or session terminates. See `redirectPreservingSession()` helper in `frontend/middleware.ts`.
- **CSP img-src must allowlist logo CDNs.** `https://icons.duckduckgo.com` + `https://img.logo.dev` are both needed. Lives in `frontend/next.config.ts`.
- **Cloudflare proxy**: Must be OFF (grey cloud) for Vercel/Railway custom domains.
- **Vercel project name**: `new-job-alert-tool` (not `frontend`).
- **Windows sleep**: Use `powershell -command "Start-Sleep -Seconds N"` (not `timeout`).
- **Git CRLF**: `git config core.autocrlf input` to suppress warnings.
- **Local .env**: Placeholder keys only. Production keys on Railway.

Subsystem-specific gotchas live in the corresponding sidecar. Don't add them here.
