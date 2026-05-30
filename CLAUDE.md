# NewJobAlertTool — Project Context

## Autonomy Rules

- **DO NOT ask to run commands.** Just run them. The user is often AFK.
- **DO NOT leave manual steps for the user.** If it can be done via API, CLI, or script — do it yourself.
- **Push code, deploy, clean DB, re-add companies — all autonomously.** Full access granted.
- **Execute end-to-end** including deployment and verification. Come back with proof it works, not "next steps."
- **Never ask before pushing — to a feature branch.** `main` is branch-protected. Push to `claude/<slug>` branches and open PRs with `gh pr create`. The user merges via GitHub.
- **Session start health check:** At the start of every conversation, query the `companies` table for scrape failures (`last_check_status` containing 'error' or 'quality: 0/100'). If any exist, investigate and fix them immediately before doing anything else. Don't report failures — fix them, push, and show proof.

## Sidecar Docs (READ BEFORE EDITING)

These folders have a `.md` sidecar next to the code. **You MUST `Read` the sidecar before any `Edit`, `Write`, or new file in that folder, once per session.** Not optional. Not "if relevant." A PreToolUse hook in `.claude/settings.json` enforces this and will block the tool call if you skip it.

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
GET    /api/cron/trigger (requires CRON_SECRET; see JOBS.md)
GET    /api/cron/weekly-digest (requires CRON_SECRET; see JOBS.md)
```

`/api/feed` filters: `industry`, `level`, `region`, `city`, `company`, `min_comp`, `sort`, `include_closed`. Region filter is server-side; sort=company uses fetch-and-sort in Node because PostgREST silently ignores nested-table order. Comp tier enriched per-job from `comp_cache`.

**Frontend routes (after the 2026-05-20 home swap, PR #48):** `/` is the JobFeed home (auth-aware: unauth gets hero + public feed; authed gets Dashboard). `/welcome` is the old marketing landing (permanent backup, can roll back swap). `/companies` is the authed Tracked Companies view (Dashboard direct). `/new-home` deleted; permanent 308 redirect → `/` in `frontend/next.config.ts`.

## Database Schema

| Table | Notes |
|---|---|
| `companies` | Shared catalog. `is_active` = subscriber_count > 0. `auto_disabled` + `consecutive_failure_count` for self-healing on errors. `is_verified` + `is_verified_zero` + `consecutive_zero_days` (2026-05-28) for self-healing on silent zeros — see auto-verify-zeros rules in JOBS.md / dailyCheck.ts. **`is_verified_zero` is now auto-managed**: cron auto-sets it after 7 days of zero from a verified scraper, auto-flips back to false when >0 PMs reappear. Don't toggle manually. `industry` (enum-shaped text, drives email recommendations + /new-home filter). `min_relevant_seniority` (early/mid/director — filters daily email + feed; FAANG=mid by default). CASCADE deletes jobs. |
| `seen_jobs` | Status: active → removed → archived (60 days). `last_removed_at` (2026-05-19) stamped on active→removed; used for 2-week return rule. Unique on (company_id, job_url_path). |
| `user_subscriptions` | Links users to tracked companies. UNIQUE(user_id, company_id). |
| `user_job_favorites` | Star icons on jobs pages. UNIQUE(user_id, seen_job_id). |
| `user_new_company_submissions` | Rate limit: 10/user, admin bypass. |
| `user_preferences` | email_frequency: daily/weekly/off. |
| `comp_cache` | levels.fyi cache, 24hr TTL. No RLS. |
| `recommendation_history` | (user_id, company_id, sent_at). Cron writes after picking email recommendations; excludes companies shown in last 7 days. |
| `scrape_issues`, `help_submissions` | Bug-reporting tables. |
| `scraper_events` | Audit log of self-healing actions. See JOBS.md. |
| `security_snapshots` | Weekly npm audit snapshot. See JOBS.md. |

Indexes, exact column lists, and partial-index details live in the migrations + JOBS.md/ROUTES.md sidecars as needed.

**Migrations live in `backend/migrations/YYYY-MM-DD-description.sql`** (folder added 2026-05-19). Run via Supabase MCP `apply_migration` or paste into SQL Editor.

## CI Workflows (.github/workflows/)

- **`auth-template-check.yml`** (DEV-12) — on every PR touching auth code + nightly at 15:05 UTC. Fetches deployed Supabase Auth config via Management API. Fails build if templates don't use `{{ .TokenHash }}` format documented in AUTH.md. **Requires `SUPABASE_PAT_CI` GitHub repo secret.**
- **`daily-code-audit.yml`** (DEV-11) — daily at 15:00 UTC. Heuristic scan of last 24h diff for 4 risk patterns (auth template anti-pattern, cookie-drop, JWT-in-source, unguarded routes). Emails admin only on findings. Uses existing `RESEND_API_KEY` secret.

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
- **Sentry (and PostHog) fail SILENT on a missing/wrong key.** `Sentry.init({ dsn: undefined })` and `capturePosthogEvent` with no key both no-op by design, so a dead pipeline looks identical to a healthy one (empty dashboard = "no errors" not "we're blind"). `SENTRY_DSN` was added in code 2026-02-11 but never set on Railway → backend reporting was dead 3.5 months (DEV-27). Required vars are now documented in `backend/.env.example`, and `backend/src/lib/sentryHealth.ts` actively probes the Sentry ingest endpoint at boot + daily (emails admin on failure). Frontend needs `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` on Vercel; backend needs `SENTRY_DSN` + `POSTHOG_API_KEY` on Railway. A truncated DSN is valid-looking but points at a nonexistent project and is dropped silently — paste the FULL value.
- **Supabase SSR + Next.js redirects.** `NextResponse.redirect()` does NOT inherit cookies from supabaseResponse. Must copy cookies onto every redirect or session terminates. See `redirectPreservingSession()` helper in `frontend/middleware.ts`.
- **CSP img-src must allowlist logo CDNs.** `https://icons.duckduckgo.com` + `https://img.logo.dev` are both needed. Lives in `frontend/next.config.ts`.
- **Cloudflare proxy**: Must be OFF (grey cloud) for Vercel/Railway custom domains.
- **Vercel project name**: `new-job-alert-tool` (not `frontend`).
- **Windows sleep**: Use `powershell -command "Start-Sleep -Seconds N"` (not `timeout`).
- **Git CRLF**: `git config core.autocrlf input` to suppress warnings.
- **Local .env**: Placeholder keys only. Production keys on Railway.

Subsystem-specific gotchas live in the corresponding sidecar. Don't add them here.
