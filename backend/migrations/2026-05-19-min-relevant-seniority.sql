-- Applied via Supabase MCP on 2026-05-19.
-- Per-company seniority floor for the daily alert + recommendation logic.
-- Solves the FAANG calibration issue: at Google, "Product Manager" is the
-- junior IC title; the user only wants GPM+. Setting min_relevant_seniority
-- to 'mid' filters out junior PMs from that company's daily emails (the
-- jobs still land in seen_jobs and the public feed, just not in alerts).
--
-- Values: NULL (show all, default) | 'early' (same as NULL) | 'mid' |
-- 'director'. Maps to seen_jobs.job_level (early|mid|director).
-- Jobs with no detected level pass through every threshold — better to
-- over-show than to over-filter on classification misses.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS min_relevant_seniority text;

COMMENT ON COLUMN companies.min_relevant_seniority IS
  'NULL = show all PM jobs from this company. mid = skip early/junior. director = only show director+. Override per-company to fix the FAANG calibration issue where "PM" means junior IC.';

-- Initial backfill: FAANG-tier brands where "Product Manager" is the
-- junior IC title. Conservative — admin can extend later via UPDATE.
UPDATE companies SET min_relevant_seniority = 'mid'
  WHERE name IN (
    'Google', 'Meta', 'Apple', 'Amazon', 'Microsoft', 'Netflix',
    'LinkedIn', 'Salesforce', 'Adobe', 'NVIDIA', 'Oracle'
  );

-- Tuning later:
--   UPDATE companies SET min_relevant_seniority = 'mid' WHERE name = 'X';
--   UPDATE companies SET min_relevant_seniority = 'director' WHERE name = 'Y';
--   UPDATE companies SET min_relevant_seniority = NULL WHERE name = 'Z';
