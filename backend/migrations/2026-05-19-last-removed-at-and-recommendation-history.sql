-- Applied via Supabase MCP on 2026-05-19.

-- 1) Track when a job was first marked 'removed' so we can apply the
--    2-week rule: a job returning after >=14 days absence = real re-post,
--    counts as "new" in the email. A return within 14 days = scraper jitter,
--    suppressed from the email (still flipped to active in the catalog).
ALTER TABLE seen_jobs
  ADD COLUMN IF NOT EXISTS last_removed_at TIMESTAMPTZ;

COMMENT ON COLUMN seen_jobs.last_removed_at IS
  'Timestamp when this job was most recently marked status=removed. NULL if never removed.';

-- Backfill: existing removed/archived rows use status_changed_at as proxy.
UPDATE seen_jobs
SET last_removed_at = status_changed_at
WHERE status IN ('removed', 'archived')
  AND last_removed_at IS NULL;

-- 2) Track which companies the daily email recommended on which day,
--    so the rotation can skip them for the next ~7 days. Global, not
--    per-user — same recommendations for everyone on a given day (v1).
CREATE TABLE IF NOT EXISTS recommendation_history (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shown_date DATE NOT NULL,
  industry TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_history_recent
  ON recommendation_history (shown_date DESC, company_id);

COMMENT ON TABLE recommendation_history IS
  'Daily log of companies featured in the email recommendation block. Rotation excludes companies in here from the last 7 days. Cleaned up to 30-day retention.';
