# NewPMJobs Multi-User Overhaul Plan (Final)

## The Core Problem

The tool was built for a single user. Now multiple users exist and things are breaking:
- Duplicate companies in the scrape pool (Uber appears twice because two users added it independently)
- Daily emails contain duplicates because scraping is not user-aware
- No way to share the existing company catalog with new users
- No protection against adding the same company twice

---

## Architecture Shift: Shared Companies, Personal Subscriptions

Separate **companies** (shared resource) from **user subscriptions** (personal).

Netflix model: one shared catalog of companies. Each user has their own subscription list. Adding a company to your list doesn't create a new record. Removing it doesn't delete it for others.

### Current Model (broken)
```
User adds Uber -> creates new company record -> scraper scrapes it
Another user adds Uber -> creates ANOTHER company record -> scraper scrapes it AGAIN
```

### New Model
```
Company catalog exists (shared pool, one Uber entry)
User subscribes to Uber -> user_subscription row points to shared company
Another user subscribes -> their own user_subscription row points to SAME company
Scraper scrapes Uber ONCE -> all subscribers see results
```

---

## Confirmed Design Decisions

| Area | Decision |
|------|----------|
| Authentication | Magic link via Supabase Auth (already working, keep as-is) |
| User access | Open sign-up, anyone can create an account |
| Data visibility | Everyone sees all company data (roles, scrape status) regardless of subscriptions |
| Email preferences | Daily by default. Users can toggle to Weekly or Off in settings. |
| Security | Supabase RLS on all user-scoped tables + API-level checks |
| Rate limiting | No custom rate limiting. Supabase defaults are sufficient. |
| New company URL limit | 10 per user total. After 10: "Want more? Contact vik@viktoriousllc.com" |
| Admin user | Hardcoded: user.email === "vik@viktoriousllc.com". Bypasses URL submission limit. |
| System scrape pool cap | None. Self-limiting via natural usage patterns. |
| Account deletion | Not needed yet |
| Bug reporting | Email-based via Resend to vik@viktoriousllc.com. Future: Linear when volume justifies it. |
| Onboarding | First login (0 subscriptions) auto-opens the Add Company modal |
| Favoriting | Users subscribe to companies, favorite individual roles |
| Removed jobs returning | Re-notify users, treat as new job |
| Admin dashboard | Deferred to future phase |

---

## Database Schema Changes

### Existing tables (modify)

**companies** (becomes the shared catalog)
- Add: `is_active` (boolean, default true) -- whether any user is subscribed
- Add: `subscriber_count` (integer, default 0)
- Keep: id, name, careers_url, created_at, last_checked_at, last_check_status, total_product_jobs

**seen_jobs** (add status tracking)
- Add: `status` (text, default 'active') -- values: 'active', 'removed', 'archived'
- Add: `status_changed_at` (timestamp, nullable)
- Status meanings:
  - 'active' = currently on the company careers page
  - 'removed' = was on the page, company took it down (no longer found during scrape)
  - 'archived' = older than 60 days, cleaned up by retention job

### New tables

**user_subscriptions**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| user_id | uuid | FK to auth.users |
| company_id | uuid | FK to companies |
| created_at | timestamp | When user subscribed |
| UNIQUE(user_id, company_id) | | Prevents duplicate subscriptions |

**user_job_favorites**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| user_id | uuid | FK to auth.users |
| seen_job_id | uuid | FK to seen_jobs |
| created_at | timestamp | When favorited |
| UNIQUE(user_id, seen_job_id) | | Prevents duplicate favorites |

**user_new_company_submissions**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| user_id | uuid | FK to auth.users |
| company_id | uuid | FK to companies (the company created) |
| created_at | timestamp | When submitted |

Tracks how many new companies each user has added via URL. Used to enforce the 10-company limit.

**user_preferences**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| user_id | uuid | FK to auth.users, UNIQUE |
| email_frequency | text | 'daily' (default), 'weekly', 'off' |
| created_at | timestamp | |
| updated_at | timestamp | |

---

## Supabase Row-Level Security (RLS) Policies

Apply these policies to enforce data isolation at the database level. These are the safety net even if the API has bugs.

**user_subscriptions**
```sql
-- Users can only see their own subscriptions
CREATE POLICY "Users see own subscriptions" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Users can only create their own subscriptions
CREATE POLICY "Users create own subscriptions" ON user_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own subscriptions
CREATE POLICY "Users delete own subscriptions" ON user_subscriptions
  FOR DELETE USING (auth.uid() = user_id);
```

**user_job_favorites**
```sql
-- Same pattern as subscriptions
CREATE POLICY "Users see own favorites" ON user_job_favorites
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users create own favorites" ON user_job_favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own favorites" ON user_job_favorites
  FOR DELETE USING (auth.uid() = user_id);
```

**user_new_company_submissions**
```sql
CREATE POLICY "Users see own submissions" ON user_new_company_submissions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users create own submissions" ON user_new_company_submissions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
```

**user_preferences**
```sql
CREATE POLICY "Users see own preferences" ON user_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users manage own preferences" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);
```

**companies** (shared, everyone reads)
```sql
CREATE POLICY "Everyone can read companies" ON companies
  FOR SELECT USING (true);

-- Only authenticated users can insert (adding new companies via URL)
CREATE POLICY "Authenticated users can add companies" ON companies
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

**seen_jobs** (shared, everyone reads)
```sql
CREATE POLICY "Everyone can read jobs" ON seen_jobs
  FOR SELECT USING (true);
```

---

## Frontend Changes

### 1. Onboarding (First Login)

When a user logs in and has 0 rows in `user_subscriptions`:
- Auto-open the Add Company modal immediately
- Add a brief message at the top of the modal: "Pick the companies you want to track"
- Everything else works the same as the normal Add Company flow

Do NOT create a separate onboarding page. Reuse the existing modal.

Detection: after auth, query `user_subscriptions` count. If 0, open modal.

### 2. "Add Company" Flow (complete redesign)

**Path A: Select from existing catalog (primary, encouraged)**

When the user clicks "+ Add Company", show a modal with:
- Search bar at the top (filters as you type)
- List of ALL companies in the catalog (since data is visible to everyone), each row showing:
  - Company logo (existing favicon/logo)
  - Company name
  - Number of PM roles currently tracked
  - Checkbox on the right
- Companies the user already subscribes to: checked and grayed out with "(already added)" label
- "Add Selected" button at bottom, disabled until at least one new company is checked
- Selection counter: "3 of 21 selected" or similar

No limits on catalog subscriptions. Users can subscribe to every company if they want.

```
+-----------------------------------------------+
|  Pick the companies you want to track     [X]  |
|                                                 |
|  [Search companies...]                          |
|                                                 |
|  [x] Uber          45 roles      (already added)|
|  [ ] Netflix        35 roles                    |
|  [ ] Google         44 roles                    |
|  [ ] Stripe         33 roles                    |
|  [x] Airbnb         6 roles      (already added)|
|  [ ] Instacart      12 roles                    |
|  ...                                            |
|                                                 |
|  Don't see your company? Add a new one          |
|                                                 |
|  [Add 2 Selected Companies]                     |
+-----------------------------------------------+
```

**Path B: Add a new company (for companies not in catalog)**

Below the catalog list or as a tab:
- "Don't see your company?" link opens a URL input form
- User pastes a careers page URL
- System runs validation checks (see below)
- On success: company added to shared catalog + user subscribed
- On failure: specific error message

**10 per user total limit on Path B.**

Track in `user_new_company_submissions`. When a user hits 10:
- Disable the URL input
- Show: "You've reached the limit for adding new companies. Want more added? Contact us at vik@viktoriousllc.com and we'll get it set up for you."

Admin check (vik@viktoriousllc.com) bypasses this limit.

### 3. URL Validation (Path B only)

Run these checks in order when a user submits a URL:

**Check 1: Basic URL format**
- Must start with https://
- Must be a valid URL
- Error: "Please enter a valid URL starting with https://"

**Check 2: Is this a careers/jobs page?**
- URL path should contain: /careers, /jobs, /openings, /positions, /opportunities, /hiring
- OR domain is a known ATS: greenhouse.io, lever.co, workday.com, myworkdayjobs.com, icims.com, smartrecruiters.com, ashbyhq.com
- If neither: warning (not hard block): "This doesn't look like a careers page. Careers pages usually contain /careers or /jobs in the URL. Are you sure?"

**Check 3: Is this a specific job posting?**
- Look for patterns: /jobs/12345, /positions/abc-def, /job/product-manager-san-francisco
- If match: "This looks like a single job posting, not a careers page. We need the page that lists all jobs."
- Suggest the truncated URL as a clickable alternative

**Check 4: Is this company already in the catalog?**
- Extract root domain (e.g., uber.com from careers.uber.com/jobs)
- Check if any existing company has the same root domain
- If match: "Uber is already in our catalog! Would you like to subscribe to it instead?"
- Show button to subscribe to existing company

**Check 5: Does the page have jobs?**
- Attempt a test scrape (show spinner: "Checking page...")
- If 0 jobs: "We couldn't find any job listings on this page. Please check the URL and try again."
- If jobs found: "Found 45 jobs. Adding to your dashboard."

### 4. Duplicate Protection

Three layers:
- **UI:** Gray out already-subscribed companies in the modal
- **Frontend:** Check before API call, show "You're already tracking [Company]"
- **Database:** UNIQUE constraint on user_subscriptions(user_id, company_id)

### 5. Email Preferences (Settings)

Add a simple settings page or section accessible from the nav:
- Email frequency: Daily / Weekly / Off (radio buttons or dropdown)
- Default: Daily
- Stored in `user_preferences` table

### 6. Favoriting Individual Jobs

On the company detail view (clicking into a company card):
- Small heart or star icon next to each job title
- Click to toggle favorite, stored in `user_job_favorites`
- If a favorited job gets removed or archived:
  - Show in a "Saved Jobs" section with muted style
  - 'removed' -> "Listing removed"
  - 'archived' -> "Archived (60+ days)"
  - User can unfavorite to dismiss

### 7. Error Reporting

**Floating help button (bottom-right corner, always visible)**
- Opens form: dropdown (Bug / Missing Data / Other) + text area + submit
- Sends email to vik@viktoriousllc.com via Resend
- Auto-includes: user email, current page URL, timestamp

**Per-card error reporting**
- In card hover state or "..." overflow menu: "Report Issue"
- Pre-fills form with company name and current scrape status
- Same email destination

---

## Backend Changes

### 1. Scraper: Shared Scraping Pool

Query `companies WHERE is_active = true`. Each company scraped exactly once.

**Scrape flow:**
```
1. Get all active companies (is_active = true)
2. For each company:
   a. Scrape careers page
   b. Compare to existing seen_jobs WHERE status = 'active'
   c. New jobs (in scrape, not in DB) -> INSERT with status 'active'
   d. Missing jobs (in DB as 'active', not in scrape) -> UPDATE status to 'removed'
   e. Returned jobs (in DB as 'removed', found in scrape) -> UPDATE status to 'active', treat as new for notifications
3. CRITICAL: If scrape returns 0 jobs for a company that previously had jobs, treat as SCRAPE FAILURE.
   Do NOT mark jobs as removed. Log warning, skip status updates for this company.
4. After all scrapes, generate per-user emails
```

### 2. Email Generation (Per-User)

```
1. Get all users where email_frequency != 'off'
2. For daily users (or weekly users on their send day):
   a. Get their subscriptions from user_subscriptions
   b. For each subscribed company, get new jobs since last email
   c. Build personalized email with ONLY their companies
   d. Include company logo (same img URLs as dashboard)
   e. Send via Resend
3. Email content per company:
   - Company logo + name
   - Count of new jobs
   - List of new job titles with links
   - If scrape failed: "Could not check [Company] today"
4. If user has subscriptions but 0 new jobs across all: still send a brief "No new roles today" so they know the system is running
```

### 3. Data Retention (60-Day Rule)

Runs daily after scraping:

```sql
UPDATE seen_jobs
SET status = 'archived', status_changed_at = NOW()
WHERE first_seen_at < NOW() - INTERVAL '60 days'
AND status IN ('active', 'removed');
```

**UI impact:**
- Non-favorited archived/removed jobs: disappear from role counts silently
- Favorited archived/removed jobs: shown in "Saved Jobs" with muted labels

### 4. Job Status Transitions

```
active -> removed    (company took listing down)
active -> archived   (60 days passed)
removed -> active    (job reappeared; re-notify users as new)
removed -> archived  (60 days passed while removed)
```

### 5. Subscriber Count Management

**Subscribe:**
```sql
INSERT INTO user_subscriptions (user_id, company_id) VALUES (...);
UPDATE companies SET subscriber_count = subscriber_count + 1, is_active = true WHERE id = company_id;
```

**Unsubscribe:**
```sql
DELETE FROM user_subscriptions WHERE user_id = X AND company_id = Y;
UPDATE companies SET subscriber_count = subscriber_count - 1 WHERE id = company_id;
UPDATE companies SET is_active = false WHERE id = company_id AND subscriber_count = 0;
```

When `is_active = false`, scraper skips the company. If someone subscribes later, it flips back.

---

## Bug Fixes (include in this overhaul)

1. **Uber job duplication in email:** Root cause is two company records for Uber. Migration merges duplicates.
2. **Show logos in email:** Use same favicon/logo URLs from dashboard as img tags in Resend HTML.
3. **Prevent adding same company twice:** Three-layer protection (UI + frontend check + DB constraint).

---

## Migration Plan (execute in this order)

### Step 1: Database migration
- Add columns to `companies` (is_active, subscriber_count) and `seen_jobs` (status, status_changed_at)
- Create new tables: user_subscriptions, user_job_favorites, user_new_company_submissions, user_preferences
- Apply RLS policies to all new tables
- Migrate existing data:
  - For each company, create subscription for the user who added it
  - Merge duplicate companies (same domain):
    - Keep record with more seen_jobs
    - Reassign seen_jobs from duplicate to surviving record
    - Create subscriptions for all affected users pointing to surviving record
    - Delete duplicate
  - Set subscriber_count and is_active based on actual counts
  - Set all existing seen_jobs status to 'active'

### Step 2: Backend changes
- Update scraper to filter by is_active
- Update email job to generate per-user emails (respect email_frequency preference)
- Add 60-day retention cleanup job
- Add job status tracking (removed detection)
- Add admin bypass check for vik@viktoriousllc.com

### Step 3: Frontend changes
- Build Add Company checklist modal (Path A)
- Build Add New Company URL form (Path B) with 10-submission limit and validation
- Add onboarding: auto-open modal on first login (0 subscriptions)
- Add email preference toggle (Daily / Weekly / Off)
- Add job favoriting on company detail view
- Add duplicate protection (UI + API)
- Add error reporting (floating button + per-card)
- Update dashboard to show subscription-based data

### Step 4: Testing and cleanup
- Remove hardcoded single-user assumptions
- Test: multiple users subscribing to same company
- Test: per-user emails are correct (no duplicates, no cross-contamination)
- Test: duplicate company merge worked
- Test: 60-day retention job
- Test: RLS policies (User A cannot see/modify User B's data)
- Test: onboarding flow for new users
- Push to main, verify on prod

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| User adds company already in catalog via URL | Detect matching domain, offer to subscribe instead |
| User subscribes to same company twice | UNIQUE constraint blocks, show "Already tracking [Company]" |
| All users unsubscribe from a company | is_active = false, stop scraping, keep data |
| Someone resubscribes to inactive company | is_active = true, resume scraping next cycle |
| Job disappears from careers page | Status -> 'removed' |
| Job reappears after removal | Status -> 'active', re-notify as new |
| Job ages past 60 days | Status -> 'archived' by daily cleanup |
| User favorites a removed/archived job | Show in "Saved Jobs" with muted label |
| Scrape returns 0 for company with existing jobs | Treat as scrape failure, do NOT mark jobs removed |
| Two companies share domain, different paths | Allow both |
| User hits 10 URL submissions | Disable input, show "Contact vik@viktoriousllc.com" |
| Admin (vik@viktoriousllc.com) | Bypasses 10-company limit |
| New user first login | Auto-open Add Company modal |
| User sets email to 'off' | Skip them in daily/weekly email generation |

---

## Future Considerations (NOT in this phase)

- Admin dashboard (system health, user counts, scrape stats)
- Tiered limits (free vs paid users)
- Company verification queue (admin approves new URL submissions)
- Webhook/Slack/Discord notification options
- Account deletion and data export
- Linear integration for bug tracking
