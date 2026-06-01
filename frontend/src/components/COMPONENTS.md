# Frontend Components — READ BEFORE EDITING

This sidecar collects everything needed before touching `frontend/src/components/*.tsx` or the landing page. CLAUDE.md keeps only the top-level Architecture pointer.

## Key Component Files

- `LandingPage.tsx` — Above-fold (Nav + Hero) + shared utils
- `LandingBelowFold.tsx` — Below-fold (sections 3-10), lazy-loaded
- `AddCompanyModal.tsx` — Catalog browse + check-then-add (4 states: input → checking → preview → retry)
- `NavBar.tsx` — Sticky nav, active route detection. Admin-only (gated on `NEXT_PUBLIC_ADMIN_EMAIL`) **Metrics** button (desktop + mobile) opens the PostHog "Admin Metrics" dashboard (project 311721 / dashboard 1652973) in a new tab, alongside the Admin button (DEV-65).
- `HelpButton.tsx` — Floating ? icon, ~120 lines, posts to `/api/help`

## Page Files (`frontend/src/app/`)

- `page.tsx` — Auth-gated: LandingPage (unauth) or Dashboard (auth)
- `company/[id]/page.tsx` — Company detail + jobs + saved inactive section
- `jobs/page.tsx` — All Jobs flat table
- `admin/page.tsx` — Admin: stats, errors, reports, companies management (hard-delete), users
- `settings/page.tsx` — Email preferences
- `login/page.tsx` — Magic link login
- `auth/confirm/route.ts` — Token-hash verification (cross-device)
- `auth/callback/route.ts` — PKCE exchange (legacy)

## Lib

- `lib/api.ts` — Authenticated fetch (attaches JWT, caches token via `/api/auth/token`)
- `lib/jobFilters.ts` — `isUSLocation()`, job level labels
- `lib/brandColors.ts` — Brand color map, `softenColor()`, `getFaviconUrl()`
- `middleware.ts` (at frontend root) — Route protection

## Landing Page

Fixed overlay at `/` for unauthenticated visitors. 10 sections: Nav → Hero → Problem → How It Works → Product Screens → Latest Jobs → Comp Callout → Stats → CTA → Footer.

- **Code-split**: above-fold `LandingPage.tsx` + lazy `LandingBelowFold.tsx`
- **Pre-computed** `COMPANY_COLORS` map, deferred PostHog init
- **Desktop Lighthouse**: 100. **Mobile**: ~72-77 (React DOM bottleneck)
- **Spec**: `docs/specs/NEWPMJOBS-LANDING-SPEC.md`

## Headers / CSP

Configured in `frontend/next.config.ts`:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- HSTS
- CSP — dynamic from env vars
- **CSP connect-src**: self, backend API, Supabase HTTPS+WSS, PostHog, Sentry

## PostHog

- User ID hashed with SHA-256 (no raw emails).
- Init deferred for landing perf.

## Gotchas

- **NEXT_PUBLIC_ env vars**: Baked at build time. Must redeploy after changing in Vercel.
- **NEXT_PUBLIC_ADMIN_EMAIL**: Required in Vercel for admin button to appear.
- **Vercel project name**: `new-job-alert-tool` (not `frontend`). `vercel link --yes` auto-creates — verify with `vercel project ls`.
- **Cloudflare proxy**: Must be OFF (grey cloud) for Vercel/Railway custom domains.
- **HttpOnly cookies**: Browser JS can't read them. `lib/api.ts` calls `/api/auth/token` server route to get the JWT.
