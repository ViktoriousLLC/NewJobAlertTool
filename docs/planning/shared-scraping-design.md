# Shared Scraping Architecture — Design Discussion

_Captured 2026-02-12_

## Problem

Currently each user gets their own copy of every company and its jobs. If 10 users track Netflix, Netflix gets scraped 10 times daily and jobs are stored 10 times. This doesn't scale.

## Proposed Design

**Shared companies + user subscriptions:**
- `companies` table becomes shared (drop `user_id`) — one Netflix row for everyone
- New `user_companies` join table (`user_id`, `company_id`, `subscribed_at`) — tracks who follows what
- `seen_jobs` stays tied to shared `company_id` — one set of jobs, shared
- `favorites` stays as-is — already user-scoped via `job_id` + `user_id`

**Onboarding flow:**
- New users see a checklist of all existing companies instead of a blank dashboard
- One tap per company to subscribe — instant, no scrape needed
- "Add Custom" option still available for companies not in the catalog (triggers actual scrape)
- Subscribing populates last 30 days of roles in their view

**Delete = unsubscribe:**
- Removing a company from your dashboard deletes the `user_companies` row only
- Company and jobs stay in the DB for other subscribers (and future ones)

## Three Key Decisions

### 1. What does "new" mean for a fresh subscriber?

**Decision:** "+N new" is a company-level stat — it means N jobs were posted today. Same number for all users. Not personal. Simple and accurate.

### 2. What happens when the last user unsubscribes from a company?

**Decision:** Keep scraping anyway. The catalog is small (30-50 companies). Cron cost is trivial. Don't overcomplicate it.

### 3. Who can edit company settings (URL, platform config, slug)?

**Decision:** Admin-only. Users can subscribe, unsubscribe, and report issues. They cannot edit the shared company record. This prevents one user from accidentally breaking a scraper for everyone. This is effectively how it works today since the UI doesn't expose company editing.

## Data Model Summary

```
companies (shared, no user_id)
  id, name, careers_url, platform_type, platform_config, levelsfyi_slug, ...

user_companies (join table)
  user_id, company_id, subscribed_at

seen_jobs (unchanged, tied to shared company_id)
  id, company_id, job_url_path, job_title, job_location, first_seen_at, is_baseline, job_level

favorites (unchanged, user-scoped)
  id, job_id, user_id, created_at
```

## Migration Scope

Touches: DB schema, backend routes, cron logic, `new_jobs_today` computation, onboarding UI.
Frontend changes are minimal — mostly consumes the same API shape.

## Status

Discussion only — not yet approved for implementation.
