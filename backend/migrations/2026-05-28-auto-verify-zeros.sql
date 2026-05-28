-- Auto-verify zero PMs: silence the daily admin digest's "Unverified zeros"
-- section by tracking consecutive zero days per company. The cron in
-- dailyCheck.ts uses this counter to:
--   * auto-set is_verified_zero=true after 7 days of zero from a previously-
--     verified scraper (we trust the scraper, the zero is real)
--   * auto-set auto_disabled=true after 14 days of zero from a never-verified
--     scraper (scraper might be broken from day one; stop wasting cron cycles)
--   * auto-flip is_verified_zero back to false the moment >0 PMs reappear
--     (data accuracy: don't silently mask a re-activated hiring company)
--
-- Bootstrap: every currently-zero company whose scraper has worked before
-- (is_verified=true) gets auto-confirmed immediately. The dailyCheck auto-
-- flip-back logic keeps the data accurate if those companies start hiring
-- again, so this is safe.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS consecutive_zero_days INTEGER NOT NULL DEFAULT 0;

UPDATE companies
SET is_verified_zero = TRUE
WHERE total_product_jobs = 0
  AND is_verified = TRUE
  AND is_verified_zero = FALSE
  AND (auto_disabled IS NULL OR auto_disabled = FALSE);
