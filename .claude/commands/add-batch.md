---
description: Daisy-chain a batch catalog add: research → detect → bulk-add → simulate-yield → auto-flip is_verified_zero. Usage: /add-batch <category> (e.g. "/add-batch 15 series-B fintech in SF").
---

# /add-batch — Batch catalog addition with post-add yield verification

The user invoked `/add-batch $ARGUMENTS`. Walk through the four phases below in order. Stop at any checkpoint where the user must approve before proceeding.

## Phase 1 — Research (catalog-scout, discovery mode)

Spawn the `catalog-scout` agent with the category from `$ARGUMENTS`. It returns a JSONL block of candidates with detected ATS info.

Show the user the JSONL + Verification notes + Manual review section. **Ask for explicit "go" before proceeding to Phase 2.** If the user says "drop X and Y" or "only the top 5", trim the list before continuing.

## Phase 2 — Bulk add (deterministic)

Apply the approved JSONL to the production database using the Supabase MCP. For each row:

1. Check if the company already exists (`SELECT id, name FROM companies WHERE careers_url = '...' OR name ILIKE '...'`). Skip if found and report to user.
2. INSERT with `is_verified=false`, `is_verified_zero=false`, `subscriber_count=0`, `is_active=false`, the JSONL's `platform_type` and `platform_config`. Use a single batched INSERT if possible.
3. Capture the new company UUIDs for Phase 3.

If the user has a local `backend/src/scripts/bulk-add-companies.js` they prefer to run instead, defer to that — but you should know how to apply directly via MCP when the script isn't there.

Report inserted/skipped counts before continuing.

## Phase 3 — Simulate-yield (catalog-scout, simulate-yield mode)

Spawn `catalog-scout` again with a prompt that begins with `MODE: simulate-yield` followed by the just-added JSONL (now with company UUIDs). See `catalog-scout.md` for the agent-side procedure.

The agent returns a table per company plus two grouped lists:
- `Recommended is_verified_zero updates` — structural zeros (scraper works, no US PM yield possible)
- `Manual recheck recommended` — couldn't verify, let cron decide

Show the user the table. **Ask for approval before flipping any DB flags** — the agent's verdict is a recommendation, not a directive.

## Phase 4 — Apply is_verified_zero flips

For each company in the user-approved `is_verified_zero` list, run via Supabase MCP:

```sql
UPDATE companies SET is_verified_zero = true WHERE id = '<uuid>';
```

For the "manual recheck" list, do nothing — they'll appear in tomorrow's admin digest as unverified zeros (if 0-yield) or auto-resolve when the cron sees real jobs (via the `is_verified` one-way ratchet in `dailyCheck.ts`).

## Closing summary

Report:
- N companies researched, M added, K skipped (already in catalog)
- For added companies: P with confirmed yield, Q marked `is_verified_zero=true`, R deferred to next cron
- Reminder: first real scrape happens at next 14:00 UTC cron. Monitor tomorrow's admin digest for any unexpected results.

## Failure modes / when to stop

- **Catalog-scout can't fetch a careers URL during Phase 3**: report it, move on. Don't fail the whole batch.
- **Bulk-insert fails on a single row** (constraint violation, dedup match): log and continue with the rest.
- **User says "this batch looks wrong" at any checkpoint**: stop immediately. Don't apply DB changes.
- **More than 50 candidates in Phase 1**: ask the user to confirm before continuing — that's a big batch.
- **Hostname overlap with CUSTOM_SCRAPER_HOSTS**: catalog-scout should have caught this in Phase 1. If you spot it here, flag and skip the row.

## Out of scope for this command

- Do NOT update SCRAPER.md, ROUTES.md, or other sidecars. Those describe code behavior, not catalog membership.
- Do NOT open PRs. This is a pure DB operation against the live catalog.
- Do NOT trigger a manual cron run. The next scheduled 14:00 UTC run will pick up the new rows naturally.
