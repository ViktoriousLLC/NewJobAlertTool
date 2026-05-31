-- Schema-drift close-out: scraper_events + help_submissions.
--
-- Both of these tables have existed live in prod for a while but had NO
-- committed migration (they predate the backend/migrations/ folder, created via
-- the Supabase SQL Editor). This file backfills the CREATE TABLE so a
-- from-scratch rebuild produces the live shape, and enables RLS on both — a
-- Supabase advisor flagged them as RLS-off.
--
--   * scraper_events  — audit log of self-healing actions (see JOBS.md). No PII;
--     RLS enabled for consistency (every table has RLS ON).
--   * help_submissions — legacy bug-reporting table. Holds PII (user_id,
--     user_email, free-text message), so RLS matters here: without it the
--     anon/authenticated PostgREST keys could read every user's reports. New
--     feedback now files Linear issues; this table holds pre-2026-05-22 history
--     only, but the rows are still sensitive.
--
-- Both tables use the service-role key from the backend, which bypasses RLS, so
-- enabling RLS with no policies (deny-all to anon/auth) does not change backend
-- behavior.
--
-- NOTE: these statements were ALREADY applied to prod live via the Supabase MCP;
-- this file exists so the repo matches prod and a from-scratch rebuild is correct.

create table if not exists scraper_events (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid,
  company_name text        not null,
  event_type   text        not null,
  details      jsonb,
  created_at   timestamptz not null default now()
);

alter table scraper_events enable row level security;

create table if not exists help_submissions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null,
  user_email text,
  issue_type text        not null default 'other',
  message    text        not null,
  page_url   text,
  created_at timestamptz default now()
);

alter table help_submissions enable row level security;
