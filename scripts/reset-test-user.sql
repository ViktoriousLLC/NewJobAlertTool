-- Reset test user: test-account@example.com
-- Run this in Supabase SQL Editor to wipe test user data for fresh onboarding.
-- Does NOT delete auth.users row — user can re-login immediately and see onboarding.

DO $$
DECLARE
  test_uid uuid;
BEGIN
  -- Find the test user's ID
  SELECT id INTO test_uid
  FROM auth.users
  WHERE email = 'test-account@example.com';

  IF test_uid IS NULL THEN
    RAISE NOTICE 'Test user not found — nothing to reset';
    RETURN;
  END IF;

  RAISE NOTICE 'Resetting test user: %', test_uid;

  -- Delete subscriptions (will affect subscriber_count below)
  DELETE FROM user_subscriptions WHERE user_id = test_uid;

  -- Delete favorites
  DELETE FROM user_job_favorites WHERE user_id = test_uid;

  -- Delete preferences (will be re-created with defaults on next login)
  DELETE FROM user_preferences WHERE user_id = test_uid;

  -- Delete company submissions
  DELETE FROM user_new_company_submissions WHERE user_id = test_uid;

  -- Delete scrape issues
  DELETE FROM scrape_issues WHERE user_id = test_uid;

  -- Delete help submissions (if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'help_submissions') THEN
    EXECUTE 'DELETE FROM help_submissions WHERE user_id = $1' USING test_uid;
  END IF;

  -- Recalculate subscriber_count for all companies
  UPDATE companies c
  SET subscriber_count = (
    SELECT COUNT(*) FROM user_subscriptions s WHERE s.company_id = c.id
  ),
  is_active = (
    SELECT COUNT(*) > 0 FROM user_subscriptions s WHERE s.company_id = c.id
  );

  RAISE NOTICE 'Test user reset complete. User can re-login for fresh onboarding.';
END $$;
