-- Applied via Supabase MCP on 2026-05-19.
-- Adds the industry column to companies and a partial index for the
-- recommendation query path. 10-bucket taxonomy: banking, biotech,
-- consulting, consumer, fintech, gaming, hardware, healthcare, media, tech
-- (catch-all for AI/big-tech/dev-tools/e-commerce/SaaS/productivity).

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS industry text;

CREATE INDEX IF NOT EXISTS idx_companies_industry
  ON companies (industry)
  WHERE industry IS NOT NULL;

COMMENT ON COLUMN companies.industry IS
  'One of: banking, biotech, consulting, consumer, fintech, gaming, hardware, healthcare, media, tech. NULL until classified.';

-- Backfill of all 243 catalog companies was applied in the same MCP session.
-- Distribution: tech=100, fintech=37, biotech=23, hardware=20, consumer=16,
-- gaming=14, media=14, banking=10, consulting=6, healthcare=3.
