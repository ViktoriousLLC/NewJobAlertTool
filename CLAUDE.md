# NewJobAlertTool — Project Context

## Autonomy Rules

- **DO NOT ask to run commands.** Just run them. The user is often AFK.
- **DO NOT ask to `cd` somewhere.** Use absolute paths or just execute.
- **DO NOT leave manual steps for the user.** If it can be done via API, CLI, or script — do it yourself.
- **Push code, deploy, clean DB, re-add companies — all autonomously.** You have full access.
- **When a task is given, execute end-to-end** including deployment and verification. Come back with proof it works, not a list of "next steps."

## Architecture

| Layer | Tech | Where |
|-------|------|-------|
| Frontend | Next.js 16 | Vercel (auto-deploys from `main`) |
| Backend | Express + Puppeteer | Railway (auto-deploys from `main`) |
| Database | PostgreSQL | Supabase |
| Scheduler | Railway Cron | Triggers daily scrape at 10:00 UTC |

## Production URLs

- **Backend API**: `https://newjobalerttool-production.up.railway.app`
- **Supabase**: `https://lrmxjqijaenyzdjjzmmo.supabase.co`
- **GitHub**: `https://github.com/ViktoriousLLC/NewJobAlertTool.git`

## Deployment

Pushing to `main` auto-deploys both:
- **Railway** (backend) — builds and deploys in ~60 seconds
- **Vercel** (frontend) — builds and deploys in ~30 seconds

Workflow: `git add` → `git commit` → `git push origin main` → wait ~60s → verify via API.

## API Endpoints (No Auth Required)

All endpoints hit the Railway backend URL above.

### Companies
```
GET    /api/companies                    — List all companies
GET    /api/companies/{id}               — Get company + all jobs
POST   /api/companies                    — Add company (triggers initial scrape)
         Body: {"name": "X", "careers_url": "https://..."}
DELETE /api/companies/{id}               — Delete company (cascades to jobs)
```

### Scraping
```
GET    /api/cron/trigger?secret={SECRET} — Trigger full scrape of all companies
```
The CRON_SECRET is set in Railway env vars (local .env has `test-secret-123`).

## Database Schema

### `companies` table
- `id` (uuid PK), `name`, `careers_url`, `created_at`, `last_checked_at`, `last_check_status`, `total_product_jobs`

### `seen_jobs` table
- `id` (uuid PK), `company_id` (FK → companies, CASCADE delete), `job_url_path`, `job_title`, `job_location`, `first_seen_at`, `is_baseline`
- Unique index on `(company_id, job_url_path)`
- `is_baseline = true` for initial scrape, `false` for newly discovered jobs
- Non-baseline jobs older than 30 days are auto-cleaned

## Scraper Architecture (backend/src/scraper/scraper.ts)

### Shared Greenhouse helper
`scrapeGreenhouseCareers(boardName, companyLabel)` — reusable for any company on Greenhouse. Fetches `https://api.greenhouse.io/v1/boards/{boardName}/jobs`, filters by `PM_KEYWORDS`.

### Company → Scraper Routing
| Company | Scraper | Board/Platform |
|---------|---------|---------------|
| Atlassian | Custom API | atlassian.com/endpoint/careers/listings |
| DoorDash | Greenhouse helper | `doordashusa` |
| Discord | Greenhouse helper | `discord` |
| Reddit | Greenhouse departments + keyword filter | `reddit` |
| Instacart | Greenhouse helper | `instacart` |
| Figma | Greenhouse helper | `figma` |
| Airbnb | Greenhouse helper | `airbnb` |
| OpenAI | Ashby GraphQL API | ashbyhq.com/openai |
| Slack | Salesforce Workday API | wd12.myworkdayjobs.com |
| Stripe | Puppeteer pagination | stripe.com/jobs |
| Uber | Custom JSON API | uber.com/api |
| Google | Puppeteer pagination | google.com/careers |
| Netflix | Custom JSON API | explore.jobs.netflix.net |
| PayPal | Eightfold.ai API | paypal.eightfold.ai |
| Others | Generic Puppeteer | Fallback HTML scraper |

### Stripe scraper notes
- Puppeteer-based, paginates `stripe.com/jobs/search?skip=0` through `skip=1200`
- Filters for PM keywords AND excludes sales roles (account executive, sales engineer, etc.)
- Fetches each job's detail page for location data (Office locations / Remote locations sections)
- The full scrape takes ~2-3 minutes due to Puppeteer page loads

### To fix a broken scraper
1. Identify the platform (check the careers page source or API)
2. If Greenhouse: use `scrapeGreenhouseCareers("boardname", "Label")`
3. Add hostname routing in `scrapeCompanyCareers()`
4. Push to deploy
5. Delete the company via API, re-add it to get fresh data

### Stale data / contaminated jobs
When a new platform-specific scraper is added (e.g., Eightfold API for PayPal), old jobs scraped by the generic Puppeteer fallback remain in the DB with bad data (title/location/date mashed together). **Always delete and re-add the company** after adding a new scraper to flush stale data.

## Key Files

- `backend/src/scraper/scraper.ts` — All scraper logic
- `backend/src/jobs/dailyCheck.ts` — Daily cron job logic
- `backend/src/routes/companies.ts` — API route handlers
- `backend/src/index.ts` — Express server entry point
- `frontend/src/app/page.tsx` — Dashboard UI (tile grid)
- `frontend/src/app/add/page.tsx` — Add company UI
- `frontend/src/app/company/[id]/page.tsx` — Company detail page (with next-company nav)
- `frontend/src/app/jobs/page.tsx` — "View All Jobs" flat table across all companies
- `frontend/src/app/layout.tsx` — Root layout with navbar (View All Jobs + Add Company buttons)
- `cron/index.js` — Railway cron trigger script
- `supabase-schema.sql` — Database schema

## Frontend Pages

| Route | File | Description |
|-------|------|-------------|
| `/` | `page.tsx` | Dashboard — tile grid of all tracked companies, sorted by activity |
| `/add` | `add/page.tsx` | Add a new company form |
| `/company/[id]` | `company/[id]/page.tsx` | Company detail — jobs grouped by date, US filter, "Next Company" nav |
| `/jobs` | `jobs/page.tsx` | All Jobs — flat table of every job across all companies |

### Navbar (`layout.tsx`)
Sticky top nav with: Logo + "Vik's New Job Tool" | [View All Jobs] [+ Add Company]

### Shared patterns
- **US Only toggle**: Checkbox filter using `isUSLocation()` regex matcher — shared logic in company detail and all-jobs pages
- **`first_seen_at`**: Used as "Date Added" in the all-jobs table (per-job, not per-company)
- **`last_checked_at`**: Used in company detail page stats (per-company scrape timestamp)

## Common Operations

### Delete and re-add a company (to fix corrupted data)
```bash
# Find company ID
curl -s "https://newjobalerttool-production.up.railway.app/api/companies"

# Delete it
curl -s -X DELETE "https://newjobalerttool-production.up.railway.app/api/companies/{id}"

# Re-add it (triggers fresh scrape)
curl -s -X POST "https://newjobalerttool-production.up.railway.app/api/companies" \
  -H "Content-Type: application/json" \
  -d '{"name":"CompanyName","careers_url":"https://..."}'
```

### Test a Greenhouse board exists
```bash
curl -s "https://api.greenhouse.io/v1/boards/{boardname}/jobs" | head -c 200
```

### Verify deployment worked
```bash
curl -s "https://newjobalerttool-production.up.railway.app/api/companies" | python3 -m json.tool
```
