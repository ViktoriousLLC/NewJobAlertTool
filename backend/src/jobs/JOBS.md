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

## Daily Self-Check Agent (PR #20+)

Separate remote agent fires daily at 14:30 UTC via `CronCreate`. Reads:
- `companies` for new failures + watch list + auto-disabled + unverified-zeros with subs > 0
- `scraper_events` for last 24h
- `security_snapshots` delta on Mondays only
- cross-domain stealth rejection events

Investigates each issue (spawns scraper-doctor), pushes curated report only if actionable.

## Self-Healing Pipeline (refer to SCRAPER.md for detail)

Three-tier recovery → auto-disable threshold (7 days) → Monday watch-list probe → re-enable. Tracked in `scraper_events` table for the weekly digest's self-heal log.

## Email Delivery

- **Per-user alerts**: filtered by subscriptions + `user_preferences.email_frequency`. Batch send via `resend.batch.send()` (100/call, 1s delay).
- **From addresses**:
  - `alerts@newpmjobs.com` (API)
  - `noreply@newpmjobs.com` (magic links via SMTP)
- **Resend limits**: Free tier = 100 emails/day, 3K/month, 2 req/s. SMTP + API share quota.
- **API key**: only in Railway env vars; empty locally.

## Consolidated Admin Digest

`sendAdminDigest()` in `dailyCheck.ts` — replaces three previous admin emails (failures, quality report, batch-send failures) with one.

- **Daily**: fires ONLY if action items present (failed scrapes, watch list, auto-disabled, subscribed company dropped to 0, email send failures).
- **Monday UTC**: always fires with system health + past-7-day self-heal log queried from `scraper_events` + npm-audit security check.
- **Most days = no admin email.**

(Tuesday duplicate was removed PR #17 — daily self-check agent took over the safety-net role.)

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
