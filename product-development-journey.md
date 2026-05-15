# NewPMJobs: The Full Product Development Journey

How a personal localhost script became a production multi-user SaaS, built entirely with AI coding tools (Claude Code, Cursor). Every change here was a product decision, and every decision taught me something.

---

## TL;DR

| Phase | Problem | Solution | Key Learning |
|-------|---------|----------|-------------|
| 1. Localhost MVP | Spending 30+ min/day manually checking career pages | Express + Puppeteer script that scrapes Greenhouse and emails me | Build the smallest thing that works first. I found that Greenhouse has a free public data feed, so I didn't need to fake-browse their website at all. |
| 2. Going Live | Tool only worked on my laptop | Deployed backend to Railway, frontend to Vercel, daily cron for automated scrapes | When your frontend and backend live on different domains, browsers block the connection by default. Also, don't let your CDN and your hosting provider both try to manage security certificates. |
| 3. Scraper Expansion | Only covered Greenhouse companies | Built 7 scraper types (Greenhouse, Lever, Ashby, Workday, Eightfold, custom APIs, Puppeteer) with a 7-layer auto-detection engine | If a company's job board has a structured data feed, use that instead of loading the page in a browser. It's 100x faster and way more reliable. Every job board platform has its own weird edge cases. |
| 4. Multi-User Auth | Only I could use it | Magic link auth, shared company catalog, per-user subscriptions, admin dashboard, rate limiting | My database had two keys: one for regular users, one for admin access. Using the wrong one made every query silently return nothing. Also, login links sent by email don't work if you open them on a different device than where you requested them. |
| 5. Check-Then-Add UX | Users could add a company and get garbage results | 4-state preview flow: input, checking, preview, confirm/retry. Nothing saved until user confirms. | What happens when things go wrong matters more than what happens when things go right. Also, matching companies by URL is way more reliable than matching by name ("OpenAI" vs "Open ai"). |
| 6. Compensation Data | Job listings never show salary | Three-tier cache (memory 0ms, DB 50ms, live 1-3s) for levels.fyi data, lazy-loaded on frontend | Fetch salary data in the background the moment a company is added. By the time the user wants it, it's already there. If a data source is down, remember that it's down for 5 minutes so you don't keep asking. |
| 7. Landing Page | Strangers saw a login page with zero context | 10-section marketing page rendered as a fixed overlay, zero changes to existing app shell | Instead of restructuring the whole app to handle logged-out visitors, I layered the landing page on top of the existing app. Zero risk of breaking what already worked. |
| 8. Performance | Desktop Lighthouse was 49 after building the landing page | Code-split above/below fold, pre-computed brand colors, deferred PostHog init | Page speed score went from 49 to 100 with three changes: only load what's visible first, don't recalculate things that never change, and don't load analytics until the page is already showing. Always measure before guessing what's slow. |
| 9. Security | App wasn't safe for real users | CSP headers, open redirect fix, XSS escaping, SSRF protection, PII scrubbed from logs, DNS security | Security problems exist from day one; you just don't notice them until other people use your app. The scariest one: someone could submit a fake "careers URL" that tricks your server into fetching private internal data. |
| 10. Email Reliability | Alert emails hitting rate limits, some users missing alerts | Batch sending (100/call), admin failure notifications, custom email domain | Even with just a few users, sending emails one at a time hit the provider's speed limit. Sending them in batches of 100 fixed it. Also, login emails and alert emails share the same daily quota, which I didn't realize at first. |
| 11. Monitoring | Errors were invisible unless I manually checked logs | Sentry on frontend + backend (18 catch blocks), PostHog with SHA-256 hashed user IDs | Never send real email addresses to analytics tools. Scramble them first. And error tracking only works if you add it to every single place something can fail, not just the obvious ones. |
| 12. Cron Reliability | Daily scrape sometimes didn't finish | Await-based cron endpoint, overlap guard, 120s Puppeteer timeout, single-source scheduling | My hosting provider puts the server to sleep when it's idle. If the daily job says "start scraping" and immediately hangs up, the server falls asleep mid-scrape. It has to stay on the line until the work is done. |
| 13. DB Performance | Queries slowing as data grew | Targeted indexes based on actual query patterns, parallel query execution, local JWT verification (0ms vs 150ms) | Database indexes are like a book's index: add them for the questions you actually ask, not every possible question. Also, verifying login tokens locally instead of calling an external service cut 150ms off every single request. |
| 14. AI Tools | Building a full-stack SaaS as a PM, not an engineer | Used Claude Code for implementation, maintained CLAUDE.md as persistent context, steered all product/architecture decisions | AI wrote the code, but I made every product decision. The key skill is keeping a detailed context file so the AI remembers your architecture across sessions. Without it, you re-explain everything constantly. |
| 15. Self-Healing Scrapers | Companies change job platforms without warning, breaking the scraper silently | Auto-remediation detects platform migrations and re-scrapes, two-tier admin email shows what was fixed vs what needs attention | The hardest bugs to find are the ones that look like "working correctly." Zero PM jobs from a company could mean "they're not hiring PMs" or "the scraper is broken." Distinguishing between those two requires knowing that scrapers pre-filter internally, so an empty result is ambiguous. |
| 16. Data Quality Pipeline | Microsoft showed 157 jobs including India, daily email had no quality checks | Backend location filtering (US only), daily eval email with per-company scorecard showing what passed and what failed | Filtering in the UI isn't filtering. If the backend stores and emails unfiltered data, the "filter" is just hiding the problem from some users while showing it to others. Always apply data quality rules at the source. |
| 17. Puppeteer Elimination + Catalog Expansion | 10 companies broke overnight, catalog was only 55 companies | Researched ATS for every company, built 5 new scraper types, expanded catalog to 126 (118 API-based), ran full security audit | When a dependency breaks, the fix isn't to patch the dependency. It's to ask whether you need it at all. Also: npm version ranges (^) in Docker builds are a time bomb. Pin exact versions. |
| 18. Self-Healing Scraper Layer | Coinbase quietly deleted their public job board; one company breaks per month and I have to manually investigate each time | Three-tier auto-recovery (configured scraper → platform auto-detect → stealth browser fallback), auto-disable after 7 failures, Monday probe re-enables companies that come back online | The right fix for "this one company broke" is usually "build the recovery system that catches the next ten." Coinbase specifically can't be saved — but the architecture that handles it gracefully also handles every silent ATS migration that hasn't happened yet. |
| 19. Less Noise, Tighter Security | Self-healing system was sending 3 admin emails a day, mostly success notifications I didn't need. Last security audit was a few weeks old and the docs were quietly out of sync with what the code actually did. | Consolidated 3 emails into 1 digest that fires only when something needs my attention. Ran 3 parallel security audits, shipped 11 fixes including a cookie security bug where the code contradicted its own documentation, a cross-user data leak on a read endpoint, and a published rate-limiter CVE. Added weekly npm-audit check to the Monday email. | A system that emails you about every success trains you to ignore the channel by the time something actually needs your attention. Also, your own documentation drifts from the code during refactors, which is the whole reason audits exist. Three specialized review agents found things one general pass would have missed. |
| 20. Specialized AI Agents and PR-Gated Deploys | Every task in Claude Code started from zero context, so the assistant had to re-derive the project rules every time. And I was one careless push away from a bad change reaching production. | Built a portfolio of 13 specialized subagents that live in the repo. Five are custom and encode project-specific knowledge like the three-tier scraper recovery and the proven security audit pattern. Eight are forked from public collections and heavily trimmed. Also turned on GitHub branch protection plus Railway and Vercel preview environments, so every change goes through a pull request with a working preview before I can merge it. | The win from a roster of specialists is not the agents themselves. It is having a predictable output contract per task type, so reviewing the work is a 30-second scan instead of reading prose. Also, most public agents are written for enterprise teams and need 50 to 70 percent of their bloat removed before they fit a solo project. Borrow the bones, throw out the marketing. |
| 21. Silent Zero Failures and Three New ATS Platforms in One Night | I'd quietly accumulated about 90 companies showing zero PM jobs in the catalog. Some were genuinely not hiring PMs. Some were silently broken scrapers. There was no way to tell which was which from the admin email, and the structural problem was that "scraper returned zero" looks identical to "company has nothing open." | Shipped four phased pull requests in one evening. The first added two columns to the companies table that flip when either a scraper proves itself or I manually confirm a legit zero, and made the daily admin email list every unconfirmed zero until it's been triaged. The next three built or fixed scrapers for Apple, Shopify, eBay, Sony, Pandora, Zendesk, plus a dozen smaller ATS-config corrections, and added new platform types for Apple's REST API, Shopify's embedded Ashby in a React Flight streaming payload, and a generic Phenom People parser. I used parallel specialized agents to research each scraper, the change reviewer agent to audit before merging, and live curl tests to verify every parse path before integrating. Two agents had their work discarded because better prior art surfaced mid-build, which is the system working correctly. Four companies got hard-deleted because no scraper path existed and nobody was subscribed. | The most important fix wasn't any specific scraper. It was redefining what counts as a failure. A zero-PM scrape with success status used to be invisible. Now every unverified zero appears in the email until I confirm it's legitimate or the scraper recovers, which forces a real decision per company. The same trick applies anywhere you have a "absence of bad signal looks like a good signal" failure mode. Also: prior art is for orientation, not blind trust. The first scraper I built tonight, Apple, had a published reference that turned out to be stale. The agent's reverse-engineering caught the current API state. Always re-verify with a live test before committing to a path someone else documented. |

---

## Phase 1: The Localhost MVP

**Goal:** Stop manually checking career pages every morning.

I was spending 30+ minutes a day visiting individual company career sites, searching for PM roles, and trying to remember which listings were new. The idea was simple: write a script that does the checking for me and emails me when something new shows up.

### What I Built

An Express backend with a Puppeteer scraper that hit a handful of Greenhouse career pages, filtered jobs by PM-related keywords, stored results in a PostgreSQL database, and ran on my local machine. No frontend. No authentication. Just a script I could trigger manually and an email that would land in my inbox.

**Stack:** Express, Puppeteer, PostgreSQL (Supabase), Resend for email.

### What I Learned

**Start with the smallest version that solves your problem.** The first version didn't have a UI, didn't support multiple users, and only knew about one type of career page (Greenhouse). But it answered the only question that mattered: "Are there new PM roles today?" That was enough to validate that the tool was worth building further.

**Greenhouse has a public API most people don't know about.** Instead of scraping HTML, I could hit `api.greenhouse.io/v1/boards/{boardName}/jobs` and get structured JSON. This was faster, more reliable, and didn't require a browser. This insight shaped the entire scraper architecture going forward: always prefer APIs over HTML scraping.

---

## Phase 2: Going Live

**Goal:** Access the tool from anywhere, not just my laptop.

Running on localhost meant I had to have my computer on. If I was traveling or on my phone, I couldn't check results. The tool needed to be a real website.

### What I Built

Deployed the backend to Railway (auto-deploys from git push) and built a Next.js frontend on Vercel. Set up a custom domain on Cloudflare. Added a Railway Cron job to trigger the daily scrape automatically at 9 AM ET, so I didn't need to run anything manually.

**Stack additions:** Next.js 16 (Vercel), Railway Cron, Cloudflare DNS.

### Key Decisions

**Railway + Vercel instead of a single platform.** The backend needs Puppeteer (a headless browser), which is resource-heavy and doesn't run well on serverless. Railway gives me a persistent container. The frontend is static-ish Next.js, which Vercel handles perfectly. Splitting them added CORS complexity but let each layer use the best tool.

**Cloudflare DNS-only mode (grey cloud).** I initially tried Cloudflare's proxy (orange cloud) for SSL, but both Vercel and Railway manage their own SSL certificates. The proxy caused certificate conflicts. Lesson: when your hosting provider handles SSL, keep the CDN in DNS-only mode.

### What I Learned

**Deploy timing matters more than you'd think.** After pushing code, Railway takes about 60 seconds and Vercel about 30 seconds to deploy. I kept testing too early and seeing old behavior. Built in a habit of waiting 90+ seconds after every push before verifying.

**CORS with www redirects is a trap.** Vercel redirects the root domain to the www subdomain. My backend CORS config only allowed the root origin, so authenticated requests from `www.` were getting blocked. The fix was to auto-detect and allow both origins from a single `FRONTEND_URL` env var.

---

## Phase 3: Expanding Scraper Coverage

**Goal:** Cover the companies I actually care about, not just the ones on Greenhouse.

The MVP only worked for Greenhouse companies. But companies I wanted to track (Stripe, Google, OpenAI, Slack, Netflix) used different ATS platforms or entirely custom career pages.

### What I Built

A multi-platform scraper that supports seven different approaches:

- **Greenhouse API** for DoorDash, Discord, Reddit, Instacart, Figma, Airbnb, a16z, Twitch
- **Lever API** for any company on jobs.lever.co
- **Ashby GraphQL** for OpenAI and others on jobs.ashbyhq.com
- **Workday JSON API** for Slack, Salesforce, and others on myworkdayjobs.com
- **Eightfold API** for PayPal
- **Custom API handlers** for Uber, Netflix, Atlassian (each has a unique API format)
- **Puppeteer HTML scraping** as the fallback for Stripe, Google, and unknown sites

Built a 7-layer platform auto-detection engine so that when someone pastes a careers URL, the system automatically figures out which ATS is behind it: known hostnames, direct ATS URLs, HTML embed detection, SPA rendering, speculative API probes, and generic fallback.

Added post-scrape validation that quality-scores every scrape run: catches zero results, vague locations, duplicates, and invalid URLs.

### Key Decisions

**API-first scraping with Puppeteer as fallback.** API scrapes finish in under 1 second. Puppeteer scrapes (like Stripe) take 2 to 3 minutes because they load real browser pages. For the daily cron, this difference matters enormously. Every new company I add, I first check if there's a structured API available.

**17 PM-specific keywords instead of broad scraping.** I could return all jobs, but that would bury the signal. Filtering by keywords like "product manager," "product lead," "product growth," and "product ops" keeps the results relevant. The tradeoff: some edge cases slip through. When a16z showed zero PM roles despite having many jobs, I discovered they use "Product Growth" as a title, which wasn't in my keyword list. Added it on 2026-02-21.

**Speculative API probes.** Some companies (like Twitch) host their career page on a custom domain but actually use Greenhouse behind the scenes. My detection engine extracts the company slug from the hostname and speculatively tries it against Greenhouse and Lever APIs in parallel. This catches companies that would otherwise fall through to the slow Puppeteer path.

### What I Learned

**Every ATS has quirks.** Salesforce's `careers.salesforce.com` redirects to a marketing page with zero jobs. The actual job board is a Workday URL at a completely different domain. Reddit's Greenhouse board requires department-level fetching plus keyword filtering because their board structure is non-standard. Each new company taught me something about how career pages actually work in practice.

**Stale data is a silent killer.** When I added a proper Eightfold API scraper for PayPal, the old Puppeteer-scraped jobs were still in the database with garbage data (title, location, and date mashed into a single field). I had to learn the hard way: after changing a scraper, always delete the company and re-add it to flush the stale data.

**Quality validation prevents silent failures.** Early on, a scraper change would sometimes return zero results or bad data, and I wouldn't notice until I manually checked days later. Adding automated validation after every scrape (quality scores, zero-result flags, duplicate detection) caught these problems immediately.

---

## Phase 4: Authentication and Multi-User Architecture

**Goal:** Let other people use the tool, not just me.

The original version had no login. Every company was mine, every job was mine. To share the tool, I needed authentication, data scoping, and a way for each user to track their own set of companies.

### What I Built

**Authentication via magic links.** No passwords to store, no password reset flow to build, no brute force attacks to worry about. User enters email, gets a link, clicks it, done. Implemented using Supabase Auth with Resend as the SMTP provider.

**Shared company catalog with per-user subscriptions.** Instead of each user having their own copy of "Uber" (scraped separately), there's one shared entry. Users subscribe to the companies they want to track. This means one daily scrape serves all users, and the scraping cost scales with the number of companies, not users.

**New database tables:** `user_subscriptions` (links users to companies), `user_job_favorites` (per-user bookmarks), `user_preferences` (email frequency: daily, weekly, or off), `user_new_company_submissions` (rate limit: 10 per user).

**Admin dashboard** at `/admin` with stats (users, companies, jobs, errors), scrape issue reports, help submissions, and user management. Access restricted to a single admin email.

**Rate limiting** on all API routes: 100 requests per 15 minutes for reads, 20 for writes, 5 for the scrape-preview endpoint.

### Key Decisions

**Shared catalog vs. per-user companies.** This was the biggest architectural decision in the project. Per-user would be simpler (no subscription tables, no shared state), but it would mean scraping the same company once per user. With a shared catalog, scraping cost is O(companies) not O(companies times users). The tradeoff is that users can't customize which roles they see per company, but PM roles are PM roles regardless of who's looking.

**Magic links instead of passwords.** The security surface is dramatically smaller: no credential storage, no password resets, no brute force. The tradeoff is that login requires email access, which adds friction on mobile (switch to email app, click link, switch back). But for a tool where users log in once and then get daily emails, the reduced security surface was worth it.

**Job archival instead of hard deletion.** When a job disappears from a careers page, I mark it "removed" instead of deleting it. After 60 days, it moves to "archived." This preserves favorited jobs. Users who bookmarked a listing don't lose it when the company takes it down. Slightly more database storage, but storage is cheap and losing someone's bookmarks is a bad experience.

### What I Learned

**HttpOnly cookies create a frustrating browser limitation.** Supabase Auth stores the JWT in an HttpOnly cookie (which is good for security: JavaScript can't access it). But my frontend needs the token to call the backend API. The solution: create a Next.js server route (`/api/auth/token`) that reads the cookie server-side and returns the token. The client caches it in memory. This is a common pattern but it's not obvious until you hit the wall.

**The PKCE magic link flow breaks across devices.** My first auth implementation used PKCE, which stores a code verifier cookie in the browser where you requested the magic link. If you open the link in a different browser (or in your email app's built-in webview), the code verifier doesn't exist and login silently fails. Fixed on 2026-02-22 by switching to a token-hash verification flow that works from any device.

**Service key vs. anon key is a subtle, critical distinction.** Supabase has two keys: `anon` (respects Row Level Security) and `service_role` (bypasses RLS). My backend was using the anon key by mistake, and `auth.uid()` was returning NULL for every query, making all user-scoped queries return empty. The error was invisible because the queries succeeded with zero results rather than throwing an error. Always verify the JWT `role` claim on your keys.

**N+1 queries sneak in during multi-user rewrites.** When subscribing a user to N companies, my first implementation ran 2N sequential database queries (one to subscribe, one to update the subscriber count, per company). Batching these into parallel operations with `Promise.all()` cut the response time dramatically. I now audit every new feature for this pattern before shipping.

---

## Phase 5: UX - Check-Then-Add Flow

**Goal:** Don't let users add a company and get garbage results.

The original "add company" flow was: paste URL, click Add, and hope the scraper finds PM roles. If it didn't work, the company was already in the database with zero jobs and the user had no idea why.

### What I Built

A preview-before-commit flow with four states:

1. **Input:** User pastes a careers URL (company name auto-detected from the URL)
2. **Checking:** Animated progress (the scraper runs but saves nothing to the database)
3. **Preview:** Shows the detected company name, sample job titles and locations, and "Found X PM roles. Does this look right?"
4. **Confirm or retry:** "Yes, Add It" saves to DB. "No, Try Again" lets the user fix the URL and provide feedback. "Cancel" after feedback files it as a help submission for admin review.

Also built a company name auto-detection system that recognizes 40+ known hostnames, falls back to ATS slug extraction, then to generic hostname parsing.

If the URL matches an existing company in the catalog, the system surfaces it and offers to subscribe instead of creating a duplicate.

### Key Decisions

**Preview without saving.** The `POST /api/companies/check` endpoint runs the full scrape pipeline but returns the results without touching the database. Only when the user confirms does `POST /api/companies` fire, and it passes the pre-checked jobs along so the scraper doesn't need to run twice.

**URL-based dedup instead of name-based.** Early versions checked for duplicate companies by name, but "Open ai" vs. "OpenAI" vs. "openai" caused false negatives. Switching to URL domain extraction is much more reliable.

### What I Learned

**Error recovery UX matters more than happy-path UX.** Most users will hit the happy path and never think about it. But when the scraper returns zero results or the wrong jobs, the user needs a clear way to understand what happened and try again. The "retry with feedback" state turned a dead end into a recoverable flow, and the feedback submissions gave me real data on which companies needed scraper improvements.

**Auto-detecting company names is surprisingly hard.** The same ATS platform uses different URL patterns: `boards.greenhouse.io/figma`, `jobs.lever.co/stripe`, `careers.google.com`. Each needs different parsing logic to extract a clean company name. The 40+ hostname lookup table was built one company at a time as I hit new edge cases.

---

## Phase 6: Compensation Data Integration

**Goal:** Show users what these PM roles actually pay.

Job listings rarely include salary. But levels.fyi has crowdsourced compensation data for most tech companies. If I can show salary ranges alongside job listings, the tool becomes much more useful.

### What I Built

A three-tier caching system for levels.fyi compensation data:

| Tier | Latency | TTL |
|------|---------|-----|
| In-memory Map | ~0ms | 1 hour |
| Database (comp_cache table) | ~50ms | 24 hours |
| Live fetch from levels.fyi | 1 to 3 seconds | Fills both caches |

Compensation data is preloaded when a company is added (fire-and-forget after the API responds), refreshed by the daily cron in batches of 3 with 2-second delays, and served lazily on the company detail page so it never blocks the page load.

Also added job level classification (early/mid/director) based on title keywords, so salary ranges can be shown per level.

### Key Decisions

**Three-tier cache instead of fetching on demand.** levels.fyi responses take 1 to 3 seconds. If I fetched on every page load, the company detail page would feel sluggish. The memory cache serves most requests in ~0ms. The DB cache catches cold starts. Live fetches only happen when data is truly stale.

**Cache failures for 5 minutes.** If levels.fyi is down or doesn't have data for a company, I cache the failure for 5 minutes to prevent hammering the same endpoint repeatedly. Without this, a single missing company would generate a live fetch on every page load.

**Lazy loading on the frontend.** The company detail page renders immediately with job listings (~200ms). Compensation data loads asynchronously and appears when ready. The user sees content instantly rather than waiting for everything.

### What I Learned

**Fire-and-forget is the right pattern for preloading.** When a user adds a company, they care about seeing their jobs on the dashboard. They don't care about compensation data at that moment. Kicking off the comp fetch after the response is sent means the user doesn't wait for it, but by the time they click into the company, the data is already cached.

**Batched cron refreshes prevent rate limiting.** If the daily cron tried to refresh all 50+ companies' comp data at once, it would hit rate limits. Batching 3 at a time with 2-second delays keeps the requests manageable and is still fast enough to complete within the cron window.

---

## Phase 7: The Landing Page

**Goal:** Explain the product to strangers who land on the homepage.

Up to this point, unauthenticated visitors saw a login page. No context about what the product does, who it's for, or why they should sign up.

### What I Built (2026-02-19)

A 10-section marketing landing page:

1. Fixed nav (transparent, transitions to solid navy on scroll)
2. Hero (dark gradient, floating company cards with toast notifications, email CTA)
3. Problem statement (2x2 pain point cards)
4. How it works (3 step cards)
5. Product screens (3 macOS-style mock UIs: dashboard, all jobs, job detail)
6. Latest jobs (9 sample job rows with hover effects)
7. levels.fyi salary callout
8. Stats (companies tracked, total jobs, etc.)
9. Final CTA
10. Footer

Architecture: the landing page renders as a fixed overlay on top of the app shell. Authenticated users see the dashboard directly. Zero changes needed to the existing layout, navbar, or help button.

### What I Learned

**The overlay approach avoids the riskiest refactor.** Instead of restructuring `layout.tsx` to conditionally render different shells for authenticated vs. unauthenticated users (which could break the existing app), the landing page simply covers everything with `position: fixed; z-index: 200`. The app renders behind it, invisible. When the user logs in, the overlay disappears and the app is already there. This was a deliberate "minimize blast radius" decision.

**Scroll detection on overlays doesn't use `window`.** Because the landing page is a fixed-position overlay with its own scroll, `window.addEventListener('scroll')` doesn't fire. The nav scroll detection had to listen to the overlay container's scroll events instead. Small detail, but it blocked the transparent-to-solid nav transition until I figured it out.

---

## Phase 8: Performance Optimization

**Goal:** Ship a landing page that loads fast, especially on first visit.

After building the landing page, Lighthouse desktop score was 49. The page had too much JavaScript loading upfront: 1,500+ lines of landing page code, brand color calculations running on every render, and PostHog analytics blocking the main thread before first paint.

### What I Built (2026-02-22)

Three targeted optimizations:

**Code-splitting.** Split the 1,528-line landing page into two chunks: above-fold hero (783 lines, loads immediately) and below-fold sections (791 lines, lazy-loaded via `next/dynamic` with `ssr: false`). Users see the hero instantly while the rest loads in the background.

**Pre-computed brand colors.** The landing page used a `mix()` function to blend brand colors toward white for card backgrounds. With 16 companies and 5 color variants each, that was ~80 runtime calculations per render. Moved the computation to module-level initialization so it runs once when the file loads.

**Deferred PostHog initialization.** PostHog's `posthog.init()` was running at top-level module scope, which blocked the main thread before the first paint. Moved it into a `useEffect` inside the PostHog provider so it runs after the page is visible.

Also added a browserslist config (`defaults and supports es6-module`) to drop legacy polyfills like `Number.isInteger`.

**Result:** Desktop Lighthouse went from 49 to 100 (TBT dropped to 0ms). Mobile stayed at 72 to 77, bottlenecked by React DOM's 225KB runtime, which is beyond what I can optimize without converting to React Server Components.

### What I Learned

**Measure before optimizing.** The three fixes I made were guided by Lighthouse diagnostics. Without measuring, I might have guessed wrong about what was slow. The PostHog blocking, for example, wasn't obvious until I looked at the Total Blocking Time breakdown.

**There's a ceiling set by your framework.** On mobile, the bottleneck is React DOM itself (225KB). No amount of code-splitting or lazy-loading will fix that. The next step would be converting the landing page to a React Server Component (pure HTML, no React runtime for static sections), but that's a bigger architectural change.

**Pre-computation is underrated.** Moving the brand color calculations from render-time to module-load time eliminated ~80 function calls per render with a one-line change. Always check: is this computation the same every time? If yes, compute it once.

---

## Phase 9: Security Hardening

**Goal:** Get the app ready for real users who aren't me.

Before sharing the URL publicly, I ran a security audit. Single-user tools can get away with shortcuts. Multi-user tools cannot.

### Security Headers (2026-02-21)

Added five security headers to all frontend responses:

- **Content-Security-Policy:** Whitelist of allowed sources for scripts, styles, images, and API connections. Built dynamically from environment variables so it works across environments. Blocks XSS, data exfiltration, and script injection.
- **Strict-Transport-Security:** Forces HTTPS for 2 years with preload.
- **X-Frame-Options: DENY** to block iframe embedding (clickjacking prevention).
- **X-Content-Type-Options: nosniff** to prevent MIME-type sniffing.
- **Referrer-Policy:** Controls how much URL information leaks to third parties.

### Full Security Audit (2026-02-23)

Six fixes deployed in 2 commits:

1. **Open redirect prevention.** The `/auth/confirm` endpoint accepted a `?next` parameter for post-login redirects. An attacker could set it to `//evil.com` and redirect users after login. Fixed by validating that `?next` is a relative path only.
2. **XSS in help emails.** User-submitted feedback was being embedded in admin notification emails without escaping. A user could inject HTML/JavaScript that would execute when the admin opened the email. Added `escapeHtml()` to all user input before embedding in email templates.
3. **Hardcoded admin email.** The help route had the admin email hardcoded in the source code rather than reading from an environment variable. Extracted to a shared constant.
4. **PII in server logs.** User email addresses were being logged during the daily cron run. Replaced with truncated user IDs.
5. **Scraper timeout.** The generic Puppeteer scraper had no timeout, meaning a hanging page could block the entire daily cron indefinitely. Added a 120-second `Promise.race` timeout.
6. **Cron overlap guard.** If the cron triggered while a previous run was still going (unlikely but possible on slow days), it would run two scrapes simultaneously. Added a `dailyCheckRunning` flag to prevent concurrent runs.

### Input Validation and SSRF Protection

- UUID regex validation on all ID parameters (subscription endpoints, company endpoints)
- HTTPS-only URLs when adding companies (blocks HTTP)
- LinkedIn URLs blocked (their career pages are JavaScript-heavy and never scrape correctly)
- Private IP ranges blocked to prevent SSRF (Server-Side Request Forgery), where someone could use the scraper to probe internal networks

### DNS Security

Configured DMARC, DKIM, and SPF records for the email domain so that alerts emails are less likely to land in spam and harder for attackers to spoof.

### What I Learned

**Security isn't a feature you add at the end; it's a list of things that are always wrong.** Every one of these issues existed from day one. The open redirect, the XSS in emails, the PII in logs. None of them caused problems while I was the only user. But they would have been exploitable the moment I shared the URL.

**CSP is powerful but painful with Next.js.** Next.js injects inline scripts and styles for hydration, which means you can't use a strict CSP without nonce-based exceptions. For now, `unsafe-inline` is required for scripts and styles. Nonce-based CSP is a future upgrade.

**SSRF is a real risk for any tool that fetches URLs.** My tool lets users submit careers URLs that the backend then fetches. Without validation, someone could submit `http://169.254.169.254/latest/meta-data/` and probe AWS metadata endpoints, or `http://localhost:5432` to scan internal services.

---

## Phase 10: Email System and Reliability

**Goal:** Deliver daily alerts reliably without hitting rate limits or losing emails.

### What I Built

**Per-user personalized alerts.** The daily cron fetches all users, checks their email preference (daily, weekly, or off), queries new jobs only for their subscribed companies, and sends one email per user with their personalized results.

**Batch email sending (2026-02-22).** Replaced individual `resend.emails.send()` calls with `resend.batch.send()` (up to 100 emails per API call, 1-second delay between batches).

**Admin failure notifications.** If any email batch fails, the system sends a single summary email to the admin with error details and a link to the Resend dashboard.

**Custom email domain.** Alerts come from `alerts@newpmjobs.com` and magic links from `noreply@newpmjobs.com`, both via Resend. Company logos (Google favicons) are included in the email for visual recognition.

### What I Learned

**Rate limits hit before you expect them.** Even with only a handful of users, individual email API calls exceeded Resend's 2 requests per second limit. The 429 errors caused some users to miss their daily alerts. Batch sending was a day-one necessity, not a scale optimization.

**SMTP and API share the same quota.** Magic link emails go through Supabase's SMTP integration with Resend. Daily alerts go through Resend's API directly. Both count against the same 100 emails/day free tier limit. This meant that on days with many signups (more magic links), there was less room for alert emails.

---

## Phase 11: Monitoring and Analytics

**Goal:** Know when things break before users tell me, and understand how people use the product.

### What I Built

**Sentry for error tracking.** Integrated on both frontend (`@sentry/nextjs`) and backend (`@sentry/node`). Added `Sentry.captureException(err)` to all 18 backend route catch blocks. Frontend uses session replay to see what users experienced before an error. Reduced replay sample rate from 100% to 10% on 2026-02-23 to control costs.

**PostHog for product analytics.** Tracks pageviews, company additions, deletions, job starring, and dashboard filter usage. User identity is hashed with SHA-256 before being sent to PostHog (no raw email addresses leave the system). Initialization is deferred to avoid blocking the main thread.

**Uptime monitoring.** External service pings `/api/health` to detect outages.

### What I Learned

**Hash PII before sending it to analytics.** PostHog doesn't need to know a user's actual email. A SHA-256 hash lets me track unique user behavior without storing identifiable information in a third-party system.

**Error capture requires discipline.** Adding Sentry to 18 catch blocks across the backend was tedious but essential. Before this, errors were silently logged to Railway's console, which I had to manually check. Now any unhandled error triggers an alert.

---

## Phase 12: Cron Reliability and Operations

**Goal:** Make sure the daily scrape actually completes, every day, without manual intervention.

### What I Built

**Await-based cron endpoint (2026-02-24).** The `/api/cron/trigger` endpoint must `await runDailyCheck()` before sending a response. My original version returned immediately (fire-and-forget), and Railway's auto-sleep feature would kill the backend process before scraping finished. This caused missed alerts on weekends when there was no other traffic keeping the service alive.

**Single-source scheduling.** Removed an in-process `node-cron` scheduler that was causing duplicate runs when Railway's cron also triggered. Only Railway Cron is allowed to initiate the daily check.

**Overlap guard.** A `dailyCheckRunning` flag prevents a new run from starting if the previous one hasn't finished. This protects against Railway triggering twice (rare but possible).

**120-second Puppeteer timeout.** Generic scraper pages that hang (redirects to login, JavaScript errors, slow CDNs) are killed after 2 minutes rather than blocking the entire cron run.

### What I Learned

**Serverless/auto-sleep infrastructure changes the rules.** Railway keeps your backend running while it's receiving requests but puts it to sleep after a period of inactivity. Fire-and-forget patterns that work fine on always-on servers fail silently on auto-sleep infrastructure. The cron endpoint has to hold the connection open until the work is done.

**Duplicate runs are worse than missed runs.** A missed scrape means users get yesterday's data. A duplicate scrape means two concurrent processes fighting over the database, potentially creating duplicate job entries or sending duplicate emails. The overlap guard was added after I noticed double emails during testing.

---

## Phase 13: Database and Query Performance

**Goal:** Keep the app fast as the number of companies, jobs, and users grows.

### What I Built

**Targeted database indexes (2026-02-12 onward):**
- `(company_id, job_url_path)` unique index for fast deduplication
- `(company_id, is_baseline, first_seen_at)` composite index for dashboard "new jobs today" queries
- `(company_id, status)` for filtering active vs. removed jobs
- `(status, first_seen_at DESC)` for the all-jobs sorted list
- `(is_active)` for the scraper to quickly find companies that need checking

**Parallel query execution.** The company detail endpoint runs 3 queries in parallel (`Promise.all`): company row, jobs list, and sibling company names. The dashboard runs 2 parallel queries: today's new jobs (for badge counts) and latest job per company (for sorting).

**Database-level filtering.** The "new jobs today" calculation runs in PostgreSQL (`gte("first_seen_at", todayISO)`) rather than filtering in JavaScript. Let the database do what it's good at.

**Auth fast path.** JWT verification happens locally using `SUPABASE_JWT_SECRET` (~0ms) instead of calling Supabase's API (~100 to 150ms per request). The fallback to the Supabase API is only used if the local verification fails.

### What I Learned

**Indexes should be added based on actual query patterns, not guesses.** I added the composite index on `(company_id, is_baseline, first_seen_at)` after noticing that the dashboard's "new jobs today" query was doing a full table scan as the job count grew. The index made it instant.

**Local JWT verification is a massive win.** Every authenticated API call was adding 100 to 150ms of latency for a round-trip to Supabase. Adding local JWT verification with the secret key eliminated that entirely. This is one environment variable that, if removed, makes every API call noticeably slower.

---

## Phase 14: Building with AI Tools

**How I used AI throughout this project.**

This entire product was built using AI coding tools, primarily Claude Code (command-line agentic coding). Here's what that actually looked like in practice:

**What AI did well:**
- Scaffold new features end-to-end (new API routes, database schema, frontend components)
- Write scraper implementations once I described the ATS platform's API format
- Debug production issues from error logs
- Perform repetitive refactors (adding Sentry to all 18 catch blocks, switching from individual to batch email sends)
- Generate boilerplate (security headers, CORS config, rate limiting middleware)

**Where I had to steer:**
- Architecture decisions (shared catalog vs. per-user, magic links vs. passwords) required my product judgment
- The CLAUDE.md context file was essential. Without a comprehensive description of the system's architecture, the AI would make changes that conflicted with existing patterns. Maintaining this file was an ongoing investment that paid off every day.
- Debugging subtle issues (the service_role vs. anon key problem, the PKCE cross-device failure, the Railway auto-sleep interaction) required me to understand what was happening, even if AI wrote the fix
- UX decisions (the check-then-add state machine, what the landing page should communicate) came from product thinking, not code generation

**The CLAUDE.md pattern.** I maintained a detailed project context file (architecture, API endpoints, database schema, key decisions, gotchas) that served as the AI's memory across sessions. Every time I learned something the hard way (Salesforce's redirect trap, Cloudflare's proxy conflict, HttpOnly cookie limitations), I added it to the file. This turned painful lessons into institutional knowledge that the AI could reference in future sessions.

### What I Learned

**AI coding tools don't replace product thinking. They accelerate it.** The PM decisions (what to build, what to prioritize, what tradeoffs to make) were all mine. The AI handled the implementation. This meant I could move at 5 to 10x the speed of writing every line myself, but only when I was clear about what I wanted. The times I moved slowest were when I was fuzzy on the product direction, not when the code was complex.

**Context management is a skill.** The difference between productive AI coding and frustrating AI coding is how well you maintain context. A well-written CLAUDE.md file is the difference between "build the check-then-add flow" (AI knows the architecture, the state machine, the existing patterns) and spending 30 minutes re-explaining the project every session.

---

## Phase 15: Self-Healing Scrapers

**Goal:** Stop scraper failures from being invisible until a user complains.

### What I Built

Companies change their job board platforms without warning. Anthropic moved from Ashby to Greenhouse. Microsoft's Eightfold API started returning HTML instead of JSON from a custom domain. When these things happen, the daily scrape silently returns zero results, and nobody knows until someone checks their dashboard days later.

I built an auto-remediation system into the daily cron. When a scraper returns zero jobs for a non-custom company, the system automatically runs platform detection to check if the company switched ATS providers. If it finds a new platform, it updates the database, re-scrapes with the correct scraper, and tracks the fix. The daily admin email now has two sections: a green "auto-fixed" section showing what the system repaired on its own (e.g., "Anthropic: ashby to greenhouse") and a red "still needs attention" section for failures that require manual investigation.

I also fixed a subtle false-alarm problem. Most scrapers pre-filter jobs by PM keywords internally, which means zero results could mean "no PM roles at this company right now" or "the scraper is completely broken." The system was treating both the same way. Now, actual scraper failures throw exceptions (caught by error handling), while zero PM results are treated as valid outcomes. This eliminated phantom alerts for companies like Bitkraft and Slack that simply had no PM openings.

### Key Decisions

**Auto-remediate only for known ATS platforms, not custom scrapers.** Companies like Stripe, Google, and Netflix have bespoke scraping logic that can't be auto-detected. If Stripe changes their careers page, a human needs to look at it. But for the 35+ companies on standard ATS platforms (Greenhouse, Lever, Ashby, Workday), platform switches are detectable and fixable automatically. The tradeoff is that custom scraper companies still require manual intervention, but they're a small minority (6 out of 45+).

**Two-tier email instead of just a failure dump.** The old admin email was a wall of red: "these companies failed." The new one separates auto-fixes (green, informational) from real problems (red, actionable). This means the admin can glance at the email and immediately know: do I need to do anything today, or did the system handle it? The tradeoff is slightly more complex email templating, but the operational benefit is significant.

**Removed the zero-results alert entirely.** My first instinct was to alert on zero PM jobs. But after investigating four "failures," two of them (Bitkraft, Slack) were actually correct: those companies just weren't hiring PMs. Alerting on ambiguous signals creates noise that trains the operator to ignore alerts. Better to only alert on unambiguous failures (exceptions) and let the auto-remediation handle the rest.

### What I Learned

**The hardest bugs look like correct behavior.** Anthropic's scraper was returning zero jobs, which looked exactly like "Anthropic isn't hiring PMs." The actual problem was that they changed platforms entirely. The only way to distinguish "zero results because no PM roles" from "zero results because the scraper is pointed at the wrong platform" is to re-run platform detection. This is why the auto-remediation step exists.

**Pre-filtering creates ambiguity that post-filtering doesn't.** If every scraper returned ALL jobs and filtering happened afterward, I could easily distinguish "company has 200 jobs but none are PM" from "scraper returned nothing." But pre-filtering (which is faster and uses less memory) makes the output ambiguous. I kept pre-filtering for performance but added the auto-remediation layer to handle the ambiguity it creates.

**Alert fatigue is worse than missing alerts.** Four alerts per day for non-issues would train me to stop reading the admin email within a week. Reducing alerts to only genuine, actionable failures keeps the signal-to-noise ratio high. The auto-remediation section in the email gives confidence that the system is working without requiring action.

---

## Phase 16: Data Quality Pipeline

**Goal:** Stop bad data from reaching users, and give me a daily health report so I catch issues before anyone else does.

### What I Built

Microsoft was showing 157 PM jobs in the daily email. When I looked closer, dozens were from India, the UK, and other countries. The root cause was embarrassing in hindsight: location filtering only existed as a frontend toggle. The backend was storing every global PM job in the database and including all of them in email alerts. The "US Only" button on the dashboard was hiding the problem from the UI, but the email had no such filter.

I ported the location detection to the backend and added a second filter pass in the validation pipeline. Every scraped job now goes through two gates: first, does the title match PM keywords? Second, is the location in the US? Non-US jobs get filtered before they ever touch the database. I also added explicit non-US patterns (60+ covering India, UK, Germany, Canada, Singapore, Japan, and many more) instead of just checking for US matches. If a location doesn't match anything either way, it gets excluded by default. Safer to miss an unusual US location string than to email someone jobs from Bangalore.

The second part was the daily quality evaluation. After every cron scrape, the system now runs a quality check across every company and sends me a scorecard email. Each company gets a row showing: how many US jobs it has, how many non-US jobs were filtered out, how the count changed from yesterday, its quality score, and whether any checks flagged issues. Companies with problems sort to the top of the table (critical first, then warnings), so I can glance at the email and immediately see if anything needs attention. The checks cover absurd job counts (more than 100 PM jobs for one company is suspicious), sudden spikes or drops, zero jobs for companies that have subscribers, and low quality scores.

### Key Decisions

**Filter at the validation layer, not in each scraper.** Every scraper (Greenhouse, Lever, Ashby, Workday, Eightfold, and all the rest) flows through `validateScrapeResults()` before anything gets saved. Adding the location filter there means it applies universally with zero changes to individual scrapers. The alternative was adding location filtering to each of the 8+ scrapers, which would have been fragile and easy to forget when adding new ones.

**Default unknown locations to excluded.** The frontend version of `isUSLocation()` treated unknown locations as US (show them by default). The backend version does the opposite: if a location string doesn't match any US or non-US pattern, exclude it. The tradeoff is that a small number of US jobs with unusual location formatting might get filtered out, but the alternative (including unknown international locations) is worse because it's the exact problem that caused the Microsoft incident.

**Always-send eval email.** The quality report sends even when everything is fine. This seems wasteful, but it solves an important problem: if the email stops arriving, I know the cron itself is broken. A report that only sends on failure gives no signal when the monitoring system fails silently.

### What I Learned

**UI filtering is not data filtering.** I had `isUSLocation()` on the frontend and assumed the location problem was handled. But the daily email doesn't go through the frontend. The database counts don't go through the frontend. The admin dashboard doesn't go through the frontend. A filter that only exists in the presentation layer is protecting one view while leaving every other channel exposed. Data quality rules belong at the source, before storage.

**Negative patterns are as important as positive ones.** My first version only checked for US patterns (state names, city names, "Remote"). It would have missed a location like "Hyderabad, Telangana" that doesn't contain any US keywords but also isn't in any US pattern list. Adding explicit non-US patterns (NON_US_PATTERNS) catches these definitively. The two lists work together: non-US check first (reject), then US check (accept), then default (reject).

**A daily health report changes how you operate.** Before this, I found out about data quality issues when I happened to notice something wrong in an email or a user complained. Now I have a structured report that runs every morning, showing me every company's status at a glance. The difference is between reactive firefighting and proactive quality management. Even if nothing is wrong, seeing "all checks passed" across 45 companies is reassuring.

---

## Phase 17: Puppeteer Elimination and Catalog Expansion

**Goal:** Recover 10 broken companies, eliminate Puppeteer dependency wherever possible, and expand the catalog from 55 to 126 companies.

### What I Built

I woke up to an admin email showing 10 companies failing with identical Chrome crash errors. All of them used Puppeteer, the headless browser that loads career pages and extracts job listings from the rendered HTML. The root cause was that the Docker base image (which bundles Chrome) had silently updated to a broken version. Every company that depended on browser-based scraping broke at once.

Instead of just pinning the Docker image and moving on, I treated this as an opportunity to eliminate the Puppeteer dependency wherever possible. For each of the 10 companies, I researched what ATS (applicant tracking system) platform they actually used by probing known API endpoints. Datadog and LinkedIn turned out to be on Greenhouse, which I already had an API scraper for. Amazon has its own public search API at `amazon.jobs`. Rivian and Costco both run on iCIMS, which exposes a REST API I hadn't known about. Intuit uses a platform called TalentBrew that returns HTML fragments inside a JSON wrapper, which I could parse without a browser. Zerodha has a simple REST API for their career listings.

I built four new scraper types: an iCIMS REST API scraper (used by Rivian and Costco), a TalentBrew HTML parser (for Intuit), an Amazon Jobs API scraper, and an Oracle HCM Cloud scraper (for JPMorgan Chase and Oracle). Seven of the original ten companies now use API-based scraping. For the remaining three (Google, eBay, and Ametek), their platforms genuinely require a browser. I pinned the Docker image to a known working version for those.

With the scraper infrastructure proven out, I expanded the catalog from 55 to 126 companies. For every new company, I researched its ATS platform by probing API endpoints before adding it. 118 of 126 companies use pure API scrapers. Only 8 need Puppeteer (Google, eBay, Ametek, Apple, Meta, Wayfair, Tesla, TikTok). I also removed two India-focused companies (Zerodha, Razorpay) that had no US PM presence, ran the long-deferred Phase 6 database migration to drop legacy columns, and completed a full security and correctness audit that caught 16 issues including a critical blocklist gap that could have corrupted scraper configurations.

### Key Decisions

**Research each company's ATS instead of fixing Puppeteer.** The easy fix would have been to pin the Docker image and move on. But Puppeteer is inherently fragile: it launches a full Chrome browser in a container, uses significant memory, times out on slow pages, and breaks when the base image updates. Every company I could move to a direct API call became permanently more reliable. The tradeoff is development time (building 4 new scraper types) versus ongoing maintenance time (debugging Puppeteer failures every few weeks).

**Accept that some companies genuinely need Puppeteer.** eBay uses Phenom People, which requires authentication tokens that can only be extracted from a browser session. Google's career site is a custom SPA with no public API. Ametek uses SAP SuccessFactors. For these three, there's no clean API path, so Puppeteer remains necessary. I pinned the Docker image rather than using `:latest`, which prevents silent breakage.

**Use keyword filtering at the API level where possible.** Costco's iCIMS instance has 26,000+ job listings. Fetching all of them and filtering for PM roles would be wasteful. The iCIMS API supports a `keywords` parameter that narrows it to 9 results. But I discovered that different iCIMS instances handle query parameters differently: Rivian's `q=product+manager` parameter returns all 668 jobs unfiltered. So the scraper uses `keywords` (which works) and falls back gracefully when filtering isn't available.

### What I Learned

**The label "generic" was hiding opportunity.** Ten companies were marked as "generic" platform type in the database, meaning "we don't know what ATS they use, so use Puppeteer." When I actually investigated, seven of them had perfectly usable APIs. The "generic" label wasn't a platform assessment, it was a lack of investigation. I should have probed these earlier instead of accepting Puppeteer as the default.

**Docker `:latest` is a landmine.** The Puppeteer Docker image updated silently, and because I was pulling `:latest`, every deploy got the broken version. This is a well-known anti-pattern but easy to overlook when things have been working. Pinning to a specific version tag means updates are intentional, not accidental. This applies to any Docker base image, not just Puppeteer.

**iCIMS has a hidden REST API.** iCIMS is one of the biggest ATS platforms, but its documentation is aimed at enterprise customers, not scraper developers. The `/api/jobs` endpoint that Rivian and Costco expose isn't widely documented, but it returns clean JSON with job titles, locations, and slugs. Finding it required inspecting network traffic on the career page. This pattern likely works for many other iCIMS-powered career sites.

---

## Phase 18: Self-Healing Scraper Layer

**Goal:** Stop manually investigating every time a company silently breaks their scraper. Build a recovery system that handles platform migrations, dead APIs, and bot blocks automatically.

### What I Built

The session opened with Coinbase failing. Their public Greenhouse board, which my scraper had been hitting for months, was returning 404 on every endpoint. The board had been deleted, not renamed. I traced what happened: Coinbase rebuilt their careers experience as a custom single-page app at coinbase.com/careers/positions, backed by an internal API that requires authenticated requests. From inside a stealth-rendered Puppeteer browser with all the right headers, the API still returned a 400 error. They had effectively closed off public scraping. Coinbase had also recently announced layoffs, so this could have been a hiring freeze plus a protective lockdown rather than purely anti-scrape sentiment. Either way, no clean fix.

Instead of fighting Coinbase specifically, I built a generalized recovery system so the next company that breaks the same way won't need a manual session. The cron loop now has three tiers when a company returns zero jobs. Tier one is the configured scraper, which uses whatever ATS platform was last detected. Tier two is the existing platform auto-detection that probes known ATS endpoints to see if the company switched providers. Tier three is new: a generic stealth browser scraper that loads the careers page, watches every JSON response on the page, and tries to extract job listings from any response that looks like a list of job objects. If the JSON sniff fails, it falls back to scraping job links from the rendered DOM. This catches companies that move to custom APIs the system has never seen before.

If all three tiers fail for the same company seven days in a row, the system marks the company as auto-disabled and stops trying. This prevents permanently broken scrapers from polluting the daily admin email and wasting cron time. To handle the case where a company comes back online (Coinbase reopens their API, or a temporarily broken site recovers), every Monday the cron retries each auto-disabled company once. A successful Monday probe automatically re-enables the company. The admin email gets new sections for "watch-list re-enabled," "stealth fallback recovered," and "auto-disabled," so I can see at a glance what the system handled itself and what's truly stuck.

### Key Decisions

**Build the recovery system, not the Coinbase fix.** The instinct was to keep digging at Coinbase: maybe a different stealth library, maybe LinkedIn as a backup data source, maybe a paid scraping service. I caught myself an hour in and reframed: if I'm fighting one company this hard, the next ten will eat the rest of my month. The right scope was a system that turns "manual investigation every two weeks" into "system handles it, emails me only when it can't." Coinbase specifically may not be saveable without their cooperation. The architecture is.

**Auto-disable threshold of seven days, not three.** Some companies legitimately have zero PM roles for a week — small companies, hiring pauses, end-of-quarter freezes. Three days would auto-disable real companies that just aren't hiring at the moment. Seven days is conservative enough that real "no roles" states recover before the system gives up, but short enough that genuinely broken scrapers don't pollute reports for weeks. The Monday probe means even a fully disabled company gets one retry per week, so the cost of being too conservative is low.

**Return empty arrays instead of throwing exceptions.** Tier-1 scrapers that throw exceptions bypass tiers two and three because the catch block fires immediately. To let auto-healing run, custom scrapers now return an empty array for known failure cases (like "API returned 400") and reserve exceptions for genuinely unexpected errors. This was a subtle architectural shift: the contract for "I tried and got nothing" has to be different from "something is so broken I can't continue."

### What I Learned

**Stealth browsers dodge fingerprinting, not server-side rejection.** I added the puppeteer-extra-stealth plugin assuming it would unlock Coinbase. It didn't. The plugin defeats Cloudflare's challenge page (which detects headless Chrome by fingerprinting), but it can't help when the origin server itself returns a 400 error to the request. Application-level rejection is a different problem from bot detection. Useful tool, but not magic.

**The "this one company" trap.** Every time a company breaks, there's a temptation to write a one-off fix for that company and move on. After about the third one, you have a graveyard of bespoke scrapers and you still get woken up every other week. The right move is usually to recognize the pattern early and build the recovery system instead. I did this for Phase 17 (eliminating Puppeteer dependency); I should have done it earlier than Phase 18 (auto-recovery), because the pattern was visible by Phase 15 already.

**Tiered recovery is fundamentally about graceful degradation.** Each tier knows less about the specific company than the one before it, but works for more companies. Tier 1 is precise but breaks when the platform changes. Tier 2 is general but only handles known ATS patterns. Tier 3 is fully generic but slower and less accurate. Failing forward through the tiers means the system can usually find at least some answer, even when it doesn't know what the company has done. Good engineering rarely produces one perfect answer; it produces a chain of progressively-less-confident answers and trusts the most confident one that succeeds.

---

## Phase 19: Less Noise, Tighter Security

**Goal:** Trust the self-healing system to run quietly. Verify the security claims in our docs match what the code actually does. Surface new vulnerabilities every week instead of hoping someone remembers to audit.

### What I Built

The Phase 18 self-healing layer was working but I was getting three admin emails per day. A scrape report. A daily quality evaluation. A separate alert when the email batch failed. Most of the content was the system telling me about successes I did not need to know about. I asked the simple version of the question: what do I actually need to act on, and what is just informational? The answer was that very little of it was actionable. I consolidated the three emails into one digest that fires only when something needs my attention. A scrape that failed today. A company trending toward auto-disable. A subscribed company that suddenly dropped to zero jobs. A delivery batch failure. On Mondays, the same email picks up a weekly digest section showing system health and the past seven days of self-healing activity, logged to a new audit table. Most days now result in zero admin emails.

While simplifying the emails I noticed something else. The "stealth fallback recovered jobs" line was firing for thirteen companies every day. I assumed those were companies whose primary scraper was broken. Investigation showed that was wrong. Most of them, like Block and Wiz, had perfectly functional Greenhouse boards with fifty or two hundred jobs. None of those jobs happened to be Product Managers. The primary scraper correctly returned zero, the system fell through to stealth fallback, stealth returned the same jobs from a different URL, and the PM filter eliminated everything again. The stealth fallback was doing wasteful duplicate work, not actual recovery. I added an out-parameter so the primary scraper now reports its pre-filter job count. The cron only triggers stealth fallback when both the post-filter count and the pre-filter count are zero, meaning the source actually returned nothing. Daily stealth runs dropped from thirteen to three.

The next step was making stealth fallback actually useful when it does run. Previously, when it sniffed a JSON response that contained jobs, it returned the jobs but threw away the URL. I changed it to return the URL too, and added a function that maps known URL patterns (Greenhouse, Lever, Ashby, SmartRecruiters APIs) back to a platform configuration. When the URL is recognized and differs from what is in the database, the system auto-updates the company's platform config so the next run goes through the API directly and skips Puppeteer entirely. When the URL is unrecognized (like LinkedIn's in-house career API), it gets logged for the Monday digest so I can decide whether to build a custom scraper for it.

Then I ran a full security audit. Three parallel review agents focused on three separate surfaces: the authentication flow, data isolation between users, and infrastructure plus monetization readiness for the upcoming Stripe phase. They surfaced eleven distinct issues. Some were exploitable today, some were defense-in-depth. The most embarrassing finding was that our cookies were not HttpOnly. The documentation said HttpOnly cookies. The auth design assumed HttpOnly cookies. There is a whole server-side bridge route called /api/auth/token that exists specifically because HttpOnly cookies cannot be read by browser JavaScript. But three places in the code explicitly set httpOnly to false when writing cookies, defeating the design. Someone added that override during a refactor and never removed it. The audit also found that one read endpoint returned company job data to non-subscribers, the cron secret comparison was vulnerable to timing attacks, and our rate limiter had a published CVE that let attackers bypass per-IP limits using IPv4-mapped IPv6 addresses. I shipped fixes for all eleven in one commit.

To prevent future drift, the Monday admin email now also runs npm audit on the backend production dependencies, stores a snapshot in a new security_snapshots table, and shows new and resolved vulnerabilities week over week. New CVEs published into our dependency tree surface in the next Monday's email, instead of waiting for the next manual audit.

### Key Decisions

**One email channel, not three.** The instinct when you have multiple types of operational alerts is to split them by category. Failures get one email, quality issues get another, batch problems a third. It feels organized. In practice it makes the reader triage which email is worth opening first, and each one needs its own subject line and template. Folding everything into one daily channel that fires only when something needs attention is harder to ignore because you know it always means something. The Monday weekly digest is the same channel with an extra section, not a separate email.

**Three specialized review agents instead of one general pass.** I considered running one comprehensive audit. Each parallel agent was scoped to a single surface and read its target files line by line. A generalist pass usually covers more ground at less depth per surface and would have missed the kind of subtle issue where one read endpoint forgot a subscription check while every other route had one. Splitting the audit also let me run three reviews in the time of one. The HttpOnly cookie bug specifically was caught because the auth-focused agent compared the cookie setter code against the documented design, not just against best practices.

**Ship the runtime-safe fixes in one commit, defer the runtime-risky ones.** Out of eleven findings, ten were code-only changes I could typecheck and build-verify locally. One was removing the unsafe-inline directive from the Content Security Policy, which would require runtime testing in a Vercel preview because Sentry and PostHog use inline scripts. Bundling a CSP change with a security commit makes rollback messier if something breaks. I shipped the typechecked fixes and added the deferred items to a security log file so they would not be forgotten.

**Audit log as defense against documentation drift.** I created a local-only security log file that records what each audit found, what got shipped, what got deferred and why, plus the conclusion that documentation lies eventually even when nobody is lying on purpose. Every future audit appends to it. This solves the question I kept asking myself: why didn't the last audit catch this? The answer turned out to be partly that the previous audit was a snapshot in time and partly that the previous audit was less specialized. Writing those reasons down makes the next audit better.

### What I Learned

**A self-healing system that emails you about every success trains you to ignore the channel.** By the time something actually needs my attention, I have been habituated to skip the inbox notification. The fix is not a better email template, it is not emailing me when nothing needs to change. Successful auto-recoveries should be logged to a database and surfaced in a weekly review, not push notifications. This applies far beyond scrapers. Any monitoring that alerts on known-good states eventually loses signal.

**Documentation drifts from code during refactors, and audits exist because of that.** The cookie HttpOnly story is the cleanest illustration. Someone added a one-line override during a refactor. The override was probably correct at that moment for some local reason. It was never reverted. The documentation kept claiming HttpOnly was on. The /api/auth/token bridge route, which was built specifically because HttpOnly was on, kept working because the override happened to not break it. From the outside everything looked right. Periodic audits exist to compare what you think is happening against what is actually happening, because no individual change ever sets out to lie.

**Specialized matters more than thorough.** Three reviews each focused on one surface found things a single general review would have missed. Where you choose to look is more valuable than how widely you look. Twenty surface-level checks against a codebase miss what one deep check uncovers. This is the same lesson as the dependency-elimination work in Phase 17. The right scope for a tool is narrow enough to be deep.

**Build the monitoring before you need it.** The weekly npm-audit check is the cheapest possible monitoring I could have built. It runs in the same cron, costs nothing, takes thirty seconds. It catches the next "we have a CVE we do not know about" months earlier than the next manual audit. The cost of building it was small. The cost of not building it could have been a Stripe-billing-era CVE shipped to production. The pattern is: every time you do a manual investigation, ask whether the same work could happen automatically every week.

---

## Phase 20: Specialized AI Agents and PR-Gated Deploys

**Goal:** Move from "ask Claude to do everything" to a roster of specialized agents that handle specific recurring tasks, and put a deploy gate in place so a bad change cannot land on users without me seeing a preview first.

### What I Built

For about a year, the way I built this product was simple. I opened a chat with Claude Code, described what I wanted, watched it work, then pushed to main and let production update itself. That worked, but it had two problems. First, every task started from zero context. Whether the work was reviewing my code before a push, auditing the auth flow, fixing a broken scraper, or writing a feature spec, Claude had to re-derive the project rules every time. Second, the same autonomy that made me fast also made me nervous. A single bad change going straight to production was one careless decision away.

I spent a session restructuring both of those. The first half was building a portfolio of thirteen specialized subagents that live in the repo. Each one is a markdown file with focused instructions for a specific recurring job. Diagnose a broken scraper. Audit cross-user data leaks. Write a backlog spec. Run a threat model on a new feature. Review pending code before push. Five of the thirteen are custom and encode project-specific knowledge that no public agent could know. The other eight were forked from public collections after evaluating around seven hundred publicly available agents across four open-source repos. Public agents are mostly written for enterprise teams and reference tools I do not use, so the eight I borrowed got rewritten from scratch to keep only the load-bearing patterns and remove vendor name-drops, marketing taglines, and roleplay headers.

The second half was the deploy gate. I turned on GitHub branch protection so the main branch only receives code through a pull request, and turned on Railway plus Vercel preview environments so every PR gets its own working sandbox URL before it can be merged. The workflow now is that I describe a task, Claude routes it to the right specialist agent, the agent proposes a patch, I review the patch, Claude opens a pull request on a feature branch, preview deploys spin up automatically, I click around the preview, and only then do I click merge. The merge button is the only step I cannot delegate. Everything else happens hands-free.

### Key Decisions

**Build custom for project knowledge, borrow for generic roles.** I evaluated four major public subagent collections totaling around seven hundred agents. The reusable ones were generic roles like code reviewer or database optimizer that any web app needs. The ones I needed to build from scratch encoded knowledge no public agent could have. The custom-scraper-hosts blocklist. The three-tier recovery model. The existing index list. The proven security audit pattern that caught eleven issues a single-pass review missed. I split the portfolio sixty/forty, eight borrowed and five custom. The tradeoff is that the eight borrowed agents needed rewriting to remove enterprise bloat, but starting from a battle-tested skeleton is faster than starting from a blank file.

**PR-gated deploys instead of direct push to main.** Before this session, I pushed directly to main and watched production update sixty seconds later. After this session, every change goes through a pull request with a preview deploy attached. The tradeoff is that I now click merge once per change, which adds friction for small fixes. The benefit is that no change reaches users without me seeing a working preview first, and a bad change closes with one click instead of needing a revert. For a solo founder pre-monetization, the safety net is worth the click.

**Agents propose, the main thread disposes.** Every specialist agent is restricted from running git commands. They return diagnoses, patches, and findings as markdown blocks in their response, but they never commit, push, or open pull requests themselves. The main thread, where I am talking to Claude, handles all git operations after I approve the proposal. The tradeoff is one extra review step per agent invocation, but it keeps risky autonomy on the main thread where I have visibility, instead of buried inside a subagent's tool calls.

### What I Learned

**Generic public agents are surprisingly bloated.** I expected to install plug-and-play agents from open-source collections and move on. The reality was that even the highest-quality public agents averaged around fifty to seventy percent bloat for my use case. Vendor name-drops for tools I do not use. Aspirational checklists like "achieve eighty percent code coverage" that do not apply to a solo project. And "you are Alex, a ten-year veteran" roleplay headers that waste the agent's instruction budget. The trimming work was real, but the structural patterns underneath were genuinely useful. Borrow the bones, throw out the marketing.

**Predictable output contracts matter more than the underlying model.** Every agent in the portfolio declares the exact markdown structure it returns. The change reviewer uses a blocker, suggestion, and nit format. The threat modeler returns a STRIDE matrix and a data flow diagram. The spec writer outputs the same numbered table format the existing backlog uses. Once each agent has a predictable shape, reviewing their output is a thirty-second scan instead of reading prose. The model under the hood matters less than the contract on the way out.

**The framework is only as good as the trigger.** Owning thirteen specialized agents is useless if I keep doing every task in the main thread out of habit. The win comes from internalizing the routing. When a company breaks, that is scraper doctor's job, not a free-form conversation. When something breaks in production, that is incident triage. When I want to add a feature, that is spec writer first, then code. The portfolio is built. Using it is the next discipline.

---

## Phase 21: Silent Zero Failures and Three New ATS Platforms in One Night

**Goal:** Close the silent-zero failure class and recover the catalog companies that had been quietly returning nothing.

A look at the catalog showed that about ninety of two hundred and twenty companies were sitting at zero PM jobs. Some were genuinely not hiring product managers. Some had been hiring, but our scraper had been silently failing. The structural problem was that a scrape that returned zero looked identical in our logs to a scrape that returned correct data for a company with no open roles. Both showed status success. Both produced quality scores. Neither sent an admin alert. We had built a system that confidently reported nothing while losing real listings, and we had no way to distinguish the two cases without spot-checking every company by hand.

### What I Built

I tackled this in four phased pull requests in one evening, each independently reviewable.

The first pull request added the safety net. Two new columns on the companies table, `is_verified` and `is_verified_zero`. The first flips to true automatically the moment a scraper returns more than zero PM jobs, which is the system's way of saying I have proof of life from this source. The second flips to true only when I manually confirm a zero is legitimate. The daily admin email got a new section listing every company currently at zero PM jobs without admin sign-off, sorted by subscriber count, capped at the top twenty-five with an overflow footer. The same pull request also fixed a long-running bug in the Ashby scraper where it had been filtering jobs by team name. Modern companies put their product managers inside teams named after products, not teams named "Product Management," so the filter was silently dropping real PM roles at about seventeen companies. Switched to title-keyword filtering, mirroring the pattern we already used for Greenhouse.

The second pull request built a real scraper for Apple. Apple's careers site is a React SPA with no useful HTML; the scraper had been falling through to Puppeteer and getting nothing. The fix was to use Apple's own internal REST API: a CSRF endpoint that returns a token and a session cookie, then a search endpoint that paginates results. The payload required a specific `format` field that, if missing, made the API silently return zero records — which is exactly the kind of failure mode my old monitoring would have missed. Same pull request also fixed an EA scraper bug that had been dropping about ten jobs per page because a single CSS selector matched the wrong element. And added hostname guards for Meta and TikTok, which actively block server-side requests at the edge, so we yield those companies to the stealth tier instead of burning a Puppeteer launch on a known-impossible scrape.

The third pull request expanded `PM_KEYWORDS` to match the function name "product management" in addition to the role name "product manager." This sounds small but recovered American Express from one job to dozens. The Oracle HCM tenants (American Express, JPMorgan, Oracle itself) put the function name in their job titles, like "Senior Manager - Product Management," not the role name. The old keyword list missed every one of them.

The fourth pull request built scrapers for the two companies I had been deferring: Shopify and eBay. Shopify uses Ashby in embedded mode, where the hosted Ashby API returns null but the careers page server-renders eighty-four jobs into a React Router streaming payload. The payload is a deduplicated JSON array where field names appear once and job objects reference them by index. Wrote a parser that resolves the indices dynamically so future deploys don't break it. eBay uses Phenom People, an ATS we hadn't supported before. Built a generic Phenom scraper that parses the inline data object Phenom embeds in every careers page. Acknowledged limitation: Phenom only server-renders ten jobs per page, with all further pagination handled by client-side JavaScript, so we capture a first-page sample. Documented this honestly in code and set the scanned-count out-param to the total reported by the API so the self-healing tier knows the source is live.

Between the four pull requests, I deleted four companies from the catalog: Color Health (uses an ATS we don't support and has no PMs visible), Allbirds (in hiring contraction with three company-wide openings), Solana Labs (uses an ATS we don't support), and Splunk (now a Cisco subsidiary on Phenom, with zero subscribers to justify the effort). Each had zero subscribers, so hard-delete was safe and cleaner than indefinite suppression.

### Key Decisions

**Phase the work into four pull requests, not one.** Each phase had an independent verification path — different APIs to curl-test, different DB swaps to apply, different risk profile. Smaller pull requests let the change reviewer agent give focused feedback per scope. And one revert button per phase is safer than one mega-revert. The cost was four merge cycles instead of one; the benefit was lower blast radius if any phase had a problem.

**Use parallel specialized agents for research, integrate myself, and run the change reviewer before every merge.** Each scraper got its own scraper-doctor agent in parallel. Each PR got the change-reviewer agent before push. The pattern is "agents propose, main thread disposes." Agents never commit, push, or open pull requests; they return diagnoses and patches as code blocks in their response. I integrate, verify with live curl tests, and the change-reviewer audits the integrated diff before merge. This caught six real ship blockers tonight that I would have missed without that final review pass.

**Trust live curl tests over cited prior art when they conflict.** Earlier in the session, prior-art research from a parallel session pointed at a published Apple scraper using specific endpoints. The scraper-doctor agent had already reverse-engineered different endpoints. I tested both with curl. The prior-art endpoints returned 404 and redirects; the agent's endpoints returned valid JSON with real results once I added a mandatory field the prior art had omitted. The prior art was stale. The right discipline: cite prior art as a starting hypothesis, always verify with live curl before committing.

**Hard-delete the unrecoverables instead of suppressing them forever.** Color Health, Allbirds, Solana Labs, Splunk — none were salvageable tonight, none had subscribers, none had a clear path back. Marking them as legit-zero forever would let them sit invisibly in the catalog as a slow-growing pile of "things we gave up on." Deleting them keeps the catalog honest and the re-add path is straightforward if circumstances change.

### What I Learned

**The fix for a silent-failure class isn't a smarter scraper, it's a different definition of success.** Before tonight, our monitoring defined success as "the scraper returned without throwing." That's structurally incapable of catching a scraper that returns the wrong answer cleanly. The fix was to add the verification columns and force every zero-PM company through a human decision. The daily email noise during the backlog triage is the intended UX, not a bug. Silence is what got us into this mess. The general pattern: anywhere absence-of-bad-signal masquerades as good-signal, force the decision into the loop explicitly.

**One pre-filter step in a scraper can be more wrong than the rest of the code combined.** The Ashby team-name filter wasn't a typo or an oversight. It was a perfectly reasonable design that happened to encode an assumption about how companies structure their teams. That assumption stopped being true a few years ago when companies started embedding product managers into product-area teams. We had been silently dropping listings from about seventeen Ashby companies for months. The fix was one selector swap from team-name to title-keyword. Look hard at the assumptions baked into your filter logic — those are where the silent bugs live.

**Prior art saves real time when you verify it, and costs more time than starting from scratch when you don't.** The eBay scraper came together fast because I could port a Python Phenom parser from a public library. The Apple scraper would have been faster if I had trusted the published reference, but live curl proved the reference was stale; the agent's reverse engineering caught the current API state. Same workflow either way: cite the reference, run a five-minute live test, commit to the path that actually works.

**The catalog hygiene step is part of the recovery work, not a separate cleanup.** I deleted four companies tonight not because I planned a cleanup pass but because the audit forced a per-company decision. A company sitting at zero PMs for months with zero subscribers had been invisible in the old admin email. The unverified-zeros section makes that decision unavoidable, which is the point. Expect the catalog to oscillate as scrapers break, companies get re-evaluated, and the email forces "fix or remove" calls.

---

## Summary of Concepts Learned

| # | Concept | Where I Learned It |
|---|---------|-------------------|
| 1 | API-first scraping vs. HTML parsing | Building the multi-platform scraper (Phase 3) |
| 2 | Platform auto-detection engineering | Adding 15+ ATS integrations (Phase 3) |
| 3 | Multi-user data architecture (shared catalog + subscriptions) | Converting from single-user to multi-user (Phase 4) |
| 4 | Passwordless authentication (magic links, PKCE vs. token-hash) | Building and debugging auth (Phase 4) |
| 5 | HttpOnly cookies and server-side token extraction | Connecting frontend to backend auth (Phase 4) |
| 6 | Row Level Security and service keys | Debugging empty query results (Phase 4) |
| 7 | Preview-before-commit UX patterns | Check-then-add flow (Phase 5) |
| 8 | Multi-tier caching (memory, DB, live fetch) | levels.fyi integration (Phase 6) |
| 9 | Code-splitting and lazy loading for performance | Landing page optimization (Phase 8) |
| 10 | Content Security Policy and security headers | Pre-launch audit (Phase 9) |
| 11 | SSRF prevention and input validation | Security hardening (Phase 9) |
| 12 | Batch email sending and rate limit management | Email reliability (Phase 10) |
| 13 | Privacy-preserving analytics (PII hashing) | PostHog integration (Phase 11) |
| 14 | Error monitoring across frontend and backend | Sentry integration (Phase 11) |
| 15 | Auto-sleep infrastructure and cron reliability | Railway cron debugging (Phase 12) |
| 16 | Database indexing based on query patterns | Performance optimization (Phase 13) |
| 17 | Local JWT verification for latency elimination | Auth fast path (Phase 13) |
| 18 | N+1 query detection and parallel execution | Multi-user query refactoring (Phase 13) |
| 19 | AI context management (CLAUDE.md pattern) | Building the entire project with AI tools (Phase 14) |
| 20 | DNS security (DMARC, DKIM, SPF) | Email deliverability (Phase 9) |
| 21 | Auto-remediation for platform migrations | Self-healing scrapers (Phase 15) |
| 22 | Distinguishing ambiguous zero results from real failures | False alert elimination (Phase 15) |
| 23 | Two-tier operational alerting (auto-fixed vs needs attention) | Admin email upgrade (Phase 15) |
| 24 | Backend vs frontend data filtering (filter at the source) | Microsoft location bug (Phase 16) |
| 25 | Daily quality evaluation with per-company scorecards | Data quality pipeline (Phase 16) |
| 26 | Negative pattern matching (NON_US_PATTERNS) | Location filtering design (Phase 16) |
| 27 | Docker image pinning (never use :latest in production) | Puppeteer crash recovery (Phase 17) |
| 28 | Hidden REST APIs behind enterprise ATS platforms (iCIMS, TalentBrew) | ATS research and migration (Phase 17) |
| 29 | Dependency elimination over dependency repair | Puppeteer mass migration (Phase 17) |
| 30 | Tiered recovery and graceful degradation in scraper architecture | Self-healing layer (Phase 18) |
| 31 | Auto-disable thresholds and watch-list probing for ongoing reliability | Self-healing layer (Phase 18) |
| 32 | Stealth browser fingerprint evasion vs server-side rejection (different problems) | Coinbase investigation (Phase 18) |
| 33 | Return-empty vs throw contracts for tier handoff | Self-healing layer (Phase 18) |
| 34 | Action-only operational alerting (silent-by-default email channels with weekly digest for audit trail) | Email consolidation (Phase 19) |
| 35 | Pre-filter vs post-filter counts to distinguish "source empty" from "source had no matches" in tiered recovery | Layer 2 stealth fix (Phase 19) |
| 36 | Stealth-discovered URL inference for auto-configuring scrapers from their actual data sources | Layer 1 stealth auto-fix (Phase 19) |
| 37 | Parallel specialized review agents over single-pass audits | Security audit (Phase 19) |
| 38 | Documentation-vs-code drift as the real reason audits exist | HttpOnly cookie bug (Phase 19) |
| 39 | Timing-safe secret comparison for shared-secret bearer tokens (cron, future Stripe webhooks) | Security hardening (Phase 19) |
| 40 | Weekly automated dependency vulnerability surfacing via diff-against-snapshot | Monday digest security check (Phase 19) |
| 41 | Specialized subagent portfolios with predictable output contracts | AI agent framework (Phase 20) |
| 42 | PR-gated deploys with branch protection plus preview environments as a safety net | Deploy workflow rework (Phase 20) |
| 43 | Public agent evaluation: borrow generic roles, build custom for project-specific knowledge | Multi-collection research (Phase 20) |
| 44 | "Agents propose, main thread disposes" pattern for isolating risky operations | Agent safety design (Phase 20) |
| 45 | Verification columns to close a silent-failure class (force every zero-result through human sign-off) | Silent-zero safety net (Phase 21) |
| 46 | One-way ratchets in scrape-status flags so admin verification work is preserved across runs | Verification columns (Phase 21) |
| 47 | Embedded ATS modes vs hosted-board APIs (Shopify embeds Ashby on their own SPA; hosted API returns null) | Shopify scraper (Phase 21) |
| 48 | Function-name vs role-name title conventions (some companies put the function in titles, not the role) | PM_KEYWORDS expansion (Phase 21) |
| 49 | Edge-blocked / auth-gated scrapers — hostname-guard yield to stealth instead of burning Puppeteer | Tesla/Wayfair/Meta/TikTok pattern (Phase 21) |
| 50 | React Flight (RSC) streaming payloads as a data source for server-rendered job lists | Shopify RSC parser (Phase 21) |
| 51 | Server-render caps as a real limitation of JS-heavy ATS (Phenom renders only 10 per page) | Phenom port (Phase 21) |
| 52 | Hard-delete vs indefinite suppression for unrecoverables (delete is reversible; suppression-forever is invisible debt) | Catalog cleanup (Phase 21) |
| 53 | Prior art is for orientation, not blind trust — always re-verify with live curl before committing | Apple endpoint divergence (Phase 21) |
