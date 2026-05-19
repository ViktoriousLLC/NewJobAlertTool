# Routes Subsystem — READ BEFORE EDITING

This sidecar collects everything needed before touching `backend/src/routes/*.ts`. CLAUDE.md keeps the API endpoint table for top-level navigation.

## Data Isolation (mandatory pattern)

Every read endpoint on user-scoped or subscription-gated data MUST check the requester's subscription before returning.

**Pattern:** load `user_subscriptions` for `req.userId`, return 403 if target not in list.

**Applies to:**
- `GET /api/companies/:id`
- `POST /api/favorites/:jobId`
- `POST /api/issues`
- Any new endpoint accepting a `company_id` or `seen_job_id` path param

**Rule:** Never trust client-supplied `user_id`; always derive from JWT.

## Body Limits

- Global: `express.json({ limit: "256kb" })`
- `/api/help.message` ≤ 5000 chars
- `/api/issues.description` ≤ 5000 chars

## Companies CRUD Specifics

- **Dedup on URL domain**, not name. ATS URLs use `hostname/slug` key (e.g., `greenhouse.io/discord`).
- **`platform_type` and `platform_config` are NEVER trusted from client body** in `POST /api/companies`. Always re-detect server-side. Trusting them = SSRF amplification (auth user injects arbitrary `baseUrl` that daily cron then dereferences). Fixed in PR #16.
- **Pre-checked `jobs` array** from `/check` IS trusted (user already saw and confirmed those).
- **10/user submission limit** in `POST /api/companies` (admin bypass). Rate limit via `user_new_company_submissions` table.

## Check-Then-Add Flow

States: `input` → `checking` → `preview` → `retry`

1. User enters URL only (name auto-detected via `detectCompanyName`)
2. `POST /api/companies/check` scrapes without saving → returns preview with `detection_method` + `confidence` fields
3. User confirms → `POST /api/companies` with pre-checked jobs (skips re-scrape; platform info re-detected server-side)
4. "No, Try Again" → retry with feedback → "Cancel" files feedback via `/api/help`
5. URL match → offers to subscribe to existing company

## Admin Endpoints

- `GET /api/admin/*` requires `req.userEmail === ADMIN_EMAIL`.
- `ADMIN_EMAIL` from env var with hardcoded fallback in `lib/constants.ts`.
- Admin hard-delete: `DELETE /api/companies/{id}?hard=true` → CASCADE deletes jobs, subscriptions, etc.

## Delete Semantics

- **Dashboard "Remove"** = unsubscribe only. Updates `subscriber_count` and `is_active`.
- **Companies with 0 subscribers** stay in catalog, keep getting scraped.
- **Admin hard-delete** is the only true delete path.

## Endpoints (full reference)

All routes require `Authorization: Bearer <token>` unless noted.

```
# Companies (user-scoped via subscriptions)
GET    /api/companies                    — User's subscribed companies
GET    /api/companies/{id}               — Company + jobs + next_company
POST   /api/companies/check              — Preview scrape (no DB write). Body: {careers_url, feedback?}
POST   /api/companies                    — Add company (auto-subscribe, 10/user limit). Body: {name, careers_url, jobs?}
DELETE /api/companies/{id}               — Unsubscribe only. Admin: ?hard=true deletes from catalog.

# Catalog / Subscriptions
GET    /api/catalog                      — All companies (no user filter)
GET    /api/subscriptions                — User's subscribed company IDs
POST   /api/subscriptions                — Subscribe. Body: {company_ids: []}
DELETE /api/subscriptions/{companyId}    — Unsubscribe

# Jobs / Favorites
GET    /api/jobs                         — Active jobs across subscribed companies
GET    /api/favorites                    — User's favorited job IDs
POST   /api/favorites/{jobId}            — Star a job
DELETE /api/favorites/{jobId}            — Unstar

# Preferences / Help / Issues
GET    /api/preferences                  — Get email prefs (creates default if none)
PUT    /api/preferences                  — Body: {email_frequency: "daily|weekly|off"}
POST   /api/help                         — Feedback email + DB. Body: {issue_type, message, page_url}
POST   /api/issues                       — Scrape issue. Body: {company_id, issue_type, description}

# Compensation (levels.fyi, 3-tier cache: memory 1hr → DB 24hr → live fetch)
GET    /api/compensation                 — Batch comp for subscribed companies
GET    /api/compensation/{companyName}   — Single company comp

# Admin (requires ADMIN_EMAIL match)
GET    /api/admin/stats                  — Users, companies, jobs, errors
GET    /api/admin/issues                 — Scrape issues + help submissions
GET    /api/admin/companies              — All companies for management (with hard-delete)
GET    /api/admin/users                  — User list + subs + email prefs

# Cron (requires Authorization: Bearer <CRON_SECRET>)
GET    /api/cron/trigger                 — Must await runDailyCheck() — Railway kills idle processes
         Optional: ?skipEmails=true      — Skips per-user alerts (for safe manual re-runs)
         Optional: ?forceMondayDigest=true — Forces the Monday digest on any day
```

## Input Validation

- UUID regex on all path-param IDs (`UUID_REGEX` in `companies.ts`).
- HTTPS-only careers URLs.
- LinkedIn URLs blocked.
- SSRF protection: no private IPs (`10.x`, `192.168.x`, `172.16-31.x`, `127.x`, `0.0.0.0`, `[::1]`, `.internal`, `.local`).

## Gotchas

- **Duplicate companies**: Dedup by URL domain, not name. ATS URLs use `hostname/slug` key.
- **Salesforce trap**: `careers.salesforce.com` redirects to marketing page. Use Workday URL directly: `salesforce.wd12.myworkdayjobs.com/External_Career_Site`.
- **Test account**: Gmail + alias. Reset: `scripts/reset-test-user.sql`.
