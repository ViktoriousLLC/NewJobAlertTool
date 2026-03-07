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
