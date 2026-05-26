# .github/ci

CI helper scripts invoked from GitHub Actions workflows. Lives under `.github/` because the repo policy gitignores any `scripts/` directory anywhere in the tree (including `.github/scripts/`).

## check-auth-templates.mjs

Tier 1 of DEV-12 [CI auth smoke test]. Asserts that the deployed Supabase Auth email templates use the URL format documented in `backend/src/middleware/AUTH.md`.

**Triggered by:**
- `.github/workflows/auth-template-check.yml`
- Runs on PRs that touch auth-adjacent paths
- Runs nightly at 15:05 UTC to catch manual Supabase Dashboard edits

**Requires (set as GitHub repo secret):**
- `SUPABASE_PAT_CI` — Supabase Personal Access Token. Generate at https://supabase.com/dashboard/account/tokens. Auth read scope is sufficient.

**Local run** (for debugging):
```bash
SUPABASE_PAT=sbp_xxx SUPABASE_PROJECT_ID=lrmxjqijaenyzdjjzmmo node .github/ci/check-auth-templates.mjs
```

**Origin:** built after the 2026-05-22 to 2026-05-25 auth incident where deployed templates used Supabase's default `{{ .ConfirmationURL }}` variable instead of the documented `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...` format. 18 users were locked out for 2 days. This check exists so that regression can't recur.
