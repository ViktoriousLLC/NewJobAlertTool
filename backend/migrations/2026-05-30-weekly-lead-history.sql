-- Weekly digest "lead angle" history.
--
-- The weekly LinkedIn digest now picks a ROTATING lead ("My take this week: ...")
-- instead of the old hardcoded "Banking is on a tear." To stop it repeating the
-- same angle (or the same image art style) two weeks running, we log what each
-- Friday send used and feed the last few rows back into the writer as a
-- freshness exclusion. Same idea as recommendation_history for email recs.
--
-- Backend-only table (written/read by the service role inside the cron), no
-- user-facing surface, so no RLS (mirrors comp_cache).

create table if not exists weekly_lead_history (
  id          bigint generated always as identity primary key,
  week_ending date        not null,
  angle       text        not null,   -- 'ai_share' | 'top_company' | 'top_pay' | 'big_tech' | 'top_city' | 'seniority'
  headline    text        not null,   -- the rendered "My take" hook that was sent
  art_style   text,                   -- image art style used that week (for style rotation)
  created_at  timestamptz not null default now()
);

create index if not exists idx_weekly_lead_history_created_at
  on weekly_lead_history (created_at desc);
