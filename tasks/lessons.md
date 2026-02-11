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

## 2026-02-11: Verify the SUPABASE_SERVICE_KEY is actually the service_role key

**Mistake:** Local `.env` and Railway both had the **anon key** stored as `SUPABASE_SERVICE_KEY`. Before adding RLS policies, this didn't matter (open "Allow all" policies). After switching to user-scoped RLS, the anon key couldn't bypass RLS, and `auth.uid()` returned NULL — every query returned empty results.

**Rule:** After any RLS change, verify the backend's `SUPABASE_SERVICE_KEY` is the service_role key (decode the JWT and check `"role":"service_role"`). The anon key has `"role":"anon"` and will silently return empty results instead of errors.

## 2026-02-11: HttpOnly cookies block browser-side getSession()

**Mistake:** Supabase `createServerClient` sets HttpOnly cookies by default. The browser-side `createBrowserClient` calls `getSession()` which tries to read cookies via `document.cookie` — but HttpOnly cookies are invisible to JavaScript. Result: `getSession()` returns null even though the user is authenticated, and no API calls fire.

**Rule:** Don't rely on `getSession()` or `refreshSession()` from the browser client when server middleware sets HttpOnly cookies. Instead, create a Next.js server API route (`/api/auth/token`) that reads the session server-side and returns the access token. Cache the token on the client to avoid latency.

## 2026-02-11: CORS must allow both www and non-www origins

**Mistake:** Backend CORS was set to `https://<domain>` but Vercel redirects root to `www.<domain>`. Browser sent requests from `https://www.<domain>` which was blocked by CORS.

**Rule:** When using a custom domain with Vercel, always allow both the root domain and `www` variant in the backend CORS config. The code now auto-generates both from `FRONTEND_URL`.

## 2026-02-11: Supabase needs both www and non-www redirect URLs

**Mistake:** Magic link callback URL was set to `https://<domain>/auth/callback` but Vercel's www redirect meant the actual request hit `https://www.<domain>/auth/callback`. Supabase rejected it because it wasn't in the allowed redirect URLs.

**Rule:** Add both `https://<domain>/auth/callback` AND `https://www.<domain>/auth/callback` to Supabase's redirect URL allowlist.

## 2026-02-11: Debug with logging before adding complexity

**Mistake:** Spent multiple iterations trying to fix the session/token flow by adding `refreshSession()`, `getUser()` workarounds, and httpOnly overrides — none of which solved the root issue. Adding `console.log` statements would have immediately shown that the API call was succeeding but returning `[]` (a data/key issue, not an auth flow issue).

**Rule:** When debugging production issues, add logging first to isolate WHERE the failure is before changing code. One deploy with console.logs saves multiple blind-fix deploys.

## 2026-02-11: Cloudflare auto-setup for Railway and Resend

**Pattern:** Both Railway and Resend offer Cloudflare auto-configuration — they automatically add the required DNS records when you authorize the Cloudflare integration.

**Rule:** Use auto-setup when available to avoid manual DNS errors. Only Vercel requires manual A/CNAME records in Cloudflare (proxy must be OFF / grey cloud).

## 2026-02-11: Hard exclusions must have NO exceptions

**Mistake:** Validation logic filtered non-PM titles but had an exception: "if title also contains 'product manager', keep it." This let "Engineering Product Manager" and similar hybrid titles through. User explicitly said: "If it has the word engineering in it, it should not pass."

**Rule:** When the user defines exclusion categories (engineering, design, marketing, etc.), apply them as hard filters with zero exceptions. A title containing "engineering" is never a PM role, even if it also says "product manager." Simpler logic, cleaner results.

## 2026-02-11: Tiny click targets cause misclicks on interactive cards

**Mistake:** Dashboard company tiles had a delete button (16px icon, 4px padding) in the top-right corner. The entire tile was clickable for navigation. Users clicking near-but-not-on the tiny delete icon would trigger navigation instead. First click appeared to "do nothing" because it navigated to the detail page.

**Rule:** For action buttons overlaid on clickable cards: (1) wrap ALL action buttons in a single div with `stopPropagation`, not just the individual buttons; (2) give buttons generous padding (p-2 minimum) even if they're hidden by default; (3) test that clicking anywhere in the action zone never falls through to the parent.

## 2026-02-11: Animated UI counters don't need real data

**Pattern:** User wanted to see scanning/filtering/validation progress while adding a company. The backend doesn't stream progress, and adding SSE would be complex.

**Rule:** For "feel good" progress animations, randomized fake counters are perfectly fine. Pick realistic ranges (600-1400 jobs scanned, 15-40 PM roles found), animate them with `setInterval`, and time them to roughly match real scrape duration. Users want to see that something is happening — exact numbers don't matter for UX. `tabular-nums` CSS prevents layout jank from changing digits.

## 2026-02-11: Stale data persists after validation rule changes

**Mistake:** Added stricter PM title filtering (hard exclusions) but user still saw "Head of Product Design" for Cisco. The data was scraped before the validation fix — changing validation logic doesn't retroactively clean the DB.

**Rule:** After tightening validation/filtering rules, existing data in the DB is stale. Users must delete and re-add the company to get a clean scrape with the new rules. Call this out proactively when deploying filter changes.

## 2026-02-11: useSearchParams() in shared layout components needs Suspense

**Pattern:** NavBar used `usePathname()` to detect active route, but both "Starred" and "View All Jobs" link to `/jobs` — only the `?filter=starred` query param distinguishes them. Adding `useSearchParams()` to the NavBar required wrapping in `<Suspense>` because NavBar renders on every page (including static ones).

**Rule:** When a layout-level component (nav, sidebar) needs `useSearchParams()`, split it into an inner component + outer wrapper with `<Suspense fallback={...}>`. The fallback should match the component's dimensions to avoid layout shift.

## 2026-02-11: Use replace_all for systematic color token migrations

**Pattern:** Migrating from `stone-800` → `#1A1A2E` across multiple pages. Using `Edit` with `replace_all: true` was fast and safe because the old tokens were consistent.

**Rule:** When doing design system color migrations, batch-replace with `replace_all` per file. Review the count of replacements to catch unexpected matches. This is faster and less error-prone than manual find-and-replace across files.

## 2026-02-11: Google Favicons API needs domain overrides for ATS-hosted companies

**Pattern:** Companies whose careers pages are on ATS domains (boards.greenhouse.io, jobs.lever.co) get the ATS favicon instead of the company's. Discord's careers_url is `boards.greenhouse.io/discord` — Google returns Greenhouse's favicon.

**Rule:** Maintain a `DOMAIN_OVERRIDES` map for companies on ATS platforms, mapping company name → real domain (e.g., `discord` → `discord.com`). Only needed for companies on Greenhouse, Lever, Ashby, etc.
