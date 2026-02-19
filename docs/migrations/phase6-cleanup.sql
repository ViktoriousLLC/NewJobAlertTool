-- =============================================================================
-- Phase 6: Cleanup (run ONLY after all phases are deployed and verified)
-- =============================================================================

-- Drop the old favorites table (data already migrated to user_job_favorites)
DROP TABLE IF EXISTS favorites;

-- Remove the user_id column from companies (no longer used for scoping)
ALTER TABLE companies DROP COLUMN IF EXISTS user_id;

-- Remove the old index on user_id
DROP INDEX IF EXISTS idx_companies_user_id;
