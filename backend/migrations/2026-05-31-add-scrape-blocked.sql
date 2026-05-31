-- Marks employers whose career site hard-blocks scraping (Akamai 403, session-gating,
-- gateway rejects, Workday 401/422). For these the UI shows a "Restricted" badge instead
-- of an empty job list, so a blocked employer reads as the employer denying access rather
-- than our scraper failing.
--
-- Backward compatible: defaults false, so every existing/new company is unaffected unless
-- explicitly flagged. The main loop sets the 4 currently-blocked employers via Supabase MCP
-- after this column is applied (do NOT mutate prod from the worktree).
--
-- Companies to flag scrape_blocked = true (match by careers_url hostname):
--   metacareers.com   (Meta)
--   tiktok.com        (TikTok)
--   tesla.com         (Tesla)
--   wayfair.com       (Wayfair)
-- These are the same hosts that yield to the stealth tier in scraper.ts and live in
-- CUSTOM_SCRAPER_HOSTS (see backend/src/scraper/SCRAPER.md).

alter table companies add column if not exists scrape_blocked boolean not null default false;

comment on column companies.scrape_blocked is
  'Employer career site hard-blocks scraping; UI shows a "Restricted" badge instead of an empty job list.';
