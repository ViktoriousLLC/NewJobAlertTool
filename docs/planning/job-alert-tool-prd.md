# Job Alert Tool - Product Requirements Document

**Version:** 1.0 (V1 Scope)  
**Author:** Vik  
**Date:** February 1, 2026

---

## Overview

A personal tool that monitors company career pages daily and sends email notifications when new product management jobs are posted.

---

## Problem Statement

When job hunting, it's tedious to manually check dozens of company career pages daily. Jobs get filled quickly, and being late to apply reduces chances of getting noticed. I need automated monitoring that tells me when new PM roles appear at companies I care about.

---

## Solution

A web app where I:
1. Add company career page URLs
2. System scrapes all jobs, filters for "product" keyword, establishes baseline
3. Daily at 2am PT, system re-checks and compares against baseline
4. Email sent with new jobs found, sorted by company (highest count first)

---

## User Stories

### As a job seeker, I want to:

1. **Add a company to track** by pasting their careers page URL
2. **See my tracked companies** with their last check date and job counts
3. **Receive daily emails** listing any new product jobs found
4. **View recent new jobs** per company (last 30 days)
5. **Remove a company** I no longer want to track

---

## Functional Requirements

### 1. Add Company

**Input:** Career page URL (e.g., `https://careers.roblox.com/jobs?disciplines=product`)

**System behavior:**
- Extract company name from URL domain (e.g., `roblox` from `careers.roblox.com`)
- Store URL and company name
- Run initial scrape using Puppeteer:
  - Load page fully (wait for JS rendering)
  - Click "Show More" / pagination until all jobs loaded OR 200 job limit reached
  - Extract all job listings (title + URL)
  - Filter for jobs with "product" in title (case-insensitive)
  - Store as baseline ("seen" jobs) - these are NOT new, they already existed

**Edge cases:**
- If >200 jobs found: Show warning with options:
  - "⚠️ [Company] has [X] product jobs. This exceeds the 200 job limit."
  - Option 1: "Continue anyway" → Scrape all jobs (may take longer, higher resource usage)
  - Option 2: "Cancel" → Don't add company, user can refine URL with more filters
  - This decision is per-company, shown at add time
- If page fails to load: Show error with retry option

### 2. Dashboard (Home)

**Display:**
| Company | Careers URL | Last Checked | Product Jobs (Total) | New Jobs (Last 30 Days) |
|---------|-------------|--------------|----------------------|-------------------------|
| Roblox | careers.roblox.com/... | Feb 1, 2026 | 18 | 3 |
| Uber | uber.com/careers/... | Feb 1, 2026 | 41 | 0 |

**Actions:**
- Click company name → Company Detail page
- Delete button per company (with confirmation)
- "Add Company" button

### 3. Company Detail Page

**Display:**
- Company name
- Careers URL (clickable)
- Total product jobs currently tracked
- List of NEW jobs found in last 30 days, grouped by date:

```
February 1, 2026 (2 new jobs)
• Senior Product Manager, Creator Tools
  https://careers.roblox.com/jobs/7654321
• Product Manager, Safety
  https://careers.roblox.com/jobs/7654322

January 30, 2026 (1 new job)
• Director of Product, Platform
  https://careers.roblox.com/jobs/7654320
```

### 4. Daily Email

**Trigger:** 2:00 AM Pacific Time, every day

**Subject:** `Job Alert: X new product jobs found (Feb 2, 2026)`

**Body format:**
```
Uber (2 new jobs)
─────────────────────────
• Senior Product Manager, Rides
  https://www.uber.com/careers/list/12345

• PM, Eats Platform
  https://www.uber.com/careers/list/12346


Roblox (1 new job)
─────────────────────────
• Product Manager, Creator Tools
  https://careers.roblox.com/jobs/7654321


Cisco (0 new jobs)
─────────────────────────
No new product jobs today.


──────────────────────────────────────
Summary: 3 new jobs across 3 companies
```

**Sorting:** Companies ordered by new job count (descending). Companies with 0 new jobs listed last.

**Edge cases:**
- 0 new jobs across ALL companies: Still send email with "No new product jobs found today" so I know the system ran
- Scrape failure: Include in email: "⚠️ Failed to check [Company] - will retry tomorrow"

### 5. Data Retention

- Jobs older than 30 days are deleted from the "new jobs" list
- Jobs remain in the "seen" baseline indefinitely (to prevent re-notification)
- If a job disappears and reappears after 30+ days, it will be treated as new again

---

## Non-Functional Requirements

### Tech Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| Frontend | Next.js on Vercel | Simple UI, no auth for V1 |
| Backend | Node.js on Railway | Express/Fastify API + Puppeteer for scraping |
| Database | Supabase (Postgres) | Free tier sufficient |
| Email | Resend | Free tier: 100 emails/day |
| Scheduler | Railway Cron | Triggers daily scrape job |

### Performance

- Scrape timeout: 60 seconds per company
- Retry once on failure before marking as failed
- Rate limit: 5 second delay between scraping different companies (avoid looking like a bot attack)

### Cost Constraints

- **Railway budget:** Alert me if projected to exceed $10/month
- **Job count warning:** If a company has >200 jobs, prompt for confirmation before scraping (not a hard block)

---

## Database Schema

### Tables

**companies**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| name | text | Extracted from URL domain |
| careers_url | text | Full URL to careers page |
| created_at | timestamp | When added |
| last_checked_at | timestamp | Last successful scrape |
| last_check_status | text | 'success', 'failed', 'over_limit' |
| total_product_jobs | int | Current count of product jobs |

**seen_jobs**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| company_id | uuid | Foreign key |
| job_url_path | text | e.g., `/jobs/7654321` (unique identifier) |
| job_title | text | Full job title |
| first_seen_at | timestamp | When we first detected this job |
| is_baseline | boolean | True if existed on initial scrape |

**Indexes:**
- `seen_jobs(company_id, job_url_path)` - unique constraint
- `seen_jobs(first_seen_at)` - for 30-day cleanup query

---

## Scraping Logic

### Extraction Process (Puppeteer)

1. Navigate to careers URL
2. Wait for page load (networkidle2 or 10 seconds)
3. Check for job count indicator on page
   - If >200, pause and prompt user for confirmation before continuing
4. Click "Show More" / "Load More" buttons repeatedly until:
   - No more button exists, OR
   - 200 jobs loaded
5. Extract all job elements:
   - Job title (text content)
   - Job URL (href attribute)
6. Filter: Keep only jobs where title contains "product" (case-insensitive)
7. Return list of {title, url_path}

### Handling Different Sites

Each company's careers page is different. The scraper will need to handle:

| Challenge | Approach |
|-----------|----------|
| JS-rendered pages | Puppeteer handles this by running real browser |
| "Show More" buttons | Generic click on common button patterns |
| Pagination | Click through pages or detect API calls |
| Infinite scroll | Scroll to bottom repeatedly until no new jobs load |
| Bot detection | Use stealth plugin, add delays, rotate user agents |

**V1 Scope:** Start with Roblox. Add site-specific selectors as needed for each new company.

### Keyword Filtering

- Default keyword: "product"
- Match: Case-insensitive, partial match on job title
- Examples that match: "Product Manager", "Director of Product", "Senior PM, Product Platform"
- Future: Allow custom keywords per company

---

## Email Configuration

| Setting | Value |
|---------|-------|
| From | alerts@<your-domain> |
| To | Set via ALERT_RECIPIENT_EMAIL env var |
| Provider | Resend |
| Schedule | Daily at 2:00 AM Pacific |

---

## V1 Scope Boundaries

### In Scope
- Single user (no auth)
- Add/remove companies
- Daily scrape + email
- Basic dashboard
- Roblox as initial test case

### Out of Scope (V2+)
- User authentication / multi-user
- Custom keywords per company
- Multiple notification channels (Discord, SMS)
- Job application tracking
- Mobile app
- Monetization / public launch

---

## Success Criteria

V1 is successful if:
1. I can add Roblox careers URL and see baseline jobs
2. System sends daily email at 2am PT
3. When a new product job is posted on Roblox, I receive notification within 24 hours
4. System runs reliably for 2+ weeks without manual intervention
5. Railway costs stay under $10/month

---

## Open Questions / Risks

| Item | Status | Notes |
|------|--------|-------|
| Roblox page structure | To verify | Need to confirm Puppeteer can extract all jobs |
| Uber bot detection | Risk | 406 error on simple fetch; Puppeteer may work, may not |
| Rate limiting | Risk | Frequent scraping may get IP blocked |
| Job URL stability | Assumption | Assuming URL path stays same for a job's lifetime |

---

## Next Steps

1. Set up Supabase project with schema
2. Set up Railway project with Puppeteer
3. Build scraper for Roblox as proof of concept
4. Build minimal Next.js UI
5. Set up Resend for email
6. Configure Railway cron job
7. Test end-to-end with Roblox
8. Add more companies one by one

---

## Appendix: Example Company URLs

| Company | Careers URL (filtered for Product) |
|---------|-----------------------------------|
| Roblox | `https://careers.roblox.com/jobs?disciplines=product` |
| Uber | `https://www.uber.com/us/en/careers/list/?department=Product&location=USA-California-San%20Francisco` |
| Cisco | TBD |
| Meta | TBD |
