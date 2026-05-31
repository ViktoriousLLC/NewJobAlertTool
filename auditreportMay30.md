# End-to-End System Audit — May 30, 2026
### Run before adding Stripe (payments) and opening Voice interviews to paying users

*Read-only audit. Nothing was changed, fixed, pushed, or touched in the database — this is a pure read-out. 8 areas, 19 agents, 75 observations. Every serious finding was independently double-checked by a second agent that tried to disprove it.*

---

## THE BOTTOM LINE (read this first)

**Is the system safe to build Stripe and Voice on top of? Yes — with a short fix-list first.**

The foundation is genuinely solid. Logins, the rule that one user can never see another user's data, and your monitoring are all in good shape. There are **zero critical problems**, **zero signs anyone has attacked you**, and **zero actual errors in production over the last 90 days**. Most of the 75 observations are actually confirmations that things are built correctly.

Out of everything, **10 issues are real and worth doing** (none are emergencies). They cluster into five themes:

1. **One out-of-date library.** Your website framework (Next.js) is one version behind and that version has known security holes (including a serious one). The fix is a routine version bump that was already on your list.
2. **The Voice feature has a broken promise.** Your docs say interview recordings auto-delete after 7 days. That deletion was never actually built — so transcripts and audio links are being kept forever. Only you use it today, so it's tiny now, but it must be fixed before any paying user records their voice.
3. **One database table is publicly readable.** A minor internal table (`weekly_lead_history`, just email metadata) has its privacy lock off. Your important user tables are correctly locked — this is the one that slipped.
4. **Opening Voice to paid users is the riskiest change ahead.** Every interview spends real money (voice + 3 AI models). The controls to stop a paying user from running up huge bills are designed but not built yet.
5. **Two "silent truncation" bugs.** Two queries stop reading at 1,000 rows without warning — the same kind of bug that dropped 43% of your email recipients earlier this month. They'll bite as your data grows.

**Your single most important next action:** bump Next.js to 16.2.6. After that, the Voice data-deletion job. Everything else can be sequenced into the Stripe/voice build work.

---

## HOW TO READ THIS

- **Severity:** 🔴 High = real, worth doing soon. 🟡 Medium = worth doing. ⚪ Low/Info = minor or already-fine.
- **"✅ Verified"** means a second, independent agent re-checked the live code/database/config and confirmed the finding is real — not a guess.
- I checked 11 high-severity findings hard. **10 held up. 1 was a false alarm** (see the "False alarm" section — I'm telling you so you don't chase a ghost).

---

## HEALTH SCORECARD

| Area | Rating | In one line |
|---|---|---|
| **Logins / Auth** | 🟢 Good | Solid and actually *stronger* than the docs claim. Only paperwork to fix. |
| **One-user-can't-see-another's-data** | 🟢 Strong | Airtight. Every route checks ownership from the verified login, never from anything a user can fake. |
| **Infrastructure / dependencies** | 🟠 Needs attention | One out-of-date library (Next.js) with real security holes. Everything else clean. |
| **Scraping** | 🟢 OK | Self-healing works. Two cleanups: stop wasting time (and legal risk) on 4 permanently-blocked sites; one scraper can't clean up stale jobs. |
| **Database** | 🟠 Needs attention | One table publicly readable; some tables exist in code but not in your saved setup scripts. User data itself is protected. |
| **Performance** | 🟢 OK | Two "stops at 1,000 rows" bugs to fix; otherwise efficient. |
| **Monitoring** | 🟢 Strong | Sentry + PostHog alive and verified. Zero production errors in 90 days. |
| **Stripe + Voice readiness** | 🟢 OK (specs strong) | Your written plans are excellent. The gap is the existing voice code, which was built for just you. |

---

## THE 10 THINGS WORTH DOING (all independently verified)

### Theme 1 — Security & dependencies

**🔴 1. Update Next.js (your website framework) — ✅ Verified**
- **Plain version:** The public site runs on Next.js 16.1.6. That version has 8 serious security holes disclosed since your last check — including one rated 8.6/10 that could trick your server into making requests for an attacker, several that could let someone slip past your access controls, and a few that could knock the site offline. No sign anyone has used these; it's a "patch is available, apply it" situation.
- **Fix:** Bump to **16.2.6** (a safe, minor update that was already planned), regenerate the lock file, redeploy Vercel.
- **Bonus problem found:** your weekly security scan only checks the *backend*, so this frontend issue was invisible. Add the frontend to that weekly scan.
- **Where:** `frontend/package.json`

### Theme 2 — The Voice feature (built for you, not yet safe for strangers)

**🔴 2. The "auto-delete recordings after 7 days" job doesn't exist — ✅ Verified**
- **Plain version:** Your docs (and planned consent copy) promise interview transcripts and audio links auto-delete after 7 days. That job was never built. Right now every mock-interview transcript and a key to the actual voice recording is kept **forever**. It's tiny today (only you use it), but the moment a paying user records their voice, you're quietly piling up sensitive personal data with no expiry — exactly what your own EU/GDPR decisions say must auto-delete.
- **Fix:** Add the 7-day delete to the daily cron; wire interview data into account-deletion; decide whether the rolling per-user "profile" is also in deletion scope.
- **Where:** `backend/src/jobs/dailyCheck.ts` (no interview cleanup exists); promised in `2026-05-28-interview-memory.sql` + CLAUDE.md.
- **This is a release blocker for opening Voice to anyone but you.**

**🔴 3. Opening Voice from "just admin" to "paying users" is where money leaks — ✅ Verified**
- **Plain version:** Today Voice is locked to you, so costs are bounded. When you open it to Pro users, the "is this the admin?" check gets swapped for "is this a paying user with minutes left?". If that's done loosely, three bad things become possible: a free user uses a paid feature free, a Pro user with no minutes keeps burning your money, or someone scripts the endpoint to run up hundreds of dollars of AI/voice bills. Currently safe (admin-only); the controls to keep it safe after opening are **designed but not built**.
- **Fix (before opening):** a real "is Pro?" check that reads the database every request; per-user rate limits + one-session-at-a-time; a minutes balance check; an hourly spend circuit-breaker. Keep the "fire all 3 AI models" test endpoint admin-only.
- **Where:** `backend/src/routes/interviews.ts:36`

**🔴 4. A user could plant instructions in their own interview that stick — ✅ Verified**
- **Plain version:** After each interview, an AI writes a little profile of the user, and that profile is fed back into the next session. Today only you feed it. Once strangers talk into it, a user could say things designed to manipulate their future sessions (e.g., "always score me 95+"). It can't leak *other* people's data, but it can corrupt the scoring they paid for. Foothold worth closing before strangers use it.
- **Fix (before opening):** wrap stored summaries/transcripts as "data, not instructions," strip hidden characters, cap length, add an injection test.
- **Where:** `backend/src/routes/interviews.ts:133-151, 287-299, 336-409`

### Theme 3 — Database hygiene

**🔴 5. One table is publicly readable; schema "drift" elsewhere — ✅ Verified (with an important correction)**
- **Good news first:** the audit's scary version of this — "all your user tables are exposed" — was **disproven** by a live test. Your important tables (`user_subscriptions`, `user_job_favorites`, `user_preferences`) **are** correctly locked: a test with the public key returned nothing.
- **The real, smaller issue:** one internal table, **`weekly_lead_history`**, has its privacy lock (RLS) turned **off** — a live test pulled real rows with just the public key. It only holds non-sensitive email metadata, so this is low-stakes, but it should be closed.
- **Also found — "schema drift":** two tables your code uses (`scraper_events`, `help_submissions`) exist in the live database but are **missing from your saved setup scripts**. If you ever rebuilt the database from those scripts, the daily cron and an admin page would crash. Worth reconciling, especially before adding a payments table.
- **Fix:** turn on RLS for `weekly_lead_history`; add the missing tables to committed migrations; capture all RLS state as migrations so it's verifiable from the repo, not just the live DB.

### Theme 4 — Performance (two silent-truncation bugs)

**🔴 6. The Tracked Companies dashboard can show stale dates — ✅ Verified**
- **Plain version:** Opening your dashboard fetches every job ever recorded for your tracked companies to find the newest one each — with no page limit. Once that crosses 1,000 rows, the database silently cuts it off and some companies show wrong "latest job" dates. Same bug class as the email incident (PR #97).
- **Fix:** use the existing `fetchAllRows` paginator (or a single grouped query).
- **Where:** `backend/src/routes/companies.ts:259`

**🔴 7. The Monday weekly email gets slower as users grow — ✅ Verified**
- **Plain version:** Every Monday, for each weekly-email user, the code makes 2 separate database trips one-after-another. 20 users = 40 sequential trips. It grows linearly with users. (Daily emails already do this the fast way.)
- **Fix:** fetch the week's jobs once before the loop, then filter per-user in memory — the pattern already used elsewhere in the same file.
- **Where:** `backend/src/jobs/dailyCheck.ts:1214`

### Theme 5 — Scraping cleanups

**🔴 8. We attack 4 permanently-blocked sites every day — ✅ Verified**
- **Plain version:** Every day the system launches a hidden browser against Meta, TikTok, Tesla, and Wayfair — all of which permanently block scrapers. It always fails, wastes ~8 minutes of cron time daily, and carries the most legal risk you have (a "stealth" attempt *after* being blocked is the DMCA-exposed pattern). They yield zero jobs, so the risk/reward is clearly negative.
- **Fix:** skip the stealth step for these four (and mark them so the cron auto-skips). Pure win: less wasted time, less legal exposure, zero downside.
- **Where:** `backend/src/jobs/dailyCheck.ts:422`

**🔴 9. A couple of companies can show "zombie" job listings — ✅ Verified**
- **Plain version:** DocuSign and Joby Aviation use a scraper that can't tell the system "the page loaded fine, there just were no PM jobs." So the system never removes their stale listings — a subscriber could see a "Product Manager" role that was deleted months ago.
- **Fix:** small one — let that scraper report "source was reachable" after it loads, matching what the other scrapers already do.
- **Where:** `backend/src/scraper/scraper.ts:2083`

*(10th verified item is the "schema drift" half of #5 above — counted there.)*

---

## ONE FALSE ALARM (so you don't waste time on it)

**❌ "No database index on user_subscriptions" — NOT a real problem.** One agent flagged a missing index that would slow down every logged-in page. A second agent checked the actual migration history and found **the indexes already exist** (`idx_user_subscriptions_user_id`, `_company_id`, and the unique pair). This is exactly why the double-check step exists. **No action needed.**

---

## WHAT'S ALREADY SOLID (the reassuring part)

- **Logins:** Every protected route requires a valid login. Tokens are verified with strong public-key cryptography (actually *better* than your docs say — the docs just need updating). No secrets are committed to your code. The login-cookie bug from the May incidents is confirmed fixed.
- **Data isolation:** Read line-by-line across all 11 route files — there is no way for one user to read or change another's data. Identity always comes from the verified login, never from anything a user sends. The 4 previously-fixed leaks are all still fixed.
- **Monitoring:** Sentry and PostHog are alive and self-verifying (the "is monitoring actually working?" probe runs daily and has been 100% healthy). **Zero production errors in 90 days.** The only logged events are informational scraper-recovery messages.
- **Your Stripe + Voice written specs are excellent** — most of the must-do security controls are already documented. The work is building to them faithfully.

---

## BEFORE YOU BUILD — checklists

### Before Stripe goes live (the "don't get robbed" list)
1. **Verify Stripe's signature on every webhook**, and make sure the raw request body reaches that check *before* your normal JSON parser rewrites it (classic break point). Your spec nails this — build to it exactly.
2. **Never trust the browser for "is this user Pro?"** — read it from the database every request. Don't stamp it into the login token; don't infer it from a success-page URL.
3. **Ignore duplicate webhook events** (a "dedup ledger") so a replayed payment can't re-trigger upgrades.
4. **Find the user by their Stripe customer ID from the database**, never from data in the webhook body.
5. **Refuse to boot in production if Stripe secrets are missing**, and refuse live keys in preview environments.
6. **Scrub payment data out of Sentry/PostHog** before launch.

### Before Voice opens to paying users (the "don't lose money / leak voices" list)
1. **Build the 7-day auto-delete** (item #2 above) — blocker.
2. **Real "is Pro?" check + per-user rate limits + one-session-at-a-time + an hourly spend circuit-breaker** (item #3).
3. **Harden against planted instructions** in transcripts (item #4).
4. **Make every "get session by ID" endpoint check it belongs to the asker** (return "not found," not "forbidden").
5. **Add a recorded-voice consent notice** and confirm the audio actually deletes on schedule.
6. **Scrub transcripts/keys out of Sentry/PostHog.**

---

## EVERYTHING ELSE (the minor stuff, grouped)

- **Auth paperwork:** update AUTH.md/CLAUDE.md to describe the current (stronger) login design; tighten the magic-link "type" check; optionally split the login-fallback alert so routine key-rotation noise doesn't bury a real attack.
- **Scraping:** Coinbase burns a browser launch daily on a board they deleted (turn it off or disable); pin the two stealth-plugin versions exactly (they currently float); centralize the "custom scraper" list so it can't drift; Phenom companies (eBay/BCG) only ever see 10 jobs.
- **Database (when the payments table lands):** turn on its privacy lock from day one, index by user + Stripe IDs, store status as a constrained value.
- **Performance:** a few endpoints fetch the whole companies list with no cap (fine at 247, breaks past 1,000) — wrap them in the paginator before the catalog grows; the company-add check downloads the full catalog every time; the favorites and unfollow endpoints make one more database trip than needed.
- **Monitoring:** consider a separate Sentry project for backend vs frontend; confirm the frontend Sentry key is set in Vercel; the login funnel shows ~45% completion (mostly people abandoning, very few real errors).

---
---

# NEXT STEPS — continuation guide for a fresh session

*This section is written so a brand-new session can pick up the audit follow-up without re-reading everything. Nothing below has been done yet — the audit was read-only.*

## Context / where things stand
- **Date of audit:** 2026-05-30. Run as a read-only `Workflow` (8 parallel specialist agents + an adversarial verification pass). No code, DB, or config was changed.
- **Raw audit data (if still present):** the full structured findings were in the background task output `wt5f2ggxi` (temp dir, may have rotated). This report is the durable source of truth — work from it.
- **Verification result:** 11 high-severity findings were independently re-checked; **10 confirmed real, 1 false alarm** (the `user_subscriptions` index — it exists; do NOT "fix" it).
- **Posture:** no critical issues, no active exploitation, zero prod errors in 90 days. Safe to proceed once the items below are sequenced in.
- **Important:** these are recommendations only. Several touch production (Railway env, Supabase, Vercel deploy) and money/PII. Confirm with Vik before applying anything outward-facing. `main` is ruleset-protected → every code change goes through a `claude/<slug>` branch + PR (`/ship`).

## Priority 0 — do these first (independent of Stripe/voice build)

1. **Bump Next.js 16.1.6 → 16.2.6** (security patch: SSRF 8.6 + middleware-bypass + DoS).
   - File: `frontend/package.json` (`"next": "16.1.6"`). Run `npm install` in `frontend/` to regen `package-lock.json`, verify `npm audit --omit=dev` is clean, redeploy Vercel.
   - Non-semver-major, low blast radius. This is the long-standing DEV-? "D2" item.
   - **Also:** `backend/src/jobs/securityCheck.ts:43` runs `npm audit` on `backend/` ONLY — the weekly `security_snapshots` digest is blind to frontend regressions. Add a frontend `--omit=dev` audit to that job so this can't silently recur. Verify backend is still 0 vulns (it was at audit time).

2. **Enable RLS on `weekly_lead_history`** (Supabase project `lrmxjqijaenyzdjjzmmo`). It's currently readable by anyone with the public anon key (confirmed via live anon-key test during verification). Low-sensitivity (email metadata) but close it. Apply via a committed migration: `ALTER TABLE weekly_lead_history ENABLE ROW LEVEL SECURITY;` (backend uses the service-role key which bypasses RLS, so this won't break the app). While there: the no-policy-but-RLS-on tables (`comp_cache`, `recommendation_history`, `scraper_events`, `security_snapshots`) are functionally fine (block anon) but messy — optionally add explicit policies.

3. **Fix schema drift:** `scraper_events` and `help_submissions` are referenced in code (`dailyCheck.ts` insert ~line 25; `admin.ts:63-68`) but are NOT in `backend/migrations/`. They exist in the live DB so prod is fine, but a rebuild-from-migrations would crash. Add `CREATE TABLE IF NOT EXISTS` migrations matching the live shape (introspect live schema first). Reconcile against `docs/planning/supabase-schema.sql`.

4. **Two silent-truncation bugs (same class as the PR #97 email incident):**
   - `backend/src/routes/companies.ts:259` — `latestResult` query has no pagination; wrap in `fetchAllRows` (pattern at `dailyCheck.ts:521`) or replace with a grouped `max(first_seen_at)` RPC. The `idx_seen_jobs_company_baseline` index supports it.
   - `backend/src/jobs/dailyCheck.ts:1214` — `getWeeklyAlerts` is an N+1 inside the Monday user loop. Pre-fetch a single global 7-day jobs snapshot (extend `recentJobsRows` at ~line 1126 to include `companies.name` + `careers_url`) before the loop, then filter per-user in memory. Mirrors the daily-alert path.

5. **Scraping cleanups:**
   - `backend/src/jobs/dailyCheck.ts:422` — add the existing `isCustomScraper` check before the Tier-3 stealth call so Meta/TikTok/Tesla/Wayfair are NOT stealth-scraped (DMCA-1201 exposure + ~8 min/day wasted; they yield 0). Also set `is_verified_zero=true` on those four. Consider doing the same for Coinbase (dead board) — set `auto_disabled=true` if it has no subscribers.
   - `backend/src/scraper/scraper.ts:2083` — add a `stats?: ScrapeStats` param to `scrapeICIMSCareers` (Puppeteer variant) and set `stats.sourceReachable = true` after a successful page load, so DocuSign/Joby zombie jobs get cleaned up (matches the API variant at ~line 1895 and the DEV-33 pattern).

## Priority — gates BEFORE the Voice feature opens beyond admin (release blockers)
These touch the EXISTING `backend/src/routes/interviews.ts` (currently `requireAdmin` on line 36, which makes them safe today). Do them in the PR that opens Voice to Pro users:

6. **Build the 7-day interview data wipe** (promised in docs, never implemented). Add to daily cron: `DELETE FROM interview_sessions WHERE created_at < now() - interval '7 days'`. Wire interview data into account-deletion cascade. Decide if `interview_user_summary` (persistent profile) is in GDPR-deletion scope. **Independent of launch — this is a live privacy gap today, just tiny because only admin uses it.**
7. **Replace `requireAdmin` with `requireAuth` + a DB-backed `requirePro`** (read tier from DB every request, never JWT). Add per-user rate limits (spec: 10/hr, 30/day, 1 concurrent), a minutes-balance check at token-mint AND session-start (402 on exhaustion), and an hourly ElevenLabs/LLM spend circuit-breaker. Keep `/test-evaluators` admin-only.
8. **Prompt-injection hardening** on the existing summary+eval path (`interviews.ts:133-151, 287-299, 336-409`): XML-tag stored summary/transcript as data-not-instructions, strip Unicode/zero-width chars, cap length, add an injection test.
9. **IDOR scoping** on every new `GET /api/interviews/sessions/:id`-style route (`where user_id = req.userId`, return 404 on miss). RLS is NOT the enforcement layer here (backend uses service-role key which bypasses it).
10. **Recorded-voice consent disclosure** + confirm ElevenLabs audio TTL matches stated retention; never log audio URLs/handles.

## Priority — gates to build INTO the Stripe feature (from the threat model)
Full detail in `docs/specs/dev-20-stripe-phase-1.md` Appendix A. The P0 set:
- Stripe webhook: `express.raw` mounted BEFORE the global `express.json()` (`index.ts:85`); verify with `stripe.webhooks.constructEvent` (NOT `safeCompareSecret` — different scheme); 400 on bad signature.
- `processed_stripe_events` dedup ledger (idempotency) + monotonic event-time guard, transactional with the state update.
- Resolve user by `stripe_customer_id` from DB, never from `metadata.user_id`.
- `requirePro` reads DB every request (shared with item #7); tier never in JWT; UI tier from `/api/billing/status` only.
- Payments table: RLS on from creation, index by `user_id` + unique on `stripe_subscription_id`/`stripe_customer_id`, status as constrained enum.
- Boot fail-closed if Stripe secrets missing; reject `sk_live_` in non-prod (Railway preview clones prod env). Gate on `RAILWAY_ENVIRONMENT_NAME` (the DEV-47 lesson), not `NODE_ENV`.
- Sentry `beforeSend` scrubber for webhook bodies/signatures/secret-shaped strings; PostHog autocapture off on billing/voice routes.
- Billing POSTs Bearer-only (no cookie fallback); redirect URLs server-built from `FRONTEND_URL`.

## Priority — paperwork / low (nice-to-have)
- Update `AUTH.md` + `CLAUDE.md`: login uses asymmetric JWKS verification now, NOT HS256/`SUPABASE_JWT_SECRET`. Mark `SUPABASE_JWT_SECRET` deprecated in `.env.example`. Update `.claude/agents/security-auth.md` baseline.
- Magic-link `/auth/confirm` (`frontend/src/app/auth/confirm/route.ts:20`): allowlist the OTP `type` to `['magiclink','signup']`.
- Split the `auth-fallback` Sentry signal so routine JWKS key-rotation noise doesn't bury a real forgery attempt; add a timeout to the `getUser` fallback.
- Boot-warn if `FRONTEND_URL` is unset/missing https:// in prod (CORS silently collapses to localhost otherwise).
- Confirm `NEXT_PUBLIC_SENTRY_DSN` is set in Vercel; consider a separate backend Sentry project.
- Scraping: pin `puppeteer-extra` + `puppeteer-extra-plugin-stealth` to exact versions (`backend/package.json:25-26`); centralize `CUSTOM_SCRAPER_HOSTS` into one shared module (currently inline in `dailyCheck.ts:367` + duplicated in SCRAPER.md).
- Perf: `fetchAllRows`-wrap `/api/feed/companies`, `/api/catalog`, and `findExistingCompany`'s full-catalog fetch (`companies.ts:108`) before the catalog passes 1,000; collapse the favorites 3-trip read (`favorites.ts:33`) and the unfollow count+update (`companies.ts:752`).
- DB: `seen_jobs` grows forever (60-day archive only flips status, never deletes) — consider a longer hard-delete cycle + autovacuum tune; the feed's `count:'exact'` on every page load gets expensive at scale.

## DO NOT DO
- Do **not** add a `user_subscriptions(user_id)` index — it already exists (verified). The audit's claim was a false alarm.
