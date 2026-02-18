-- Phase 6 Cleanup: Run AFTER deploying the code that removes user_id from INSERT.
-- This drops legacy columns and tables that are no longer used.

-- 1. Add index for job status + first_seen_at queries (weekly digest, archival)
CREATE INDEX IF NOT EXISTS idx_seen_jobs_status_first_seen
  ON seen_jobs(status, first_seen_at);

-- 2. Drop the old favorites table (replaced by user_job_favorites)
DROP TABLE IF EXISTS favorites;

-- 3. Drop the legacy user_id column from companies (no longer used)
ALTER TABLE companies DROP COLUMN IF EXISTS user_id;
