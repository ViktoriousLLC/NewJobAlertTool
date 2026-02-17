-- =============================================================================
-- Phase 3: RLS + Schema Migration
-- Run AFTER Phase 3 backend code is deployed and verified
-- =============================================================================

-- PRE-DEPLOY GATE: Run this FIRST. Must return 0 rows.
-- If any rows appear, those users will lose access to those companies.
-- SELECT c.user_id, c.id AS company_id, c.name
-- FROM companies c
-- LEFT JOIN user_subscriptions us ON us.user_id = c.user_id AND us.company_id = c.id
-- WHERE c.user_id IS NOT NULL AND us.id IS NULL;

-- Drop old user-scoped RLS policies on companies
DROP POLICY IF EXISTS "Users see own companies" ON companies;
DROP POLICY IF EXISTS "Users insert own companies" ON companies;
DROP POLICY IF EXISTS "Users update own companies" ON companies;
DROP POLICY IF EXISTS "Users delete own companies" ON companies;

-- Drop old job scoping policy
DROP POLICY IF EXISTS "Users see own jobs" ON seen_jobs;

-- New shared-read policies
CREATE POLICY "Everyone can read companies"
  ON companies FOR SELECT USING (true);

CREATE POLICY "Authenticated users can add companies"
  ON companies FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Everyone can read jobs"
  ON seen_jobs FOR SELECT USING (true);

-- Make user_id nullable (no longer primary scoping mechanism)
ALTER TABLE companies ALTER COLUMN user_id DROP NOT NULL;
