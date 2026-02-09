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
  total_product_jobs int DEFAULT 0
);

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

-- Enable RLS (open policies for V1 - no auth)
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE seen_jobs ENABLE ROW LEVEL SECURITY;

-- Open policies (allow all operations without auth for V1)
CREATE POLICY "Allow all on companies" ON companies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on seen_jobs" ON seen_jobs FOR ALL USING (true) WITH CHECK (true);

-- Favorites table (for starring jobs)
CREATE TABLE favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES seen_jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_favorites_job_id ON favorites(job_id);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on favorites" ON favorites FOR ALL USING (true) WITH CHECK (true);
