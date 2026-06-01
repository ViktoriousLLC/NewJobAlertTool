-- DEV-57: cron_runs tracks the daily run lifecycle so a run that dies mid-way is
-- observable from OUTSIDE the process (the out-of-band watchdog reads this).
-- started_at is written at the TOP of the run (before the long scrape loop), so a
-- killed run leaves a row with completed_at IS NULL = "started but never finished".
CREATE TABLE IF NOT EXISTS cron_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date      date NOT NULL,
  kind          text NOT NULL DEFAULT 'daily',        -- daily | scrape-only | email-only
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,                          -- NULL => started but not finished
  status        text NOT NULL DEFAULT 'running',      -- running | completed | interrupted | failed
  companies_total   int,
  companies_scraped int NOT NULL DEFAULT 0,
  emails_sent       int,
  emails_skipped    boolean NOT NULL DEFAULT false,
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_date, kind)
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_date ON cron_runs (run_date DESC);

-- RLS on, no policies => service-role (backend) only; anon/auth cannot read or
-- write. Matches the project rule that every table has RLS on, and email_send_log.
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
