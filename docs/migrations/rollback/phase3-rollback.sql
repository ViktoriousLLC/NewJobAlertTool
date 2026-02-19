-- =============================================================================
-- Phase 3 Rollback: Restore old RLS policies and user_id NOT NULL
-- =============================================================================

-- Drop new shared policies
DROP POLICY IF EXISTS "Everyone can read companies" ON companies;
DROP POLICY IF EXISTS "Authenticated users can add companies" ON companies;
DROP POLICY IF EXISTS "Everyone can read jobs" ON seen_jobs;

-- Restore old user-scoped policies
CREATE POLICY "Users see own companies"
  ON companies FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own companies"
  ON companies FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own companies"
  ON companies FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own companies"
  ON companies FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users see own jobs"
  ON seen_jobs FOR SELECT USING (
    EXISTS (SELECT 1 FROM companies WHERE companies.id = seen_jobs.company_id AND companies.user_id = auth.uid())
  );

-- Restore NOT NULL on user_id (ensure no NULLs first!)
-- UPDATE companies SET user_id = '<fallback_user_id>' WHERE user_id IS NULL;
ALTER TABLE companies ALTER COLUMN user_id SET NOT NULL;
