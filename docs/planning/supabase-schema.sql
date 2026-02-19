-- Job Alert Tool - Supabase Schema (Multi-User)
-- Run this in the Supabase SQL Editor

-- =============================================================================
-- Companies table (shared catalog)
-- =============================================================================
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  careers_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  last_check_status text DEFAULT 'pending',
  total_product_jobs int DEFAULT 0,
  user_id uuid REFERENCES auth.users(id),  -- legacy: original creator (nullable)
  platform_type text,
  platform_config jsonb DEFAULT '{}',
  levelsfyi_slug text,
  is_active boolean NOT NULL DEFAULT true,
  subscriber_count integer NOT NULL DEFAULT 0
);

-- =============================================================================
-- Seen jobs table
-- =============================================================================
CREATE TABLE seen_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_url_path text NOT NULL,
  job_title text NOT NULL,
  job_location text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  is_baseline boolean NOT NULL DEFAULT false,
  job_level text,
  status text NOT NULL DEFAULT 'active',
  status_changed_at timestamptz
);

CREATE UNIQUE INDEX idx_seen_jobs_company_url ON seen_jobs(company_id, job_url_path);
CREATE INDEX idx_seen_jobs_first_seen ON seen_jobs(first_seen_at);
CREATE INDEX idx_seen_jobs_job_level ON seen_jobs(job_level);
CREATE INDEX idx_seen_jobs_company_baseline ON seen_jobs(company_id, is_baseline, first_seen_at);
CREATE INDEX idx_seen_jobs_status ON seen_jobs(status);

-- =============================================================================
-- User subscriptions (links users to companies they track)
-- =============================================================================
CREATE TABLE user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_user_subscriptions_unique ON user_subscriptions(user_id, company_id);
CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_company_id ON user_subscriptions(company_id);

-- =============================================================================
-- User job favorites
-- =============================================================================
CREATE TABLE user_job_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  seen_job_id uuid NOT NULL REFERENCES seen_jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_user_job_favorites_unique ON user_job_favorites(user_id, seen_job_id);
CREATE INDEX idx_user_job_favorites_user_id ON user_job_favorites(user_id);

-- =============================================================================
-- User new company submissions (rate limiting)
-- =============================================================================
CREATE TABLE user_new_company_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_new_company_submissions_user_id ON user_new_company_submissions(user_id);

-- =============================================================================
-- User preferences
-- =============================================================================
CREATE TABLE user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) UNIQUE,
  email_frequency text NOT NULL DEFAULT 'daily',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Scrape issue reporting
-- =============================================================================
CREATE TABLE scrape_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  issue_type text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- =============================================================================
-- Compensation cache
-- =============================================================================
CREATE TABLE comp_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_slug text UNIQUE NOT NULL,
  company_name text,
  data jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- RLS Policies
-- =============================================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE seen_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_job_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_new_company_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_issues ENABLE ROW LEVEL SECURITY;

-- Companies: shared read, authenticated insert
CREATE POLICY "Everyone can read companies" ON companies FOR SELECT USING (true);
CREATE POLICY "Authenticated users can add companies" ON companies FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Seen jobs: shared read
CREATE POLICY "Everyone can read jobs" ON seen_jobs FOR SELECT USING (true);

-- User subscriptions: scoped to own user
CREATE POLICY "Users see own subscriptions" ON user_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own subscriptions" ON user_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own subscriptions" ON user_subscriptions FOR DELETE USING (auth.uid() = user_id);

-- User job favorites: scoped to own user
CREATE POLICY "Users see own job favorites" ON user_job_favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own job favorites" ON user_job_favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own job favorites" ON user_job_favorites FOR DELETE USING (auth.uid() = user_id);

-- User new company submissions: scoped to own user
CREATE POLICY "Users see own submissions" ON user_new_company_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own submissions" ON user_new_company_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- User preferences: full access scoped to own user
CREATE POLICY "Users manage own preferences" ON user_preferences FOR ALL USING (auth.uid() = user_id);

-- Scrape issues: scoped to own user
CREATE POLICY "Users can insert their own issues" ON scrape_issues FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own issues" ON scrape_issues FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- RPC function for dashboard stats
-- =============================================================================
CREATE OR REPLACE FUNCTION get_company_job_stats(company_ids uuid[])
RETURNS TABLE (
  company_id uuid,
  new_jobs_today bigint,
  latest_new_job_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    sj.company_id,
    COUNT(*) FILTER (WHERE sj.first_seen_at >= CURRENT_DATE) AS new_jobs_today,
    MAX(sj.first_seen_at) AS latest_new_job_at
  FROM seen_jobs sj
  WHERE sj.company_id = ANY(company_ids)
    AND sj.is_baseline = false
    AND sj.status = 'active'
  GROUP BY sj.company_id;
$$;
