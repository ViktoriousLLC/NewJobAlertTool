-- =============================================================================
-- Phase 1 Rollback: Undo multi-user database migration
-- Run in Supabase SQL Editor if Phase 1 needs to be reverted
-- =============================================================================

-- Drop RLS policies on new tables
DROP POLICY IF EXISTS "Users see own subscriptions" ON user_subscriptions;
DROP POLICY IF EXISTS "Users insert own subscriptions" ON user_subscriptions;
DROP POLICY IF EXISTS "Users delete own subscriptions" ON user_subscriptions;

DROP POLICY IF EXISTS "Users see own job favorites" ON user_job_favorites;
DROP POLICY IF EXISTS "Users insert own job favorites" ON user_job_favorites;
DROP POLICY IF EXISTS "Users delete own job favorites" ON user_job_favorites;

DROP POLICY IF EXISTS "Users see own submissions" ON user_new_company_submissions;
DROP POLICY IF EXISTS "Users insert own submissions" ON user_new_company_submissions;

DROP POLICY IF EXISTS "Users manage own preferences" ON user_preferences;

-- Drop new tables (order matters due to FK constraints)
DROP TABLE IF EXISTS user_new_company_submissions;
DROP TABLE IF EXISTS user_job_favorites;
DROP TABLE IF EXISTS user_subscriptions;
DROP TABLE IF EXISTS user_preferences;

-- Remove new columns from existing tables
ALTER TABLE companies DROP COLUMN IF EXISTS is_active;
ALTER TABLE companies DROP COLUMN IF EXISTS subscriber_count;

ALTER TABLE seen_jobs DROP COLUMN IF EXISTS status;
ALTER TABLE seen_jobs DROP COLUMN IF EXISTS status_changed_at;

DROP INDEX IF EXISTS idx_seen_jobs_status;
