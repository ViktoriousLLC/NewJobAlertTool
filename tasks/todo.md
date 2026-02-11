# Auto-Detect ATS Platform + Quality Validation + User Feedback

## Implementation Status

### Code Complete (all compile + build successfully)

- [x] **Step 1: Fix Netflix scraper** — Added PM_KEYWORDS filtering after API fetch
- [x] **Step 2: Fix Slack/Workday locations** — Widened vague detection, added fallback, always attempt detail fetch
- [x] **Step 3: Platform detection engine** — `detectPlatform.ts` with HTML fetch + Puppeteer fallback
- [x] **Step 4: Lever scraper** — `scrapeLeverCareers(handle, label)` using public API
- [x] **Step 5: Refactor routing** — Platform-based switch + generalized Ashby/Workday
- [x] **Step 6: Quality validation** — `validateScrape.ts` with title/location/duplicate/URL checks
- [x] **Step 7: Integrate into add-company** — Detection + validation in POST handler
- [x] **Step 8: Update daily check** — Platform info passthrough + validation
- [x] **Step 9: Report Issue** — Backend endpoint + frontend button + email link
- [x] **Step 10: Improve generic Puppeteer** — Infinite scroll, tab detection, text-based Load More
- [x] **Step 11: Test script + schema SQL** — `testDetection.ts` + updated `supabase-schema.sql`
- [x] **Build verification** — Backend TypeScript compiles, frontend Next.js builds

### User Manual Steps Required (before deploy)

- [ ] **Run SQL migration** in Supabase SQL Editor (adds `platform_type`, `platform_config`, `scrape_issues` table)
- [ ] **Cloudflare Email Routing** — Set up `feedback@newpmjobs.com` forwarding (optional, for email feedback)

### Post-Deploy Verification

- [ ] Push to main → Railway + Vercel auto-deploy
- [ ] Verify health check: `curl https://api.<domain>/api/health`
- [ ] Test adding a Lever company (e.g., Cloudflare)
- [ ] Verify existing companies still scrape correctly (trigger cron)
- [ ] Verify Report Issue button works on company detail page

## Files Changed

| File | Change |
|------|--------|
| `backend/src/scraper/scraper.ts` | Netflix filter, Slack locations, Lever scraper, generalized Ashby/Workday, platform routing, improved generic fallback |
| `backend/src/scraper/detectPlatform.ts` | **NEW** — Platform detection engine |
| `backend/src/scraper/validateScrape.ts` | **NEW** — Post-scrape quality validation |
| `backend/src/routes/companies.ts` | Detection + validation in POST handler |
| `backend/src/routes/issues.ts` | **NEW** — Scrape issue reporting endpoint |
| `backend/src/jobs/dailyCheck.ts` | Platform info passthrough, validation |
| `backend/src/index.ts` | Register issues route |
| `frontend/src/app/company/[id]/page.tsx` | Report Issue button + quality badge |
| `frontend/src/app/page.tsx` | Error state report link, quality-aware status |
| `backend/src/scripts/testDetection.ts` | **NEW** — Detection test script |
| `supabase-schema.sql` | New migration for platform + issues |
| `CLAUDE.md` | Updated docs for new architecture |
