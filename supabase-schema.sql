-- Job Alert Tool - Supabase Schema
-- Run this in the Supabase SQL Editor

-- Companies table
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  careers_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  last_check_status text DEFAULT 'pending',
  total_product_jobs int DEFAULT 0,
  user_id uuid NOT NULL REFERENCES auth.users(id)
);

CREATE INDEX idx_companies_user_id ON companies(user_id);

-- Seen jobs table
CREATE TABLE seen_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_url_path text NOT NULL,
  job_title text NOT NULL,
  job_location text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  is_baseline boolean NOT NULL DEFAULT false
);

-- Unique index: one entry per job URL per company
CREATE UNIQUE INDEX idx_seen_jobs_company_url ON seen_jobs(company_id, job_url_path);

-- Index for querying recent jobs
CREATE INDEX idx_seen_jobs_first_seen ON seen_jobs(first_seen_at);

-- Favorites table (per-user starring)
CREATE TABLE favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES seen_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_favorites_user_job ON favorites(user_id, job_id);
CREATE INDEX idx_favorites_user_id ON favorites(user_id);

-- Enable RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE seen_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- Companies: users see/manage their own
CREATE POLICY "Users see own companies" ON companies FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own companies" ON companies FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own companies" ON companies FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own companies" ON companies FOR DELETE USING (auth.uid() = user_id);

-- Seen jobs: scoped through company's user_id
CREATE POLICY "Users see own jobs" ON seen_jobs FOR SELECT USING (
  EXISTS (SELECT 1 FROM companies WHERE companies.id = seen_jobs.company_id AND companies.user_id = auth.uid())
);

-- Favorites: users see/manage their own
CREATE POLICY "Users see own favorites" ON favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own favorites" ON favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own favorites" ON favorites FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- Migration: Platform detection + scrape issues (run as ALTER on existing DB)
-- =============================================================================

-- Add platform detection columns to companies
ALTER TABLE companies
  ADD COLUMN platform_type text,
  ADD COLUMN platform_config jsonb DEFAULT '{}';

-- Scrape issue reporting table
CREATE TABLE scrape_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  issue_type text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE scrape_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert their own issues"
  ON scrape_issues FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own issues"
  ON scrape_issues FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- Migration: Dashboard job stats RPC function (performance optimization)
-- =============================================================================

-- Single aggregation query replaces 2 sequential queries on dashboard load
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
  GROUP BY sj.company_id;
$$;
