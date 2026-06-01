// Product Pulse — the weekly product-metrics block in the Monday admin digest
// (DEV-65). Two tiers:
//
//   Supabase (ALWAYS, never optional): new signups in the last 7 days + total
//   users (from listAllUsers().created_at), total active user_subscriptions,
//   count of active companies. Computed straight from our own DB.
//
//   PostHog (RICHER, only when POSTHOG_PERSONAL_API_KEY is set): weekly active
//   logged-in users, signup-funnel conversion %, mobile-vs-desktop conversion,
//   top 3 referrers, top nav-button clicks, companies-tracked-per-user split.
//   Read from the four pre-built dashboard insights via the insights REST API
//   (cached results, no recompute) + a couple of small HogQL queries via the
//   /query/ endpoint for the slices no saved insight covers.
//
// GRACEFUL FALLBACK: if POSTHOG_PERSONAL_API_KEY is unset, only the Supabase
// metrics render plus a "full dashboard ->" link. A metrics failure must NEVER
// break the digest send: everything is wrapped in try/catch and the renderer
// emits a short "metrics unavailable" note on error instead of throwing.

import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { listAllUsers } from "../lib/listAllUsers";

const POSTHOG_HOST = process.env.POSTHOG_HOST_QUERY || "https://us.posthog.com";
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID || "311721";
const DASHBOARD_URL = `https://us.posthog.com/project/${POSTHOG_PROJECT_ID}/dashboard/1652973`;

// Pre-built dashboard insights (DEV-65). Querying these by short_id returns the
// cached, already-computed results, so the Monday digest spends ~no PostHog
// compute and stays fast. The HogQL /query/ calls below cover the rest.
const INSIGHTS = {
  referrers: "Z92wZyh3", // Where visitors come from (referring domain, 30d)
  funnelByDevice: "ovOuaVgP", // Signup funnel by device (Visit -> Request link -> Signed in)
  navButtons: "V4GmJxGZ", // Top nav-button clicks
  depth: "MEs3szkz", // Companies-tracked-per-user depth
};

const PH_TIMEOUT_MS = 8000;

export interface SupabaseMetrics {
  newSignups7d: number;
  totalUsers: number;
  activeSubscriptions: number;
  activeCompanies: number;
}

export interface PosthogMetrics {
  weeklyActiveUsers: number | null;
  signupConversionPct: number | null; // overall visit -> signed-in
  deviceConversion: { device: string; pct: number }[]; // mobile vs desktop conversion
  topReferrers: { source: string; visitors: number }[];
  topNavButtons: { label: string; clicks: number }[];
  companiesPerUser: { bucket: string; users: number }[];
}

export interface ProductPulseData {
  supabase: SupabaseMetrics | null;
  posthog: PosthogMetrics | null;
  posthogEnabled: boolean;
  dashboardUrl: string;
  error: string | null;
}

// ---- Supabase metrics (always computed) ----

async function computeSupabaseMetrics(now: Date): Promise<SupabaseMetrics> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Users come from auth (listAllUsers paginates properly — never the raw
  // perPage=50 default). New-signups = created_at within the last 7 days.
  const users = await listAllUsers();
  const totalUsers = users.length;
  const newSignups7d = users.filter((u) => {
    const created = u.created_at ? new Date(u.created_at) : null;
    return created !== null && created >= weekAgo;
  }).length;

  // Active subscriptions + active companies via head+count (no rows fetched).
  const [subsResult, companiesResult] = await Promise.all([
    supabase.from("user_subscriptions").select("id", { count: "exact", head: true }),
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  if (subsResult.error) throw subsResult.error;
  if (companiesResult.error) throw companiesResult.error;

  return {
    newSignups7d,
    totalUsers,
    activeSubscriptions: subsResult.count || 0,
    activeCompanies: companiesResult.count || 0,
  };
}

// ---- PostHog read helpers ----

async function phFetch(path: string, key: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PH_TIMEOUT_MS);
  try {
    const res = await fetch(`${POSTHOG_HOST}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`PostHog ${path} -> HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// HogQL query via POST /query/. Returns the `results` rows array (or []).
async function hogql(query: string, key: string): Promise<any[]> {
  const json = await phFetch(`/api/projects/${POSTHOG_PROJECT_ID}/query/`, key, {
    method: "POST",
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  return json?.results || [];
}

// Read a saved insight's CACHED results via GET /insights/?short_id=. The
// insights list endpoint returns the computed `result` so we don't recompute.
async function insightResult(shortId: string, key: string): Promise<any> {
  const json = await phFetch(`/api/projects/${POSTHOG_PROJECT_ID}/insights/?short_id=${shortId}`, key);
  const insight = json?.results?.[0];
  return insight?.result ?? null;
}

async function computePosthogMetrics(key: string): Promise<PosthogMetrics> {
  const out: PosthogMetrics = {
    weeklyActiveUsers: null,
    signupConversionPct: null,
    deviceConversion: [],
    topReferrers: [],
    topNavButtons: [],
    companiesPerUser: [],
  };

  // Each block is independently best-effort: one slice failing must not nuke the
  // others. Run them in parallel and absorb individual rejections.
  await Promise.allSettled([
    // Weekly active LOGGED-IN users: distinct identified persons who did anything
    // authenticated in the last 7 days. auth.signin_success marks the login;
    // the other events only fire for a signed-in user.
    (async () => {
      const rows = await hogql(
        `SELECT count(DISTINCT person_id) FROM events
         WHERE event IN ('auth.signin_success','company_added','company_deleted','companies_subscribed','job_starred','dashboard_filter')
           AND timestamp >= now() - INTERVAL 7 DAY`,
        key,
      );
      const n = rows?.[0]?.[0];
      if (typeof n === "number") out.weeklyActiveUsers = n;
    })(),

    // Signup funnel + per-device conversion from the saved funnel insight
    // (Visit -> Request link -> Signed in, broken down by $device_type).
    (async () => {
      const result = await insightResult(INSIGHTS.funnelByDevice, key);
      // Breakdown funnel result = array of breakdown groups, each an array of
      // steps with `count` + `breakdown_value`. Overall = sum across groups.
      if (Array.isArray(result) && result.length > 0) {
        let firstTotal = 0;
        let lastTotal = 0;
        for (const group of result) {
          if (!Array.isArray(group) || group.length === 0) continue;
          const first = group[0]?.count || 0;
          const last = group[group.length - 1]?.count || 0;
          firstTotal += first;
          lastTotal += last;
          const bd = group[0]?.breakdown_value;
          const device = Array.isArray(bd) ? bd[0] : bd;
          if (device && first > 0) {
            out.deviceConversion.push({
              device: String(device),
              pct: Math.round((last / first) * 100),
            });
          }
        }
        if (firstTotal > 0) out.signupConversionPct = Math.round((lastTotal / firstTotal) * 100);
        out.deviceConversion.sort((a, b) => b.pct - a.pct);
      }
    })(),

    // Top 3 referrers from the saved trends-breakdown insight.
    (async () => {
      const result = await insightResult(INSIGHTS.referrers, key);
      if (Array.isArray(result)) {
        out.topReferrers = result
          .map((r: any) => ({
            source: String(r.breakdown_value ?? r.label ?? "unknown"),
            visitors: typeof r.aggregated_value === "number" ? r.aggregated_value : (r.count || 0),
          }))
          .sort((a, b) => b.visitors - a.visitors)
          .slice(0, 3);
      }
    })(),

    // Top nav-button clicks from the saved insight.
    (async () => {
      const result = await insightResult(INSIGHTS.navButtons, key);
      if (Array.isArray(result)) {
        out.topNavButtons = result
          .map((r: any) => ({
            label: String(r.breakdown_value ?? r.label ?? "unknown"),
            clicks: typeof r.aggregated_value === "number" ? r.aggregated_value : (r.count || 0),
          }))
          .sort((a, b) => b.clicks - a.clicks)
          .slice(0, 5);
      }
    })(),

    // Companies-tracked-per-user split from the saved "depth" insight.
    (async () => {
      const result = await insightResult(INSIGHTS.depth, key);
      if (Array.isArray(result) && result.length > 0) {
        out.companiesPerUser = result.map((r: any) => ({
          bucket: String(r.breakdown_value ?? r.label ?? "?"),
          users: typeof r.aggregated_value === "number" ? r.aggregated_value : (r.count || 0),
        }));
      }
    })(),
  ]);

  return out;
}

// ---- Public entry: compute the whole block, never throw ----

export async function computeProductPulse(now: Date = new Date()): Promise<ProductPulseData> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const data: ProductPulseData = {
    supabase: null,
    posthog: null,
    posthogEnabled: !!key,
    dashboardUrl: DASHBOARD_URL,
    error: null,
  };

  try {
    data.supabase = await computeSupabaseMetrics(now);
  } catch (err) {
    Sentry.captureException(err);
    console.error("[product-pulse] Supabase metrics failed:", err);
    data.error = "Could not load core metrics from the database.";
  }

  if (key) {
    try {
      data.posthog = await computePosthogMetrics(key);
    } catch (err) {
      // A PostHog failure is non-fatal: keep the Supabase block + dashboard link.
      Sentry.captureException(err);
      console.error("[product-pulse] PostHog metrics failed:", err);
    }
  }

  return data;
}

// ---- HTML rendering (Monday only; called from renderEmailHtml) ----

const PP_HEADER = "font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin:32px 0 12px 0;font-weight:600;";
const PP_SUB = "font-size:15px;color:#111827;margin:20px 0 8px 0;font-weight:600;";
const PP_TABLE = "border-collapse:collapse;font-size:14px;";
const PP_TD_LABEL = "padding:4px 12px 4px 0;color:#374151;";
const PP_TD_VAL = "padding:4px 0;color:#111827;font-weight:600;";

function ppEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function row(label: string, value: string): string {
  return `<tr><td style="${PP_TD_LABEL}">${ppEscape(label)}</td><td style="${PP_TD_VAL}">${ppEscape(value)}</td></tr>`;
}

function renderPosthogBlock(p: PosthogMetrics): string {
  const parts: string[] = [];

  const core: string[] = [];
  if (p.weeklyActiveUsers !== null) core.push(row("Weekly active logged-in users", String(p.weeklyActiveUsers)));
  if (p.signupConversionPct !== null) core.push(row("Signup funnel conversion (visit to signed-in)", `${p.signupConversionPct}%`));
  if (core.length) parts.push(`<table style="${PP_TABLE}">${core.join("")}</table>`);

  if (p.deviceConversion.length) {
    parts.push(`<h3 style="${PP_SUB}">Conversion by device</h3>`);
    parts.push(
      `<table style="${PP_TABLE}">${p.deviceConversion
        .map((d) => row(d.device, `${d.pct}%`))
        .join("")}</table>`,
    );
  }

  if (p.topReferrers.length) {
    parts.push(`<h3 style="${PP_SUB}">Top 3 referrers (30d)</h3>`);
    parts.push(
      `<table style="${PP_TABLE}">${p.topReferrers
        .map((r) => row(r.source, String(Math.round(r.visitors))))
        .join("")}</table>`,
    );
  }

  if (p.topNavButtons.length) {
    parts.push(`<h3 style="${PP_SUB}">Top nav-button clicks</h3>`);
    parts.push(
      `<table style="${PP_TABLE}">${p.topNavButtons
        .map((b) => row(b.label, String(Math.round(b.clicks))))
        .join("")}</table>`,
    );
  }

  if (p.companiesPerUser.length) {
    parts.push(`<h3 style="${PP_SUB}">Companies tracked per user</h3>`);
    parts.push(
      `<table style="${PP_TABLE}">${p.companiesPerUser
        .map((c) => row(c.bucket, String(Math.round(c.users))))
        .join("")}</table>`,
    );
  }

  if (!parts.length) {
    return `<p style="font-size:13px;color:#9ca3af;font-style:italic;margin:0;">PostHog metrics returned nothing this week.</p>`;
  }
  return parts.join("\n");
}

export function renderProductPulseHtml(d: ProductPulseData): string {
  const dash = `<p style="font-size:13px;margin:12px 0 0 0;"><a href="${d.dashboardUrl}" style="color:#0EA5E9;text-decoration:none;font-weight:600;">Full dashboard -&gt;</a></p>`;

  // Hard failure: core metrics unavailable. Render a short note + dashboard link,
  // never break the digest.
  if (!d.supabase) {
    return `<h2 style="${PP_HEADER}">Product Pulse</h2>
<p style="font-size:13px;color:#9ca3af;font-style:italic;margin:0;">${ppEscape(d.error || "Metrics unavailable this week.")}</p>
${dash}`;
  }

  const s = d.supabase;
  const core = `<table style="${PP_TABLE}">
${row("New signups (last 7 days)", String(s.newSignups7d))}
${row("Total users", String(s.totalUsers))}
${row("Active subscriptions", String(s.activeSubscriptions))}
${row("Active companies", String(s.activeCompanies))}
</table>`;

  let richer: string;
  if (!d.posthogEnabled) {
    richer = `<p style="font-size:12px;color:#9ca3af;font-style:italic;margin:16px 0 0 0;">Richer engagement metrics (weekly active users, funnel conversion, referrers, nav clicks) are off until POSTHOG_PERSONAL_API_KEY is set on Railway.</p>`;
  } else if (d.posthog) {
    richer = renderPosthogBlock(d.posthog);
  } else {
    richer = `<p style="font-size:12px;color:#9ca3af;font-style:italic;margin:16px 0 0 0;">PostHog metrics were unavailable this run (see Sentry). Core metrics above are unaffected.</p>`;
  }

  return `<h2 style="${PP_HEADER}">Product Pulse</h2>
${core}
${richer}
${dash}`;
}
