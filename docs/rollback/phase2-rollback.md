# Phase 2 Rollback

Phase 2 only adds new routes and minor modifications. No SQL changes.

## Steps to rollback

1. **Revert code changes:**
   - Remove `backend/src/routes/subscriptions.ts`
   - Remove `backend/src/routes/catalog.ts`
   - Remove `backend/src/routes/preferences.ts`
   - In `backend/src/index.ts`: remove imports and `app.use` lines for subscriptions, catalog, preferences
   - In `backend/src/middleware/auth.ts`: remove `userEmail` from Request type and both assignment lines
   - In `backend/src/routes/companies.ts` (POST): remove submission limit check, subscription insert, and submission record insert

2. **Deploy:** `git push origin main` to trigger Railway auto-deploy

No database changes need to be reverted — the new tables from Phase 1 can stay even if Phase 2 code is rolled back.
