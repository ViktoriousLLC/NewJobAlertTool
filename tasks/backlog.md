# Backlog

## UI / UX
- [x] Add Home button to top nav ribbon
- [x] Sign Out should be a proper button (not just text)
- [x] Rename app from "Vik's New Job Tool" to "New PM Jobs" (or similar)
- [x] Design a better logo for the site (PM square logo)
- [x] Customize magic link email template (template created in tasks/magic-link-email-template.html)

## Priority: Do Next
- [x] Apply magic link email template to Supabase — pasted into Dashboard → Auth → Email Templates → Magic Link (completed 2026-02-11)
- [x] UI redesign — dark navy nav, branded company cards with favicons, Outfit font, sky blue palette, stat boxes, filter bar, responsive grid (completed 2026-02-11)

## Priority: High
- [x] PostHog analytics — pageviews, user identity, company_added/deleted, job_starred/unstarred, dashboard_filter (completed 2026-02-11)
- [x] Sentry error monitoring — frontend (@sentry/nextjs) + backend (@sentry/node), auto-captures exceptions (completed 2026-02-11)
- [x] Uptime monitoring — add `https://api.newpmjobs.com/api/health` to BetterUptime/UptimeRobot (completed 2026-02-12)

## Priority: Medium / Architecture
- [ ] Shared scraping — decouple companies from users so each company is scraped once regardless of subscriber count. Design doc: `tasks/shared-scraping-design.md`

## Priority: Low / Future
- [ ] Stripe premium tier — link from existing Stripe account. Potential features: unlimited companies, salary alerts. Defer until 5K+ users.
- [ ] AdSense / affiliate monetization — not worth it at small scale, revisit at 5K+ users

## Auth / Multi-user
- [x] Middleware redirects authenticated users on `/login` to `/` — verified working (2026-02-10). Middleware checks `getUser()`, redirects to `/` if authenticated. Handles expired sessions, failed magic links, and sign-out correctly.
- [x] Set `newpmjobs.com` as primary Vercel domain — requires Vercel dashboard change (see instructions below)

### Domain Switch Instructions (Vercel Dashboard)
To make `newpmjobs.com` (non-www) the primary domain:
1. Go to **Vercel Dashboard → Project → Settings → Domains**
2. If `newpmjobs.com` is listed as redirecting to `www`, click the `...` menu and select **"Set as primary"**
3. If only `www.newpmjobs.com` is listed, add `newpmjobs.com` as a new domain and set it as primary
4. Vercel will auto-configure `www.newpmjobs.com` to redirect → `newpmjobs.com`
5. **No code changes needed** — backend CORS already allows both origins, auth callback uses dynamic `request.url`
6. **Supabase dashboard:** Keep both redirect URLs (`https://newpmjobs.com/auth/callback` AND `https://www.newpmjobs.com/auth/callback`) to be safe during the transition
