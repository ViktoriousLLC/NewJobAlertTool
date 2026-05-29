# Jobs / Cron Subsystem — READ BEFORE EDITING

This sidecar collects everything needed before touching `backend/src/jobs/dailyCheck.ts`, `securityCheck.ts`, or anything in the cron pipeline. Scraper-specific knowledge lives in `backend/src/scraper/SCRAPER.md` — read that too if your change touches scraping behavior.

## Daily Cron

- **Trigger**: Railway Cron, 14:00 UTC daily, hits `GET /api/cron/trigger` with `Authorization: Bearer $CRON_SECRET`.
- **Must `await runDailyCheck()`** — Railway auto-sleep kills fire-and-forget.
- **Concurrency guard**: `dailyCheckRunning` flag prevents overlapping runs.
- **No in-process schedulers** (node-cron etc.) — would cause duplicate runs alongside Railway Cron.

### Optional query params

- `?skipEmails=true` — skips per-user alerts (safe for manual re-runs)
- `?forceMondayDigest=true` — forces the Monday-style weekly digest on any day

## Weekly LinkedIn-Draft Digest (PR #52, added 2026-05-22)

**Friday auto-trigger inside `runDailyCheck()`.** When UTC day-of-week === 5, after the consolidated admin digest, `sendWeeklyDigest()` from `backend/src/jobs/weeklyDigest.ts` fires. Owned by the existing 14:00 UTC daily Railway cron — no separate schedule.

- **Module**: `backend/src/jobs/weeklyDigest.ts` — exports `computeWeeklyDigest`, `renderLinkedInPost`, `renderEmailHtml`, `sendWeeklyDigest`.
- **Recipient**: `ADMIN_EMAIL` only (this is editorial content for Vik, not subscribers).
- **Subject**: `𝗪𝗘𝗘𝗞𝗟𝗬: LinkedIn Job Summary for <Mon DD>` (Unicode-bold "WEEKLY" prefix; falls back gracefully to plain caps in clients that don't render it). Updated 2026-05-23.
- **Body**: copy-paste-ready LinkedIn post + raw-data tables (industry breakdown, top 10 by volume, AI roles by company) + an Appendix with 6 additional cuts (top cities + remote share; seniority split; top-paying companies hiring; surge vs 4-week trailing average; daily posting velocity).
- **Data window**: last 7 days of `seen_jobs` where `status = 'active'` AND `is_baseline = false` joined to `companies`.
- **AI title regex**: `/\b(AI|ML|GenAI|LLM|Machine Learning|Generative|Agentforce|Agentic|Voice AI|Copilot|GPT)\b/i`. Conservative; misses titles that only imply AI.
- **Expected fire time on Fridays**: ~14:25-14:35 UTC (after scrape + per-user alerts + comp_cache refresh + admin digest).
- **Manual triggers**: `?forceWeeklyDigest=true` on `/api/cron/trigger`, `/api/cron/weekly-digest` (CRON_SECRET), `POST /api/admin/weekly-digest/send` (admin JWT), `GET /api/admin/weekly-digest/preview` (admin JWT, no send).
- **LinkedIn post structure** is locked editorially (approved 2026-05-22): intro → banking takeaway with industry counts → top 10 companies by volume → top company example role areas → top 5 AI-PM-hiring companies with titles → reader question close. When editing the post text in `renderLinkedInPost()`, read `docs/Viks Voice/vik_voice_style_guide.md` first.

## Daily Self-Check Agent (PR #20+)

Separate remote agent fires daily at 14:30 UTC via `CronCreate`. Reads:
- `companies` for new failures + watch list + auto-disabled + unverified-zeros with subs > 0
- `scraper_events` for last 24h
- `security_snapshots` delta on Mondays only
- cross-domain stealth rejection events

Investigates each issue (spawns scraper-doctor), pushes curated report only if actionable.

## Self-Healing Pipeline (refer to SCRAPER.md for detail)

Three-tier recovery → auto-disable threshold (7 days) → Monday watch-list probe → re-enable. Tracked in `scraper_events` table for the weekly digest's self-heal log.

### Silent-Zero Self-Management (PR #90, added 2026-05-28)

Companies returning 0 PMs no longer require manual admin confirmation. Per-company state is tracked via the `consecutive_zero_days` column on `companies`; three rules run in the per-company loop after each scrape:

- **Auto-verify zero (AUTO_VERIFY_ZERO_DAYS = 7)**: If `is_verified=true` and PMs have been 0 for 7 consecutive days, set `is_verified_zero=true` and log `auto_verified_zero` to `scraper_events`.
- **Auto-disable silent zero (SILENT_ZERO_DISABLE_DAYS = 14)**: If `is_verified=false` and PMs have been 0 for 14 consecutive days, set `auto_disabled=true` and log `auto_disabled` to `scraper_events`. Saves cron cycles; Monday probe still gets a chance.
- **Auto-flip back**: Any scrape returning >0 PMs resets `consecutive_zero_days=0` AND, if `is_verified_zero` was true, flips it back to false. Logs `auto_unverified_zero`. **This is the safety net** — there is no permanently-silenced state; every scrape re-evaluates.

The admin digest's "Unverified zeros" section was retired with this PR. `unverifiedZeros` field removed from `AdminDigestInput` and `buildDigestAnalysis`. Cross-cutting pattern `platform_zero_cluster` also removed (admin no longer triages, so no human needs the pattern hint).

**`is_verified_zero` is now ONLY read by the admin email plumbing and the cron itself.** It has no user-facing effect — jobs flow into `seen_jobs` and out to users regardless of this flag. Worst-case bug in the auto-flip-back code is "admin email stays quieter than it should"; never "users miss jobs."

### Stale-Job Anti-Flap Removal (added 2026-05-29)

Fixes a class of zombie listing surfaced by a workflow sweep on 2026-05-29: companies whose PM roles had been delisted were still shown as `active` to subscribers indefinitely (e.g. Cloudflare's "Product Manager Intern" gone from the board but shown to 17 subs; Plaid's 7 Feb listings shown to 20 subs after Plaid migrated off Lever).

Root cause: the old removal guard skipped removal whenever `jobs.length === 0 && existingActiveCount > 0`, conflating "scrape source broke" with "source healthy, just 0 PMs." The fix splits those using `scrapeStats.totalScanned` (the same source-alive signal the stealth recovery tier uses):

- **Source failed / empty (`totalScanned === 0`)**: preserve existing active jobs indefinitely (original safety guard — never let a broken scrape wipe real listings). Does NOT count toward the staleness buffer.
- **Source healthy but 0 PMs (`totalScanned > 0`)**: the roles are genuinely gone. Mark them removed, but only after `STALE_REMOVAL_BUFFER_DAYS = 2` consecutive healthy-zero days, so one odd scrape can't briefly drop real jobs from feeds.

The buffer is tracked by the new `companies.consecutive_healthy_zero_days` column (migration `2026-05-29-add-consecutive-healthy-zero-days.sql`), reset to 0 on any run that finds PMs or sees a failed source. It is deliberately SEPARATE from `consecutive_zero_days`: the preserved zombie rows kept the active count > 0, which pinned `consecutive_zero_days` at 0 and silently defeated the is_verified_zero / auto-disable self-heal above. Once the buffer elapses and the stale rows are removed, the active count hits 0 and the existing `consecutive_zero_days` logic resumes normally (so a fully-delisted company auto-verifies-zero ~2 days later than before, not never).

Also relabels the 0-job status string: a legitimately-empty scrape is now `success (0 PMs)` (healthy source) or `success (0 jobs from source)` (empty/failed source) instead of the misleading `success (quality: 0/100)`, which had been tripping the session-start health-check grep on healthy companies.

**Coverage / scraper instrumentation.** `totalScanned` is a reliable "source alive" signal ONLY for **full-board scrapers that throw on a failed fetch** — they pull every posting, filter to PMs in-code, and a 0 count then provably means "board reachable, 0 PMs." Those are: greenhouse, greenhouse_departments, ashby, workday (pre-existing) plus **lever and smartrecruiters** (instrumented here). That covers ~204 of 247 catalog companies. The remaining platforms intentionally fall through to the safe "preserve" branch (no regression, just no auto-removal of their zombies yet):

- **Keyword-search APIs** (amazon, icims-api, oracle_hcm): they ask the source for "product manager" jobs and never see the full board, so a 0 result can't be distinguished from a broken-but-200 response by count alone.
- **Error-swallowing / DOM scrapers** (eightfold returns `[]` on a non-ok page instead of throwing; generic Puppeteer fallback, intuit, icims Puppeteer): a 0 count is genuinely ambiguous between "empty" and "selector broke," so preserve-conservative is the correct default.

A clean fix for the keyword-search group needs a separate `sourceReachable: boolean` on `ScrapeStats` set on any successful HTTP 200 (regardless of job count), rather than a count. Tracked as a follow-up (DEV-33 [stale-removal coverage for keyword-search scrapers]).

### Proactive Auto-Fix Layer (DEV-19, added 2026-05-26)

**Where:** `backend/src/jobs/autoFixRules.ts` (rule catalog) + `dailyCheck.ts` per-company loop (calls `tryProactiveAutoFix(company, supabase)` before each scrape).

**Purpose:** Catch config-state failures BEFORE they throw. Each rule is a pure function of `company.platform_type` + `platform_config` + `careers_url`. If a rule's `detect()` returns true, its `fix()` runs an UPDATE on the companies row and the local company state is refreshed so the same-day scrape uses the corrected config.

**Current rules:**
- `phenom_basedomain_missing_https` — prepends `https://` when `platform_config.baseDomain` lacks a scheme. Catches the 2026-05-26 Eli Lilly class of bug (5 days of failure before manual intervention).

**Adding a rule:** Append to `RULES` in `autoFixRules.ts`. Each rule has `id`, `description`, `detect(company)`, `fix(company, supabase)`. Detect must be pure (no network calls). Fix returns `{ ok, message, before, after }`.

**Audit log:** Successful fixes write to `scraper_events` with `event_type='auto_fix_applied'`. Visible in the Monday digest's self-heal log + the same-day digest's dedicated "🤖 Auto-fixed today" section.

**Not yet implemented:** reactive (error-message-based) rules. Today the proactive layer only catches config-state issues detectable without running the scraper. If you need to fix-and-retry on a caught exception, that's a separate `autoFixReactiveRules.ts` module — file a follow-up.

## Email Delivery

- **Per-user alerts**: filtered by subscriptions + `user_preferences.email_frequency`. Batch send via `resend.batch.send()` (100/call, 1s delay).
- **From addresses**:
  - `alerts@newpmjobs.com` (API)
  - `noreply@newpmjobs.com` (magic links via SMTP)
- **Resend plan**: PAID **Transactional Pro = 50,000 emails/month** ($20/mo). NOT the free tier. Quota is effectively never the constraint at current volume (~75 daily recipients). The old "free tier = 100/day" note here was stale and caused a misdiagnosis 2026-05-29. The "100/call" above is the batch-API page size, not a daily cap. SMTP + API share the monthly budget.
- **Subscription fetch must paginate**: any global `user_subscriptions` select MUST loop with `.range()` over a stable `.order("id")` — PostgREST caps a single select at 1000 rows. An unbounded select in `sendPerUserAlerts` silently dropped ~43% of subscribed users (all recent signups) from the daily email once the table passed 1000 rows. Fixed 2026-05-29. Same footgun class as the `listUsers()` perPage=50 bug.
- **API key**: only in Railway env vars; empty locally.

## Consolidated Admin Digest

`sendAdminDigest()` in `dailyCheck.ts` — replaces three previous admin emails (failures, quality report, batch-send failures) with one.

- **Daily**: fires ONLY if action items present (failed scrapes, watch list, auto-disabled, subscribed company dropped to 0, email send failures).
- **Monday UTC**: always fires with system health + past-7-day self-heal log queried from `scraper_events` + npm-audit security check.
- **Most days = no admin email.**

(Tuesday duplicate was removed PR #17 — daily self-check agent took over the safety-net role.)

## Sentry Liveness Probe (DEV-27, added 2026-05-29)

First step inside `runDailyCheckInner()` (prod only). Calls `reportSentryHealth("daily")` from `backend/src/lib/sentryHealth.ts`, which POSTs a synthetic event to the Sentry ingest endpoint and checks the HTTP response.

- **Why:** `Sentry.init()` no-ops silently on a missing/malformed/wrong-project DSN. Backend error reporting was dead Feb–May 2026 with no signal; a later DSN re-add was truncated (valid-looking, wrong project) and also dropped silently. Probing the ingest endpoint is the only way to catch all three modes.
- **On failure:** emails `ADMIN_EMAIL` via `sendAdminEmail()` ("Sentry is not receiving events") + emits PostHog `observability.sentry_unhealthy`. The alert channel is deliberately NOT Sentry (it can't report its own outage).
- **Boot mirror:** `index.ts` runs the same probe fire-and-forget at startup (console + PostHog, no email) so a bad deploy surfaces in ~60s.
- **Probe events** all share fingerprint `["sentry-dsn-liveness-probe"]` so they collapse into one ignorable Sentry issue (level info, tag `phase:liveness-probe`). Safe to set that issue to "ignore" in Sentry.

## Security Check (Weekly)

`backend/src/jobs/securityCheck.ts` — runs `npm audit --json --omit=dev` every Monday.

- Snapshots to `security_snapshots` table.
- Diffs against previous Monday's snapshot.
- Surfaces new/resolved vulns in admin digest.
- Failures don't break the cron — silently skip section on error.

## Quality Eval

`backend/src/scraper/dailyEval.ts` (simplified 2026-04-26) — flags only actionable issues:
- Sudden spikes/drops (>100%/50% change AND >10 absolute)
- Zero jobs for subscribed companies
- First-scrape results

Removed noisy checks (absurd job counts, high non-US ratio, low quality scores). Critical issues also go to Sentry.

## Tables Owned

- `scraper_events` — `id, company_id, company_name, event_type (auto_remediation|stealth_recovery|auto_disabled|auto_re_enabled), details (jsonb), created_at`. Audit log of self-healing actions. Queried by weekly digest.
- `security_snapshots` — `id, snapshot_date, total_vulns, by_severity (jsonb), vuln_fingerprints (jsonb)`. Weekly npm audit snapshot.

## Per-company Seniority Filter

`companies.min_relevant_seniority` (added 2026-05-19) filters which PM jobs from a given company appear in the **daily alert email + the recommendation section**. Jobs still land in `seen_jobs` and the public feed (filtered by the same threshold there too).

| Value | Effect |
|---|---|
| NULL | Show all PM jobs (default) |
| `early` | Same as NULL (show all) |
| `mid` | Skip junior/early-level jobs |
| `director` | Only show director+ jobs |

Initial backfill: FAANG-tier brands (Google, Meta, Apple, Amazon, Microsoft, Netflix, LinkedIn, Salesforce, Adobe, NVIDIA, Oracle) set to `mid`. Adjust per-company:

```sql
UPDATE companies SET min_relevant_seniority = 'mid' WHERE name = 'X';
UPDATE companies SET min_relevant_seniority = 'director' WHERE name = 'Y';
UPDATE companies SET min_relevant_seniority = NULL WHERE name = 'Z';
```

Jobs with no detected `job_level` pass through every threshold — preferring over-show on classification misses.

## Gotchas

- **Cron endpoint**: Must `await runDailyCheck()` — Railway auto-sleep kills fire-and-forget.
- **Railway Cron only**: No in-process schedulers — causes duplicate runs.
- **Local CRON_SECRET mismatch**: Local `.env` CRON_SECRET doesn't match Railway production. Can't trigger manual cron from local — use Railway dashboard or wait for scheduled run.
- **Resend quota**: 100 emails/day on free tier. Per-user alerts + admin digest + magic links all share this. Watch the daily count.
