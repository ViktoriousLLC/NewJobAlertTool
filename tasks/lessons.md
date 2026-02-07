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
