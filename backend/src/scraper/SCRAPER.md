# Scraper Subsystem — READ BEFORE EDITING

This sidecar collects everything the next agent (human or AI) needs to know before touching `backend/src/scraper/` or the cron in `backend/src/jobs/dailyCheck.ts`. CLAUDE.md keeps only a one-line pointer here so the global context stays compact.

## Routing Order

(as of 2026-03-07 — hostname checks run BEFORE Puppeteer launch)

1. `platform_type` switch in DB → direct ATS scraper
2. Hostname checks for custom scrapers (EA, Atlassian, Netflix, Stripe, Uber, Google, Coinbase, Apple, Meta-yield, TikTok-yield, Tesla-yield, Wayfair-yield, Shopify, eBay, Goldman, Deel, KPMG)
3. ATS registry lookup (`atsRegistry.ts`)
4. Direct ATS URL checks (jobs.lever.co, jobs.ashbyhq.com, *.myworkdayjobs.com, eightfold.ai, jobs.smartrecruiters.com, *.icims.com)
5. **Only then**: `puppeteer.launch()` for unknown companies (~6 currently)

## Supported Platforms

| Platform | Detection | Examples |
|----------|-----------|---------|
| Greenhouse | API: `api.greenhouse.io/v1/boards/{board}/jobs` | DoorDash, Discord, Reddit, Instacart, Figma, Airbnb, a16z, Twitch, Datadog, LinkedIn, HubSpot (`hubspotjobs`), 2K Games (`2k`), Sony Interactive Entertainment (`sonyinteractiveentertainmentglobal`) |
| Lever | API: `api.lever.co/v0/postings/{handle}` | Auto-detected from jobs.lever.co |
| Ashby | GraphQL API (title-keyword filter, not team-name) | OpenAI, Anthropic, auto-detected from jobs.ashbyhq.com. Kraken uses `kraken.com` orgName (not `kraken`); Magic uses `magic.dev`. |
| Workday | JSON API | Slack, Salesforce, Zendesk (`zendesk.wd1/zendesk`), Amgen (`amgen.wd1/Careers`), BeiGene (`beigene.wd5/BeiGene`), auto-detected from *.myworkdayjobs.com |
| Eightfold | API | PayPal, Microsoft (custom domain: apply.careers.microsoft.com) |
| Custom API | Per-company | Atlassian, Uber, Netflix, Amazon |
| iCIMS REST API | JSON: `{base}/api/jobs?keywords=` | Rivian, Costco, DocuSign (`uscareers-docusign`), Pandora (`careers-siriusxmradio` — SiriusXM parent) |
| Oracle HCM | REST API: `recruitingCEJobRequisitions` | JPMorgan Chase, Oracle, American Express (`egug.fa.us2/CX_1`) |
| TalentBrew | HTML-in-JSON parser | Intuit (jobs.intuit.com) |
| **Apple** (2026-05-14) | REST API: `/api/v1/CSRFToken` → `/api/v1/search` | Apple (`jobs.apple.com`). Two-step CSRF; body requires mandatory `format` field. |
| **Shopify** (2026-05-14) | React Router v7 RSC streaming payload in HTML | Shopify (`shopify.com/careers`). Embedded Ashby; hosted Ashby API returns null. Parses `window.__reactRouterContext.streamController.enqueue(...)` with dynamic key-index resolution. |
| **Phenom** (2026-05-14) | Server-rendered DDO: `phApp.ddo["eagerLoadRefineSearch"]` | eBay (`jobs.ebayinc.com`, tenant EBAEBAUS), BCG (`careers.bcg.com`, added 2026-05-18). Generic `scrapePhenomCareers(baseDomain, label, stats)`. **10-job server-render cap** (further pagination is client-side Vue). |
| **SAP SuccessFactors** (2026-05-18) | Server-rendered HTML: `{baseUrl}/search?q=product+manager&startrow=N` (25/page) | EY (`careers.ey.com`), Ametek (`jobs.ametek.com`). Generic `scrapeSuccessFactorsCareers(baseUrl, label, stats)` parses `<tr class="data-row">` rows. |
| **Goldman Sachs "Higher"** (2026-05-18) | Unauthenticated GraphQL at `api-higher.gs.com/gateway/api/v1/graphql` | Goldman only. `GetRoles` query, 100/page, ~816 jobs (~35 US PMs). Cloudflare allows server-side POSTs through. |
| **KPMG WordPress** (2026-05-18) | Bespoke WordPress + PHP search endpoint | KPMG (`kpmguscareers.com`). Returns JSON with HTML fragments. NOT SuccessFactors despite SSO. **Verified 0 US PM yield** — `is_verified_zero=true`. |
| **Deel job-boards** (2026-05-18) | RSC: 1 header → React Server Components stream | Klarna (`jobs.deel.com/klarna`). Generic `scrapeDeelCareers(orgSlug, label, stats)`. **Klarna verified 0 US PM yield** (Stockholm-only). |
| **Revolut Next.js** (2026-05-18) | `/_next/data/{buildId}/careers.json` (Cloudflare bypass) | Revolut only. buildId rotates each deploy → on 404 returns `[]` so stealth tier rescues + `inferPlatformFromSniffedUrl` auto-updates the new buildId. |
| Stealth tier (yield to) | hostname guard returns `[]` from `scrapeCompanyCareers` | Meta, TikTok, Tesla, Wayfair — all actively block (Akamai 403, FB session-gating, Stargate gateway 2012, Workday 401/422). |
| Puppeteer | HTML scraping (120s timeout) | Google, fallback for unknown |

## Key Modules

- `scraper.ts` — all scraper logic, hostname routing
- `atsRegistry.ts` — single source of truth for hostname → ATS mapping
- `detectPlatform.ts` — auto-detection: known hostnames → ATS URLs → HTML embed → Puppeteer SPA → speculative API probes
- `detectCompanyName.ts` — 40+ known hosts + ATS slug fallback
- `validateScrape.ts` — two-pass filtering: PM_KEYWORDS (17 keywords) + US location filter from `lib/locationFilter.ts`
- `dailyEval.ts` — flags actionable issues only (sudden spikes/drops, zero for subscribed, first-scrape)

## Self-Healing Architecture

**Three-tier recovery** (added 2026-05-08, refined 2026-05-11): when any company's source returns 0 raw jobs (NOT just 0 PMs), cron runs three tiers in order:

1. **Configured platform scraper** — uses `platform_type` from DB. Filter-heavy scrapers (Greenhouse/Workday/Ashby) write their pre-PM-filter count to a `ScrapeStats` out-param so we distinguish "source returned 0" (try recovery) from "source returned 50 but 0 PMs" (no recovery needed).
2. **broadATSDiscovery** — auto-detects new ATS, updates DB. Skipped for `CUSTOM_SCRAPER_HOSTS`.
3. **`stealthFallbackScrape`** — generic last-resort using `puppeteer-extra` + `puppeteer-extra-plugin-stealth`. Sniffs JSON XHRs for job-shaped arrays, falls back to DOM extraction. Returns sniffed URL + jobs.

**Layer 1 auto-fix** (2026-05-11): `inferPlatformFromSniffedUrl()` maps stealth-sniffed URLs to known ATS patterns (Greenhouse, Lever, Ashby, SmartRecruiters, Revolut). If matched, auto-updates `platform_type` + `platform_config` so next run hits the API directly.

**Cross-domain stealth guard** (added PR #16): if the sniffed URL hostname is on a different registrable domain than the company's `careers_url` AND not a known ATS host, the bucket is rejected. Closes the Neon→Databricks attribution bug where neon.com/careers redirected to databricks.com and stealth ingested 19 Databricks PM jobs as Neon's.

**Auto-disable** (2026-05-08): companies that fail 7 consecutive days → `auto_disabled=true`, skipped from cron. Threshold = `AUTO_DISABLE_THRESHOLD` in `dailyCheck.ts`. Successful scrape resets `consecutive_failure_count=0` and `auto_disabled=false`. Manual re-enable: `UPDATE companies SET auto_disabled = false, consecutive_failure_count = 0 WHERE name = '...';`

**Monday watch-list probe** (2026-05-08): every Monday UTC (`PROBE_DAY_OF_WEEK = 1`), cron retries each auto-disabled company once. Success → auto-re-enable + green "Watch-list re-enabled" section in admin email.

**Stealth dependencies**: `puppeteer-extra@3.3.6` + `puppeteer-extra-plugin-stealth@2.11.2` (both pinned in `backend/package.json`). Stealth plugin spoofs `navigator.webdriver`, window.chrome runtime, permissions API, and other headless-Chrome tells.

## Validation Pipeline

**Post-scrape** (`validateScrape.ts`): two-pass — PM_KEYWORDS, then US location filter. Non-US jobs never enter the DB. Returns quality score + `nonUsFilteredCount`. `COMPANY_EXTRA_EXCLUSIONS` filters non-PM Program Manager variants (TPMs, business PMs) even when company-extra keywords match.

**Quality eval** (`dailyEval.ts`, simplified 2026-04-26): flags only actionable issues — sudden spikes/drops (>100%/50% change AND >10 absolute), zero for subscribed companies, first-scrape results. Critical issues also go to Sentry.

## broadATSDiscovery Guard

`CUSTOM_SCRAPER_HOSTS` blocklist in `dailyCheck.ts` prevents broadATSDiscovery from overwriting custom scraper companies. Current list (keep in sync with new custom scrapers):

```
ea.com, atlassian.com, netflix.net, netflix.com, uber.com, google.com,
amazon.jobs, intuit.com, rivian.com, costco.com, coinbase.com, apple.com,
metacareers.com, tiktok.com, tesla.com, wayfair.com, shopify.com,
ebayinc.com, higher.gs.com, gs.com, jobs.deel.com, kpmguscareers.com,
revolut.com, bcg.com, careers.ey.com, careers.lilly.com
```

## Key Rules

- After adding/fixing a scraper, **delete + re-add the company** to flush stale data
- Stripe scraper takes ~2-3 min (Puppeteer pagination + detail pages)
- To fix broken scraper: identify platform → add handler in `scrapeCompanyCareers()` → push → delete + re-add company
- **Never let broadATSDiscovery run on custom scraper companies** — can overwrite platform_type with false ATS match
- **`SCRAPER_UA` constant** (top of `scraper.ts`) for Windows Chrome/120 fetches. Goldman/Revolut (Chrome/124) and Apple (Mac UA) keep local strings — intentional fingerprint divergences.

## Gotchas (Historical Fixes — Most-Recent First)

### 2026-05-18
- **Revolut buildId auto-refresh pattern**: Cloudflare blocks raw HTML but `/_next/data/{buildId}/careers.json` bypasses CF cleanly. buildId rotates per deploy. `scrapeRevolutCareers` returns `[]` on 404 → stealth tier intercepts → `inferPlatformFromSniffedUrl` matches Revolut pattern → DB auto-updates `platform_config.buildId`. **Note**: required adding `"text"` to `extractJobsFromUnknownJson` titleKey list (Revolut positions use `{id, text, locations[]}`); gated on `hasJobHint()` to avoid cross-company false positives (added PR #16).
- **iCIMS template variation**: Rivian + Costco return JSON at `/api/jobs`. DocuSign + Joby Aviation return HTML SPA at `/api/jobs` (different iCIMS template). Puppeteer-based `scrapeICIMSCareers` handles HTML variant; REST one handles JSON. If a new iCIMS company returns HTML from `/api/jobs`, it's the SPA variant.
- **Consulting industry verdict**: All MBB + Big-4 *except* BCG use Avature (login-gated SPA, robots.txt disallows). McKinsey/Bain/Deloitte = permanently unscrapeable. BCG escaped via Phenom. EY uses SuccessFactors. KPMG uses bespoke WordPress (but 0 US PM yield). PwC + Accenture use Workday.
- **Honest scraper verification before catalog-add**: when a new scraper ships, spawn `catalog-scout` agent to simulate against live data with our actual PM_KEYWORDS + HARD_EXCLUSIONS + US filter, report real-after-filter yield. Tonight: KPMG (0 yield, all consulting), Klarna (0 yield, all Stockholm). Both marked `is_verified_zero=true` despite scrapers working. Lesson: "endpoint returns 200" ≠ "delivers user value."

### 2026-05-17
- **Common Crawl harvest pipeline exists but deprioritized**: `backend/src/scripts/common-crawl-harvest.js` queries CC's CDX for known ATS hostnames, validates each candidate, outputs JSONL → `harvest-to-sql.js`. Tested with 1352 validated candidates. PMs job-hunt for recognizable brands in target verticals, not random long-tail SaaS. Current strategy = targeted curation per vertical.

### 2026-05-14
- **Silent zero failure class (closed)**: A 0-PM scrape with `last_check_status='success'` looks identical to "genuinely 0 PMs" and "scraper silently broken." Phase 1 added `is_verified` + `is_verified_zero` columns. Every 0-PM company appeared in daily admin-digest "Unverified zeros" section until admin manually marked `is_verified_zero=true` OR scraper recovered. **Superseded 2026-05-28 (PR #90)**: the cron now auto-verifies zeros after `AUTO_VERIFY_ZERO_DAYS` (7) from a previously-verified scraper, auto-disables silent zeros after `SILENT_ZERO_DISABLE_DAYS` (14) from a never-verified scraper, and auto-flips `is_verified_zero=false` the moment >0 PMs reappear. The admin email's "Unverified zeros" section was retired entirely. New `consecutive_zero_days` column on companies tracks the streak. Auto-actions log to `scraper_events` (`auto_verified_zero` / `auto_unverified_zero`).
- **PM_KEYWORDS function-name vs role-name (fixed)**: AmEx, JPMorgan, Oracle put function name in titles ("Senior Manager - Product Management") not role name. Added "product management" to PM_KEYWORDS — recovered AmEx 1 → 234 keyword matches.
- **Ashby team-name filter bug (fixed)**: `scrapeAshbyCareers` previously kept jobs only from teams literally named "Product Management" etc. Modern companies embed PMs in product-area teams (Growth, Payments, Platform). Switched to title-keyword filter mirroring Greenhouse pattern. Recovered ~30 PMs across ~17 Ashby companies.
- **Edge-blocked / auth-gated companies (Meta, TikTok, Tesla, Wayfair)**: Akamai 403, FB session-gating, Stargate gateway X-GW-Code:2012, Workday 401/422. Hostname guards in `scraper.ts` return `[]` so stealth tier handles them — avoids burning Puppeteer launch on known-impossible scrape. All in `CUSTOM_SCRAPER_HOSTS`.
- **Apple REST API**: Two-step CSRF: GET `/api/v1/CSRFToken` returns `X-Apple-CSRF-Token` + cookies + AWSALB stickiness. POST `/api/v1/search` requires mandatory `format: {longDate, mediumDate}` field — without it API silently returns `{searchResults:[], totalRecords:0}`. Use cookie-name denylist (drop only `s_*, _ga, _gid, geo, pxsid, dssf, dssid`) not allowlist — keeps ALB stickiness.
- **Shopify Ashby-embed**: Standard Ashby hosted board returns `jobBoard: null` for `shopify`. Shopify's Remix SPA server-renders 84 jobs into a React Flight (RSC) streaming payload at `window.__reactRouterContext.streamController.enqueue(...)`. Deduplicated JSON array where field names appear once and job objects reference them by index. Parser resolves indices dynamically. Use `matchAll` on enqueue regex in case Shopify chunks the stream later.
- **Phenom People**: Used by eBay (tenant EBAEBAUS), BCG. Generic `scrapePhenomCareers(baseDomain, label, stats?)` parses inline DDO between `phApp.ddo = ` and `; phApp.experimentData =`, reads `eagerLoadRefineSearch.data.jobs` (server pre-renders exactly 10). **10-job server-render cap acknowledged in code**. `stats.totalScanned = totalHits` so self-healing tier knows source is live. Returns `[]` on transient 5xx.
- **Prior-art research is a habit, not optional**: Before building a custom scraper from scratch, spend 5-15 min searching GitHub for OSS implementations (MIT/Apache/BSD only). See `feedback_prior_art_research` memory.
- **Splunk acquired by Cisco**: Splunk's careers redirect to `careers.cisco.com/global/en/splunk` (Phenom). Hard-deleted 2026-05-14.

### 2026-05-11
- **Layer 2 stealth fix**: `ScrapeStats` out-param added so stealth tier only fires when `rawJobs.length === 0 && stats.totalScanned === 0` (genuine source failure), not when source returned jobs but 0 PMs.
- **Layer 1 stealth auto-fix**: `stealthFallbackScrape` returns `{ jobs, sniffedUrl, via }`. `inferPlatformFromSniffedUrl` re-platforms automatically.

### 2026-05-08
- **Coinbase deleted public Greenhouse board**: All `boards-api.greenhouse.io/v1/boards/coinbase/*` return 404. Internal `/api/v2/careers` rejects scraping with 400 even from stealth Puppeteer. `scrapeCoinbaseCareers` returns `[]` on capture failure so stealth fallback runs.
- **Throw vs return [] in custom scrapers**: Tier-1 scrapers that throw bypass tiers 2 and 3. To let auto-healing run, return `[]` instead of throwing for known/expected failures.
- **Stealth fallback won't run if Tier 1 throws**: `dailyCheck` checks `rawJobs.length === 0` to trigger stealth. If configured scraper throws, catch block fires and stealth is skipped. Pattern: `try { ... return jobs } catch { console.warn; return [] }`.

### 2026-04
- **Microsoft TPM inflation (fixed 2026-04-01)**: Microsoft's "program manager" exception was bypassing ALL hard exclusions. `COMPANY_EXTRA_EXCLUSIONS` in `validateScrape.ts` now rejects non-product PM variants. Cut Microsoft 123 → ~75 jobs.
- **US state abbreviations vs country codes (fixed 2026-04-23)**: April 1 fix for "ON,CA" rejected ALL 2-letter codes != "US", including US states. "San Francisco, CA" was treated as Canada. Fix: `US_STATES` set in `locationFilter.ts` exempts state abbreviations. Canadian provinces handled via explicit `NON_US_PATTERNS`. Silently rejected US jobs for ~3 weeks.
- **Puppeteer mass failure (fixed 2026-04-21)**: All 10 Puppeteer-dependent companies crashed with `posix_spawn` (Chrome binary issue in `:latest` Docker image). Migrated 7 to API scrapers. Pinned Docker image to `24.2.0`.
- **iCIMS API keyword search inconsistency**: iCIMS `q=` param doesn't filter at Rivian (returns all 668 jobs). Use `keywords=` param instead (works for Costco). Different iCIMS instances behave differently.
- **Docker `:latest` tag drift**: `ghcr.io/puppeteer/puppeteer:latest` pulled a broken Chrome build. Always pin Docker base images.
- **Puppeteer version must match Docker image**: `^24.2.0` resolved to 24.36.1 which wanted Chrome 144 (not in image). Must pin exact: `"puppeteer": "24.2.0"`.
- **Oracle HCM API**: Uses `recruitingCEJobRequisitions` REST endpoint. Requires `tenantUrl` + `siteNumber`. Returns all keyword matches, not just PM titles.
- **Empty locations default to excluded (fixed 2026-04-22)**: `isUSLocation("")` returns `false` (was `true`).
- **Oregon pattern case-sensitive (fixed 2026-04-22)**: `/\bOR\b/` (no `i` flag). Was matching the English word "or" in locations like "Bangalore or Remote".

### Older / cross-cutting
- **ATS API null responses**: External APIs (Ashby, Greenhouse, etc.) can return null payloads on transient failures even with HTTP 200. Always null-check before destructuring.
- **Eightfold custom domains**: Microsoft uses `apply.careers.microsoft.com` (not `*.eightfold.ai`). Domain extraction must handle both: eightfold subdomains AND custom domains. API sometimes returns 200 with HTML "Not Found" instead of JSON.
- **Anthropic moved from Ashby to Greenhouse** (2026-03-19): Ashby returns `jobBoard: null`. Greenhouse board token is `anthropic`.
- **Scrapers pre-filter by PM_KEYWORDS**: Most ATS scrapers return only PM-matching jobs, not all. `rawJobs.length === 0` is ambiguous — could be "no PM roles" or "broken API". Don't use raw count to detect failures.
- **Backend US location filtering (added 2026-03-22)**: `validateScrapeResults` filters non-US jobs via `isUSLocation()` in `lib/locationFilter.ts`. Non-US never enter `seen_jobs`. Frontend `isUSLocation` toggle in `jobFilters.ts` redundant but kept.
- **NON_US_PATTERNS coverage**: 60+ patterns for India, UK, Germany, France, Canada, Australia, Singapore, Japan, China, Ireland, Netherlands, Israel, Brazil, Mexico, Sweden, Switzerland, Spain, Italy, Poland, South Korea, Taiwan, Philippines, Vietnam, Thailand, Malaysia, Indonesia, Nigeria, Kenya, plus EMEA/APAC/LATAM region codes. Add new countries as needed to `lib/locationFilter.ts`.
- **PM_KEYWORDS false negatives**: Some companies use non-standard titles (e.g., "Product Growth"). Check if 0 PM roles but company has jobs.
- **Salesforce trap**: `careers.salesforce.com` redirects to marketing page. Use Workday URL directly: `salesforce.wd12.myworkdayjobs.com/External_Career_Site`.
- **Stale scraper data**: After changing a scraper, delete + re-add the company.
- **broadATSDiscovery overwrite**: Can silently change a custom scraper company's `platform_type` if a matching ATS board exists. Guarded by `CUSTOM_SCRAPER_HOSTS` blocklist. **Never remove this guard.**

## Double-Filtering Gotcha

Most scrapers (Greenhouse, Workday, Lever, etc.) filter by PM_KEYWORDS internally before returning results. Then `validateScrapeResults` filters again. This means `rawJobs.length === 0` can mean "no PM jobs" (legit) OR "scraper broken" — can't distinguish at the `dailyCheck` level. Actual scraper failures throw exceptions caught by the catch block.
