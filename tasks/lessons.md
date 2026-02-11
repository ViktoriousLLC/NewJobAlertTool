# Lessons Learned

## 2026-02-07: Execute end-to-end, never leave manual steps

**Mistake:** After fixing scrapers, left "next steps" for the user to deploy and clean up data manually.

**Rule:** When a task involves code changes, always:
1. Commit and push (triggers auto-deploy)
2. Wait for deploy (~60s)
3. Call the production API to clean up / re-add data
4. Verify the result with API calls
5. Report back with proof

The user is often AFK. They want to come back to a finished result, not a to-do list.

## 2026-02-07: Create and maintain CLAUDE.md for project context

**Mistake:** Lost context across sessions about deployment URLs, API access, database operations, and autonomy preferences.

**Rule:** Keep `CLAUDE.md` in the project root with all institutional knowledge: production URLs, API endpoints, database schema, deployment workflow, scraper architecture. Update it when things change.

## 2026-02-07: Always delete + re-add companies after adding a new scraper

**Mistake:** Added Eightfold API scraper for PayPal and Stripe-specific scraper, but old jobs from the generic Puppeteer fallback remained in the DB with contaminated data (title + location + "Posted X days ago" mashed into one string, AE roles leaking through).

**Rule:** After adding or fixing a platform-specific scraper, always delete the company and re-add it via API. Old data from the generic fallback scraper will have different URL paths (so dedup won't catch them) and bad field parsing. A fresh scrape is the only way to get clean data.

## 2026-02-07: Wait for Railway deploy before triggering scrapes

**Mistake:** Pushed backend code change and immediately re-added Stripe. The scrape ran on the OLD code (returned 0 jobs in 3 seconds — too fast for Puppeteer). Had to delete and re-add after Railway finished deploying.

**Rule:** After pushing backend changes, wait at least 90 seconds before triggering any API operations that depend on the new code. Railway deploys take ~60s but occasionally longer.

## 2026-02-07: Investigate actual data before assuming scraper bugs

**Pattern:** User reported PayPal titles had location/date merged in. Initial investigation of the API showed clean data. The real issue was stale DB records from a previous scraper version — not a current code bug.

**Rule:** Always check the actual database data (via `GET /api/companies/{id}`) before diving into scraper code fixes. The problem might be stale data, not broken code.

## 2026-02-07: Frontend tables need fixed column widths

**Mistake:** All Jobs table used auto-width columns. Long location strings (e.g., "South San Francisco HQ, New York, Seattle, or Chicago | Remote in United States") expanded the location column and pushed Last Checked and View off-screen.

**Rule:** For data tables, use `table-fixed` layout with explicit `<colgroup>` column widths and `truncate` on cell content. Add `title` attributes so users can hover to see full text.

## 2026-02-10: Supabase DDL cannot be run through REST API or supabase-js

**Mistake:** Spent extensive time trying to create the `favorites` table programmatically — REST API, Management API, pg-meta, SQL endpoint, direct postgres (IPv6 failed), pooler (JWT can't be used as DB password). None worked.

**Rule:** For schema changes (CREATE TABLE, ALTER TABLE), use the Supabase SQL Editor in the dashboard. No way around it without the actual DB password or the Supabase CLI logged in. Don't waste time trying programmatic approaches.

## 2026-02-10: Next.js useSearchParams() requires a Suspense boundary

**Mistake:** Added `?filter=starred` URL param parsing with `useSearchParams()` — build broke because the hook must be wrapped in `<Suspense>`.

**Rule:** Any component using `useSearchParams()` needs a wrapper component that renders it inside `<Suspense fallback={...}>`. Create a thin wrapper that renders the actual component inside Suspense.

## 2026-02-10: Dual cron triggers cause duplicate work

**Mistake:** Backend had both an in-process `node-cron` schedule AND a Railway Cron service calling the same endpoint. Both triggered `runDailyCheck()`, causing duplicate emails at 2am and 6am.

**Rule:** Pick ONE cron mechanism. Railway Cron is better — survives restarts, visible in dashboard, configurable schedule. Remove any in-process cron schedulers (node-cron) to avoid duplication.

## 2026-02-10: Windows timeout command fails in non-interactive shells

**Mistake:** Used Windows `timeout` command to wait after deploy — exits with code 125 in non-interactive terminals.

**Rule:** Use `powershell -command "Start-Sleep -Seconds N"` instead of `timeout` on Windows.

## 2026-02-10: Resend API key is production-only

**Mistake:** Tried to send a one-off email locally but `RESEND_API_KEY` is empty in local `.env` — only set in Railway env vars.

**Rule:** To send one-off emails, add a temporary protected endpoint to the backend, push to deploy on Railway, call it via curl with CRON_SECRET, then clean up the endpoint.

## 2026-02-10: Optimistic UI updates need revert logic

**Pattern:** Star toggle uses optimistic updates — immediate UI state change, then API call in background. If the API call fails, the state change must be reverted.

**Rule:** When doing optimistic updates, always include a catch block that reverts the state to its previous value on failure.
