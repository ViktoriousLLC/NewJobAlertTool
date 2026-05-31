-- Audit close-out: enable RLS on weekly_lead_history.
--
-- This table was created (2026-05-30-weekly-lead-history.sql) WITHOUT row level
-- security, on the rationale that it's backend-only (written/read by the
-- service-role key inside the cron). But "no RLS" on a Supabase table means the
-- anon/authenticated API keys CAN read it via PostgREST — it was anon-readable.
-- A Supabase advisor flagged it. The contents are harmless (rotation
-- bookkeeping, no PII), but the standing rule is every table has RLS ON, so we
-- close the drift here. The service-role key the cron uses bypasses RLS, so
-- enabling it with no policies (deny-all to anon/auth) does not change the
-- cron's behavior.
--
-- NOTE: this statement was ALREADY applied to prod live via the Supabase MCP;
-- this file exists so the repo matches prod and a from-scratch rebuild is correct.

alter table weekly_lead_history enable row level security;
