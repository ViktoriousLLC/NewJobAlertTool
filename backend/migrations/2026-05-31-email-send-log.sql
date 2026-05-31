-- DEV-49 (L5): daily email-delivery baseline + dead-man's-switch.
--
-- One row per daily cron run records how many subscribers were eligible, how
-- many email payloads were built, how many Resend accepted (sent), how many
-- failed, and how many companies posted new jobs that day. The cron reads the
-- trailing ~7 rows after each send and fires a Sentry alert if today's
-- `eligible` count collapses vs the 7-day average (a shrunk user/subscription
-- query that the in-run built/eligible ratio check (L3) cannot see, because
-- both numerator and denominator shrink together).
--
-- Backend-only table. No user data, no PII (no emails, no user_ids — just
-- daily aggregate counts). RLS enabled with no policies so the anon/auth keys
-- can't touch it; the cron uses the service-role key which bypasses RLS.

create table if not exists email_send_log (
  id bigint generated always as identity primary key,
  run_date date not null,
  eligible int not null,
  built int not null,
  sent int not null,
  failed int not null,
  companies_with_new_jobs int not null,
  created_at timestamptz not null default now()
);

alter table email_send_log enable row level security;

-- The baseline read selects the most recent rows by run_date DESC.
create index if not exists email_send_log_run_date_desc_idx
  on email_send_log (run_date desc);
