-- Fix Eli Lilly platform_config.baseDomain: add missing https:// prefix.
--
-- Root cause: the Phenom scraper validates baseDomain against
-- ^https://[a-z0-9.-]+\.[a-z]{2,}$ and throws (blocking self-healing) when
-- the scheme is absent. careers.lilly.com is a confirmed live Phenom instance
-- (200 OK, phApp.ddo present, 348 totalHits for "product manager").
--
-- careers.lilly.com was added to CUSTOM_SCRAPER_HOSTS to prevent broadATSDiscovery
-- from overwriting this config on future 0-result runs.

UPDATE companies
SET
  platform_type   = 'phenom',
  platform_config = jsonb_set(
    COALESCE(platform_config, '{}'::jsonb),
    '{baseDomain}',
    '"https://careers.lilly.com"'
  ),
  consecutive_failure_count = 0,
  auto_disabled             = false,
  last_check_status         = 'pending recheck after config fix'
WHERE name = 'Eli Lilly';
