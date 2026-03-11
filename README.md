# NewJobAlertTool

A daily job alert system that automatically scrapes PM roles from 50+ top tech companies and sends personalized email digests. Built to solve the problem I lived through: spending hours every day manually checking career pages during a job search.

**Live at [newpmjobs.com](https://newpmjobs.com)**

---

## The Problem

Job searching as a PM is painful. The roles you want are spread across dozens of career sites, each with a different ATS platform (Greenhouse, Lever, Ashby, Workday, and more). By the time you manually check them all, the best postings are already days old and flooded with applicants.

I applied to 4,000+ jobs over 2 years earlier in my career. I know what it feels like to miss a great role because you checked the page a day late. So I built the tool I wished I had.

## The Solution

NewJobAlertTool is a multi-user SaaS that does the checking for you:

1. **Subscribe to companies you care about** from a shared catalog (or add new ones by URL)
2. **Automated daily scraping** at 9 AM ET hits every company's careers page and identifies PM roles using 17 keyword filters
3. **Personalized email alerts** tell you exactly which new roles appeared since yesterday
4. **Dashboard** shows all active PM roles across your tracked companies, with starring, filtering, and levels.fyi salary data

Under the hood, the system auto-detects which ATS platform a company uses (Greenhouse, Lever, Ashby, Workday, Eightfold, or custom) and routes to the optimal scraper. No manual configuration needed when adding a new company.

### Architecture

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 on Vercel |
| Backend | Express + Puppeteer on Railway |
| Database | PostgreSQL on Supabase |
| Scheduler | Railway Cron (daily scrape) |
| Auth | Supabase Auth (magic link, no passwords) |
| Email | Resend (batch alerts) |
| Monitoring | Sentry + PostHog |

### Key Features

- **Multi-platform scraping**: Greenhouse API, Lever API, Ashby GraphQL, Workday JSON, Eightfold API, custom APIs (Uber, Netflix, Atlassian), and Puppeteer fallback for everything else
- **Platform auto-detection**: Feed it any careers URL and it figures out the ATS, extracts the company name, and picks the right scraper
- **Check-then-add flow**: Preview scrape results before committing. Nothing hits the database until you confirm the results look right
- **Three-tier compensation cache**: In-memory (1hr) to DB (24hr) to live levels.fyi fetch. Salary data loads lazily so it never blocks the page
- **Job lifecycle tracking**: Active to removed to archived. Favorited jobs persist even after listings disappear
- **Multi-user with shared catalog**: One Uber entry, scraped once, available to all users. Per-user subscriptions, favorites, and email preferences
- **Security hardened**: CSP headers, open redirect prevention, HTML-escaped user input in emails, SSRF protection, PII scrubbed from logs

## Tradeoffs and Decisions

**PM keyword filtering vs. broad scraping.** I filter jobs using 17 PM-related keywords (product manager, product lead, product growth, etc.) rather than returning all roles. This means some edge cases slip through (a16z uses non-standard titles), but it keeps signal-to-noise high. When users report missing roles, I add keywords. This felt like the right tradeoff for a tool where relevance matters more than completeness.

**API-first scraping with Puppeteer as fallback.** For companies on known ATS platforms, I hit their structured APIs directly. Puppeteer only runs for companies without an API (Stripe, Google). API scraping is faster (under 1 second vs. 2 to 3 minutes for Puppeteer), more reliable, and cheaper on server resources. The tradeoff is that adding a new custom scraper takes more upfront work, but the daily reliability is worth it.

**Shared company catalog vs. per-user companies.** Early versions were single-user. When I rebuilt for multi-user, I had to decide: does each user get their own copy of "Uber" (scraped separately), or is there one shared entry? Shared catalog means one scrape serves all users, but it means you can't customize which roles you see per company. I chose shared because the scraping cost scales linearly with companies, not users, and PM roles are PM roles regardless of who's looking.

**Magic link auth instead of passwords.** No password resets, no credential storage, no brute force attacks. The tradeoff is that login requires email access, which adds friction. But for a tool where users log in once and get daily emails, the reduced security surface was worth it. I also had to solve the cross-device problem where PKCE magic links only work in the browser that requested them, which I fixed by switching to a token-hash verification flow.

**Job archival instead of hard deletion.** When a job listing disappears from a company's careers page, I mark it "removed" rather than deleting it. After 60 days, it moves to "archived." This preserves favorited jobs so users don't lose saved listings. The tradeoff is slightly more database storage, but storage is cheap and losing a user's bookmarked job is a bad experience.

## What I Learned

**Platform detection is the hardest part.** I assumed most companies would be on one of a few ATS platforms. In reality, the same ATS can be embedded in custom domains, redirect through marketing pages (Salesforce's careers page redirects away from their actual Workday job board), or use non-standard configurations. My detection engine runs through 7 layers of checks: known hostnames, direct ATS URLs, HTML embed detection, SPA rendering, speculative API probes, and generic fallback. Each layer was added to handle a real failure case.

**Scrape validation prevents silent failures.** Early on, a scraper change would sometimes return zero results or garbage data, and I wouldn't notice until a user reported it. Adding post-scrape validation (quality scoring, zero-result flags, duplicate detection) caught these failures automatically. The quality score is stored per company so I can see trends in the admin dashboard.

**Batch email sending matters immediately, not at scale.** Even with only a handful of users, individual API calls hit Resend's 2 req/s rate limit. Switching to batch sends (100 per API call with 1s delays) was a day-one necessity, not a scale optimization. This is the kind of thing you learn only by running the system in production.

**Desktop Lighthouse 100, mobile still stuck at 72 to 77.** I code-split the landing page, pre-computed brand colors, and deferred analytics init to hit perfect desktop scores. But mobile is bottlenecked by React DOM's 225KB runtime, which is outside my control without converting to React Server Components. Sometimes the performance ceiling is the framework, not your code.

## Future Improvements

- Convert landing page to React Server Component for mobile Lighthouse gains
- Nonce-based CSP (currently uses unsafe-inline for Next.js hydration)
- Slack/Discord alert channels alongside email
- Job deduplication across companies (same role posted on multiple boards)
- Resume-match scoring using job descriptions

## How This Product Evolved

The full story of how this went from a localhost script to a production SaaS is in [docs/product-development-journey.md](docs/product-development-journey.md). It covers 14 phases of product decisions, tradeoffs, and lessons learned, including multi-platform scraper architecture, multi-user auth, performance optimization (Lighthouse 49 to 100), security hardening, and building the entire product with AI coding tools.

## Built By

[Vik Agarwal](https://www.linkedin.com/in/vik-agarwal/) | Product Leader at Meta | Author of [Achievement Unlocked](https://www.amazon.com/Achievement-Unlocked-Winning-Strategies-Managers/dp/9363383385) | [VikAgarwal.com](https://vikagarwal.com/)
