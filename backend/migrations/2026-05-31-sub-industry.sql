-- Adds a finer-grained sub_industry column under the existing `industry` taxonomy.
-- Purpose: split the broad `tech` bucket into shoppable sub-categories in the
-- Add-Companies catalog (AI, Dev Tools, SaaS, Big Tech, Security, Consumer apps).
--
-- Scope of THIS migration: schema only. It does NOT backfill any values — the
-- data tagging is a separate task. Until tagged, sub_industry is NULL and the
-- catalog UI falls back to a single "Tech" group for tech companies.
--
-- Backward compatible: nullable, no default, so every existing/new company is
-- unaffected. Only meaningful for companies whose `industry` = 'tech' (other
-- industries group by `industry` directly and ignore this column).
--
-- Expected values when tagged (free-text, validated/normalized in app code, not
-- by a DB constraint, to stay flexible while the taxonomy settles):
--   ai, dev-tools, saas, big-tech, security, consumer-apps

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS sub_industry text;

CREATE INDEX IF NOT EXISTS idx_companies_sub_industry
  ON companies (sub_industry)
  WHERE sub_industry IS NOT NULL;

COMMENT ON COLUMN companies.sub_industry IS
  'Finer-grained category under industry, used to split the tech bucket in the catalog UI (ai, dev-tools, saas, big-tech, security, consumer-apps). NULL until tagged; tech companies with NULL fall back to a single "Tech" group.';
