# Backlog

## UI Polish
- [ ] **Star animation feedback** — When user stars a job, the star icon does a quick scale-up bounce + color fill animation (CSS transition, ~300ms). Provides instant visual confirmation without interrupting rapid multi-starring.

## Features
- [ ] **Share starred roles via link** — Generate a shareable URL (`/shared/<token>`) that shows a read-only list of the user's starred jobs (title, company, location, link to original posting). No login required for viewers. Live view (always reflects current stars). Implementation: `shared_lists` table (user_id, token, created_at), public GET endpoint, lightweight read-only page with "Copy link" button on starred page.

---

# Completed Tasks

# Job Level Classification + Levels.fyi Compensation Integration

## Phase 1: Job Level Classification + Filtering

### Code Complete (all compile clean)

- [x] **Step 1.1: Database column** — `ALTER TABLE seen_jobs ADD COLUMN job_level text` + index (SQL ready below)
- [x] **Step 1.2: Classification utility** — `backend/src/lib/classifyLevel.ts` with `classifyJobLevel()`
- [x] **Step 1.3: Classify on insert** — Added `job_level` to insert maps in `dailyCheck.ts`, `companies.ts`, `index.ts`
- [x] **Step 1.4: Backfill script** — `backend/src/scripts/backfillLevels.ts` to classify existing jobs
- [x] **Step 1.5: Shared frontend utility** — `frontend/src/lib/jobFilters.ts` (isUSLocation, level labels/colors)
- [x] **Step 1.6: Company detail page** — Level badges + filter checkboxes + comp section
- [x] **Step 1.7: All-jobs page** — Level column + badges + filters + sortable columns (starred) + salary toggle

### User Manual Steps Required (before deploy)

- [ ] **Run Phase 1 SQL** in Supabase SQL Editor:
  ```sql
  ALTER TABLE seen_jobs ADD COLUMN job_level text;
  CREATE INDEX idx_seen_jobs_level ON seen_jobs(job_level);
  ```

- [ ] **Run Phase 2 SQL** in Supabase SQL Editor:
  ```sql
  CREATE TABLE comp_cache (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_slug text NOT NULL UNIQUE,
    company_name text NOT NULL,
    data jsonb NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now()
  );

  ALTER TABLE companies ADD COLUMN levelsfyi_slug text;
  ```

### Post-Deploy Steps

- [ ] Push to main → auto-deploy
- [ ] Wait 90s for Railway + Vercel builds
- [ ] Run backfill script: `npx ts-node src/scripts/backfillLevels.ts` (on Railway or locally with .env)
- [ ] Verify: `SELECT job_level, COUNT(*) FROM seen_jobs GROUP BY job_level` — all three have rows
- [ ] Verify company detail page shows level badges (Early/Mid/Dir+) and filter checkboxes
- [ ] Verify all-jobs page shows Level column with colored badges
- [ ] Verify starred page has sortable columns and Show Salary toggle
- [ ] Verify compensation table appears on a known company (e.g., Google)
- [ ] Spot-check classification:
  - "Product Manager" → Early
  - "Senior Product Manager" → Mid
  - "Director of Product" → Dir+
  - "Group Product Manager" → Mid
  - "VP, Product" → Dir+

## Phase 2: Levels.fyi Compensation Data

### Code Complete (all compile clean)

- [x] **Step 2.1: Database tables** — `comp_cache` table + `levelsfyi_slug` column (SQL ready above)
- [x] **Step 2.2: Fetcher + parser** — `backend/src/lib/levelsFyi.ts` with HTML parsing + 24hr cache
- [x] **Step 2.3: Compensation API** — `backend/src/routes/compensation.ts` with single + batch endpoints
- [x] **Step 2.4: Company detail comp table** — Always-visible table with levels + "View on Levels.fyi" link
- [x] **Step 2.5: Starred page salary toggle** — Show Salary checkbox, sortable columns, salary ranges
- [x] **Build verification** — Backend + frontend TypeScript both compile clean

## Files Changed

| Action | File | Change |
|--------|------|--------|
| **New** | `backend/src/lib/classifyLevel.ts` | `classifyJobLevel()` utility |
| **New** | `backend/src/lib/levelsFyi.ts` | Levels.fyi fetcher, parser, cache |
| **New** | `backend/src/routes/compensation.ts` | `/api/compensation` endpoints |
| **New** | `backend/src/scripts/backfillLevels.ts` | Backfill existing jobs with levels |
| **New** | `frontend/src/lib/jobFilters.ts` | Shared `isUSLocation()`, level labels/colors |
| Modify | `backend/src/jobs/dailyCheck.ts` | Added `job_level` to insert map |
| Modify | `backend/src/routes/companies.ts` | Added `job_level` to initial scrape insert |
| Modify | `backend/src/index.ts` | Added `classifyJobLevel` import + compensation route |
| Modify | `frontend/src/app/company/[id]/page.tsx` | Level badges + filters + comp table |
| Modify | `frontend/src/app/jobs/page.tsx` | Level column + badges + filters + salary + sorting |
