# Migrations

DB migrations are applied via the Supabase MCP (`apply_migration` tool), not by a migration framework. Files in this folder are kept for change-tracking purposes only — they record what was applied and when.

**Convention:** `YYYY-MM-DD-short-slug.sql`

When you apply a migration via MCP, also commit the SQL here so the repo has an auditable record. Supabase's own migration history is the source of truth; this folder is the human-readable mirror.
