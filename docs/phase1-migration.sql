-- =============================================================================
-- Phase 1: Multi-User Overhaul — Database Migration
-- Run in Supabase SQL Editor (in order: 1A → 1B → 1C → 1D)
-- =============================================================================

-- =============================================================================
-- 1A. Add columns to existing tables
-- =============================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS subscriber_count integer NOT NULL DEFAULT 0;

ALTER TABLE seen_jobs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_seen_jobs_status ON seen_jobs(status);

-- =============================================================================
-- 1B. Create new tables
-- =============================================================================

-- User subscriptions: links users to shared companies
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subscriptions_unique
  ON user_subscriptions(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id
  ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_company_id
  ON user_subscriptions(company_id);

-- User job favorites (replaces old favorites table)
CREATE TABLE IF NOT EXISTS user_job_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  seen_job_id uuid NOT NULL REFERENCES seen_jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_job_favorites_unique
  ON user_job_favorites(user_id, seen_job_id);
CREATE INDEX IF NOT EXISTS idx_user_job_favorites_user_id
  ON user_job_favorites(user_id);

-- Track new company submissions per user (for rate limiting)
CREATE TABLE IF NOT EXISTS user_new_company_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_new_company_submissions_user_id
  ON user_new_company_submissions(user_id);

-- User preferences (email frequency, etc.)
CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) UNIQUE,
  email_frequency text NOT NULL DEFAULT 'daily',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 1C. RLS policies on new tables
-- =============================================================================

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_job_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_new_company_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- user_subscriptions: SELECT/INSERT/DELETE scoped to own user
CREATE POLICY "Users see own subscriptions"
  ON user_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own subscriptions"
  ON user_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own subscriptions"
  ON user_subscriptions FOR DELETE USING (auth.uid() = user_id);

-- user_job_favorites: SELECT/INSERT/DELETE scoped to own user
CREATE POLICY "Users see own job favorites"
  ON user_job_favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own job favorites"
  ON user_job_favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own job favorites"
  ON user_job_favorites FOR DELETE USING (auth.uid() = user_id);

-- user_new_company_submissions: SELECT/INSERT scoped
CREATE POLICY "Users see own submissions"
  ON user_new_company_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own submissions"
  ON user_new_company_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- user_preferences: full access scoped to own user
CREATE POLICY "Users manage own preferences"
  ON user_preferences FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- 1D. Data migration
-- =============================================================================

-- Insert user_subscriptions from existing companies.user_id
INSERT INTO user_subscriptions (user_id, company_id)
SELECT DISTINCT user_id, id
FROM companies
WHERE user_id IS NOT NULL
ON CONFLICT (user_id, company_id) DO NOTHING;

-- Copy favorites into user_job_favorites (job_id → seen_job_id)
INSERT INTO user_job_favorites (user_id, seen_job_id)
SELECT user_id, job_id
FROM favorites
ON CONFLICT (user_id, seen_job_id) DO NOTHING;

-- Set subscriber_count based on actual subscription counts
UPDATE companies SET subscriber_count = sub.cnt
FROM (
  SELECT company_id, COUNT(*)::integer AS cnt
  FROM user_subscriptions
  GROUP BY company_id
) sub
WHERE companies.id = sub.company_id;

-- Ensure all companies are active
UPDATE companies SET is_active = true WHERE is_active = false;

-- =============================================================================
-- 1E. Duplicate identification query (review before merging)
-- Run this SELECT to identify duplicates. Do NOT auto-merge — review output first.
-- =============================================================================

-- SELECT
--   REGEXP_REPLACE(careers_url, '^https?://(www\.)?', '') AS domain_key,
--   ARRAY_AGG(name || ' (user: ' || user_id || ', jobs: ' || COALESCE(total_product_jobs, 0) || ', id: ' || id || ')') AS entries,
--   COUNT(*) AS duplicate_count
-- FROM companies
-- GROUP BY domain_key
-- HAVING COUNT(*) > 1
-- ORDER BY duplicate_count DESC;

-- =============================================================================
-- Verification queries (run after migration)
-- =============================================================================

-- Should match number of user-company pairs:
-- SELECT COUNT(*) AS subscription_count FROM user_subscriptions;

-- Should match old favorites count:
-- SELECT COUNT(*) AS new_favorites FROM user_job_favorites;
-- SELECT COUNT(*) AS old_favorites FROM favorites;

-- All companies should have subscriber_count > 0:
-- SELECT COUNT(*) AS zero_subs FROM companies WHERE subscriber_count = 0;
