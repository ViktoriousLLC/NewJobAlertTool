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

## Scrape-on-demand (DEV-52)

`POST /api/cron/scrape-only` (in `backend/src/index.ts`) — scrapes companies and reconciles `seen_jobs` **without ANY email-distribution step**. Decouples scraping from emailing so a freshly added company's jobs show up immediately instead of waiting for the 14:00 UTC daily run. CRON_SECRET-gated (same `safeCompareSecret` pattern as `/api/cron/trigger`).

- **Body** `{ companyIds?: string[] }`: present → scrape exactly those (UUID-validated, max 250, de-duped, chunked `.in()`); omitted → default to `is_active` companies that currently have **zero `seen_jobs` rows** (freshly added, never scraped).
- **Shared logic**: reuses `scrapeAndRecordCompany(company, ctx)` — the exact per-company scrape + self-healing tiers (auto-fix / broadATSDiscovery / stealth) + `seen_jobs` diff (insert-new / flip-returned / refresh / mark-removed) + status/zero-streak writes the daily cron loop runs. It was extracted verbatim from `runDailyCheckInner`; the daily path now delegates to it, so behavior is identical. `ScrapeContext` carries the per-run accumulators the admin digest reads; scrape-only passes a throwaway context and never builds a digest or sends mail.
- **isProbeDay forced true** here so an auto-disabled target is actually scraped now (the daily loop would skip it until Monday).
- **Idempotent**: re-runs just re-reconcile `seen_jobs` (UNIQUE on company_id+job_url_path prevents dupes) and re-stamp `last_check_status`. 5s inter-company delay, same as the daily loop.
- **Returns** `{ scraped, jobsAdded, perCompany: [{ id, name, status, jobsAdded, totalActive, error? }] }`.
- **Never** calls `sendPerUserAlerts` / `sendConsolidatedAdminDigest` / `sendWeeklyDigest`.

## RapidAPI Restore of Scraping-Blocked Employers (DEV-51)

Auto-restores the 4 scraping-blocked employers (Meta / Tesla / TikTok / Wayfair) by pulling their US Product Manager roles from the Fantastic.jobs RapidAPI LinkedIn feed, WITHOUT ever touching their hard-blocked career sites. Lives in `backend/src/scraper/rapidApiBlocked.ts`; does not change any existing scraper or `CUSTOM_SCRAPER_HOSTS`.

- **Why**: these employers carry `companies.scrape_blocked = true` (PRs #130/#134) because direct scraping is hard-blocked (Akamai 403, FB session-gating, Stargate gateway 2012, Workday 401/422). The RapidAPI LinkedIn aggregator indexes their public LinkedIn postings, so their PM roles can be restored via a paid third-party feed.
- **Module**: `pullRapidApiBlockedEmployers()` queries every company still `scrape_blocked = true`, calls `GET https://linkedin-job-search-api.p.rapidapi.com/active-jb-7d` (`title_filter="Product Manager"`, `location_filter="United States"`, `organization_filter=<company.name>`, `offset=0`, `description_type=text`) with headers `x-rapidapi-host` + `x-rapidapi-key: $RAPIDAPI_KEY`. Maps each job to the `seen_jobs` shape (title; `job_url_path` = normalized apply URL with query/hash stripped; location from `cities_derived[0] || locations_derived[0]`) and runs it through the SAME `validateScrapeResults` PM_KEYWORDS + US filter used everywhere.
- **Insert-or-refresh ONLY, never removal** (critical): the feed is a rolling 7-day window, so the standard diff-removal would wrongly delist older still-live roles. New listings INSERT active; known removed/archived listings flip back to active; active listings get title/location refreshed. Nothing is ever marked removed here — older roles age out via the existing 60-day archive sweep instead.
- **Self-restore + self-stop**: on a company that yields >=1 US PM job, sets `scrape_blocked=false`, `platform_type='rapidapi_linkedin'`, `platform_config={"orgName": <name>}`. A restored company stops matching the `scrape_blocked = true` query, so re-runs self-skip it. A company with nothing on LinkedIn (Wayfair: 0 PM/US on the feed) simply stays flagged and is retried cheaply each run.
- **Never throws on a single-company failure**: each company is wrapped in try/catch — failures are recorded in the result row and the loop continues; `scrape_blocked` is left UNCHANGED on any per-company error.
- **Free-tier quota** (250 jobs + 25 requests/month): logs `x-ratelimit-jobs-remaining` + `x-ratelimit-requests-remaining` from every response and emits a Sentry `warning` (never throws) when either nears zero.
- **Confirmed 7d PM/US counts (live probe)**: Meta 8, Tesla 22, TikTok 4, Wayfair 0.

### Date-gated auto-trigger (no manual step)

Inside `runDailyCheckInner()`, immediately after the per-company scrape loop, the cron calls `isRapidApiActivationDue()` and, if due, runs `pullRapidApiBlockedEmployers()` once and folds a one-line summary into the console log.

- **`isRapidApiActivationDue()`** returns true only when `RAPIDAPI_KEY` is set AND today's UTC date (`YYYY-MM-DD`) `>= RAPIDAPI_ACTIVATION_DATE` (default `"2026-07-01"`, when the free RapidAPI monthly quota resets). Before that date it is a pure no-op, so the feature stays dormant until July 1 with zero quota spend.
- Wrapped in try/catch in the cron — a RapidAPI failure can never break the daily run, and (per the module) leaves `scrape_blocked` unchanged.
- **Env (Railway)**: `RAPIDAPI_KEY` (required to activate), `RAPIDAPI_ACTIVATION_DATE` (optional override, default `2026-07-01`).

### Manual trigger

`POST /api/cron/rapidapi-blocked` (in `backend/src/index.ts`) — CRON_SECRET-gated (same `safeCompareSecret` pattern as `/api/cron/trigger`). Runs `pullRapidApiBlockedEmployers()` on demand for testing once the quota resets. Unlike the daily auto-trigger it is NOT date-gated (deliberate manual override), but still no-ops cleanly when `RAPIDAPI_KEY` is unset or there are no `scrape_blocked` companies. No email. Returns `{ checked, restored: string[], jobsAdded, perCompany: [{ company, jobsAdded, blockedClearedFor, error? }] }`.

## Weekly LinkedIn-Draft Digest (PR #52, added 2026-05-22)

**Friday auto-trigger inside `runDailyCheck()`.** When UTC day-of-week === 5, after the consolidated admin digest, `sendWeeklyDigest()` from `backend/src/jobs/weeklyDigest.ts` fires. Owned by the existing 14:00 UTC daily Railway cron — no separate schedule.

- **Module**: `backend/src/jobs/weeklyDigest.ts` — exports `computeWeeklyDigest`, `renderLinkedInPost`, `renderEmailHtml`, `sendWeeklyDigest`. Helpers: `backend/src/lib/weeklyLeadWriter.ts` (Claude lead phrasing), `backend/src/lib/weeklyDigestImage.ts` (Gemini banner), `backend/src/lib/vikVoiceFull.ts` (auto-generated verbatim voice files).
- **Recipient**: `ADMIN_EMAIL` only (this is editorial content for Vik, not subscribers).
- **Subject**: `📬📬📬 𝗪𝗘𝗘𝗞𝗟𝗬: LinkedIn Job Summary for <Mon DD>` (leading triple open-mailbox emoji so it's spottable at a glance in the inbox + Unicode-bold "WEEKLY" prefix; falls back gracefully to plain caps in clients that don't render it). Updated 2026-05-31.
- **Body**: copy-paste-ready LinkedIn post (plain text, @-tagged companies) + alternate leads + the banner image prompt (and the generated PNG attached when Gemini succeeds) + raw-data tables + an Appendix (top cities + remote; big-tech concentration; seniority; top-paying companies; surge vs 4-week avg; daily velocity) + a generation-cost footer. **The post sits in a `<pre>` block (real newlines, `font-family:inherit`) so copy-paste into LinkedIn preserves line breaks — do NOT revert it to a `<br/>`-in-a-div, which collapsed to one line on paste. Company names in the Claude-written lead are @-tagged at render via `tagCompanyMentions()` (the structured top-10 / AI sections were always tagged; the free-text lead was the gap).**
- **Data window**: last 7 days of `seen_jobs` where `status = 'active'` AND `is_baseline = false` joined to `companies`.
- **AI title regex**: `/\b(AI|ML|GenAI|LLM|Machine Learning|Generative|Agentforce|Agentic|Voice AI|Copilot|GPT)\b/i`. Conservative; misses titles that only imply AI.
- **Expected fire time on Fridays**: ~14:25-14:35 UTC (after scrape + per-user alerts + comp_cache refresh + admin digest).
- **Manual triggers**: `?forceWeeklyDigest=true` on `/api/cron/trigger`, `/api/cron/weekly-digest` (CRON_SECRET), `POST /api/admin/weekly-digest/send` (admin JWT), `GET /api/admin/weekly-digest/preview` (admin JWT, no send). NOTE: `computeWeeklyDigest` now makes a Claude call on every invocation (including preview), so preview costs ~10-15c + a few seconds. Only `sendWeeklyDigest` writes `weekly_lead_history`; preview never does.

### Rotating "My take" lead engine (DEV-43, added 2026-05-30)

Replaced the old hardcoded `**Banking is on a tear.**` lead. The post now opens with a dated volume line, then `My take this week: <hook>` (a rotating, voice-written blunt claim), then the generic stats block, then a CTA. Plain text on purpose — Vik bolds the opener + numbered headers in AuthoredUp; do NOT add Unicode/markdown bold in `renderLinkedInPost()`.

- **Angles are snapshots only** (this-week: AI share, top company, big-tech concentration, top pay, top city, seniority). Deliberately NO week-over-week trend claims — on this data those are contaminated by catalog-onboarding bursts (a bulk-add reads as a hiring surge; that is literally what the old "Banking is on a tear" was). `buildLeadCandidates()` computes the factual candidates; CODE picks the lead (priority order + freshness), the LLM only PHRASES.
- **Freshness**: `weekly_lead_history` (migration `2026-05-30-weekly-lead-history.sql`) logs the angle + art_style each send. `computeWeeklyDigest` reads the last 2 rows and skips a recently-used angle for the lead; `sendWeeklyDigest` inserts after a successful send.
- **Voice**: `weeklyLeadWriter.writeLeads()` injects Vik's REAL voice guide + calibration samples VERBATIM (from `vikVoiceFull.ts`, bundled because repo-root `docs/Viks Voice/` is NOT in the backend deploy). A paraphrase produced "AI slop" Vik rejected repeatedly — always inject the real files. Regenerate the bundle with `node backend/scripts/gen-voice.mjs` after editing the source docs. Model = `WEEKLY_DIGEST_MODEL` (default `claude-opus-4-8`, Vik's pick; separate from the Sonnet-default `ANTHROPIC_MODEL` interviews use). Fails soft: no key / parse error / API error → deterministic fallback hooks, email still renders.
- **Banner image**: `weeklyDigestImage.ts` builds a nano banana prompt (fixed 4-line "HOT TAKE · DATE / hook / subline / NewPMjobs.com" lockup + a rotating art style from `ART_STYLE_KEYS`) and, when `GEMINI_API_KEY` works, generates the PNG (`gemini-2.5-flash-image`) to attach. The email ALWAYS includes the text prompt so Vik can regenerate free via his consumer plan. Generation fails soft (his Gemini project has hit depleted-credit 429s; the image model has no free tier) — no image, just the prompt.
- **Required env (Railway)**: `ANTHROPIC_API_KEY` (have it; interviews use it), optional `WEEKLY_DIGEST_MODEL`, `GEMINI_API_KEY` (for the auto-image; optional), optional `GEMINI_IMAGE_MODEL`.
- A separate critic/refine LLM pass is NOT in v1 (single strong call; Vik is the human gate). The build-proof run used one; add it here if quality drifts.

## Daily Self-Check Agent (PR #20+; reworked into a parallel fan-out workflow in DEV-41, 2026-05-30)

A daily remote agent (routine) fires ~14:30 UTC, after the 14:00 scrape, and runs the **`daily-self-check` workflow** (`.claude/workflows/daily-self-check.js`) instead of the old serial scraper-doctor loop.

**Suspect set (what gets checked):** companies that look broken but are NOT already explained — `last_check_status` contains 'error' / '0 jobs from source' / the legacy 'quality: 0/100', OR `auto_disabled`, OR `consecutive_failure_count >= 3` (the watch-list threshold; a single transient blip self-resolves), OR `consecutive_healthy_zero_days > 0` (with subs) — **excluding `is_verified_zero`** (auto-managed, known-zero, not real suspects). On 2026-05-30 that was 12 of 247 (79 before the is_verified_zero exclusion). The routine computes this set and passes it to the workflow as `args`.

**The workflow:** `pipeline(suspects, diagnose, adversarialVerify)`, capped at 20 (overflow reported, never silently dropped):
- **diagnose** — one `scraper-doctor` per suspect; reads SCRAPER.md, hits the live ATS board itself, decides broken vs benign.
- **adversarialVerify** — a second, independent `scraper-doctor` tries to REFUTE the diagnosis in BOTH directions: prove a "broken" verdict is a false alarm, AND prove a "healthy" verdict is secretly broken (the mislabeled-healthy case that let zombie jobs sit live for weeks — the serial check missed it). Only diagnoses that survive as a real, fixable, subscriber-affecting problem count.
- Returns the confirmed list; the routine emails admin ONLY if it's non-empty ("email only if actionable" preserved).

**Cost:** ~83k tokens/company (diagnose + verify), so ~1M tokens for a ~12-company run. Always scoped to the suspect set, never all 247.

Why the rework: the old serial scraper-doctor loop was single-perspective and mislabeled delisted companies as healthy for weeks (the 2026-05-29 zombie-job class). The adversarial refute pass is what catches that. The routine also reads `scraper_events` (last 24h), the `security_snapshots` delta (Mondays), and cross-domain stealth rejection events for the report context.

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

**Coverage / scraper instrumentation.** A source counts as "alive" when `scrapeStats.totalScanned > 0` **OR `scrapeStats.sourceReachable === true`** — the cron's `sourceHealthy = totalScanned > 0 || sourceReachable === true`.

- `totalScanned > 0` is the full-board signal: scrapers that pull every posting and filter to PMs in-code, so a 0 count provably means "board reachable, 0 PMs." Those are greenhouse, greenhouse_departments, ashby, workday, lever, smartrecruiters.
- `sourceReachable === true` is the keyword-search signal (DEV-33, 2026-05-30): scrapers that ask the source for "product manager" and never see the full board set this after parsing a successful HTTP 200. Because these scrapers **throw on a non-ok response**, the flag is only ever set on a real success, so a reachable source returning 0 PMs is no longer ambiguous with a broken-but-200 fetch. This brings **amazon, icims-api, oracle_hcm, intuit** into stale-removal coverage (after the same 2-day buffer). Together with the full-board group this covers the large majority of the catalog.

Still **preserve-conservative** (set neither signal, so a 0 count stays ambiguous between "empty" and "selector broke" → never auto-removed): eightfold (returns `[]` on a non-ok page instead of throwing), the generic Puppeteer fallback, and icims Puppeteer.

On the broad-ATS-discovery re-scrape, BOTH `totalScanned` and `sourceReachable` are reset before the retry, so a stale "reachable" flag from a failed first scrape cannot green-light removal of a company's live jobs.

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
- **Resend quota**: PAID Transactional Pro = 50,000 emails/month (NOT the free tier). The old "100/day free tier" note here was stale and caused a 2026-05-29 misdiagnosis of the daily-email bug — quota is effectively never the constraint at current volume (~75 daily recipients). See the corrected note higher in this file for detail.
