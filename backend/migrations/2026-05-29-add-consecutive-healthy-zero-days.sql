-- 2026-05-29: anti-flap buffer for stale "zombie" job removal.
--
-- Adds a per-company counter for consecutive days where the job SOURCE was healthy
-- (returned listings, scrapeStats.totalScanned > 0) but yielded 0 PM roles. The daily
-- cron uses it to remove now-stale active rows after STALE_REMOVAL_BUFFER_DAYS (2)
-- such days, instead of preserving them forever.
--
-- Why a new column rather than reusing consecutive_zero_days: that column tracks the
-- post-removal active-count streak and feeds the is_verified_zero / auto-disable
-- self-heal (PR #90). For companies whose delisted jobs were preserved as "active",
-- the active count never hit 0, so consecutive_zero_days stayed pinned at 0 and the
-- self-heal could never fire. This column measures the honest "healthy source, no PMs"
-- signal and is read/written ONLY by the removal-buffer logic in dailyCheck.ts. Once
-- the buffer elapses and the stale rows are removed, the active count drops to 0 and
-- the existing consecutive_zero_days logic resumes normally.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS consecutive_healthy_zero_days INTEGER NOT NULL DEFAULT 0;
