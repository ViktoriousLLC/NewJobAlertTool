import { Router, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";

const router = Router();

// Public, paginated feed of recent PM jobs across all companies. Powers the
// new job-first landing page (PR #24). No auth required — the catalog is
// shared and the per-row Track button gates writes behind the existing
// magic-link login flow.

const VALID_INDUSTRIES = new Set([
  "banking", "biotech", "consulting", "consumer", "fintech",
  "gaming", "hardware", "healthcare", "media", "tech",
]);
const VALID_LEVELS = new Set(["early", "mid", "director"]);
const VALID_SORTS = new Set(["latest", "oldest", "company"]);
const VALID_REGIONS = new Set(["west", "northeast", "midwest", "south", "remote"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Region patterns for server-side location filtering. Building one big OR
// of ilike conditions per region — verbose but ships down to PostgREST cleanly.
// City patterns use bare substring match; state abbreviations are anchored by
// ", " prefix to avoid false matches like "Bangalore" hitting "BA".
const REGION_PATTERNS: Record<string, { cities: string[]; stateNames: string[]; stateAbbrs: string[] }> = {
  west: {
    stateAbbrs: ["CA", "OR", "WA", "NV", "AZ", "UT", "CO", "NM", "ID", "MT", "WY", "AK", "HI"],
    stateNames: ["California", "Oregon", "Washington", "Nevada", "Arizona", "Utah", "Colorado", "New Mexico", "Idaho", "Montana", "Wyoming", "Alaska", "Hawaii"],
    cities: ["San Francisco", "Los Angeles", "San Diego", "Seattle", "Portland", "Denver", "Phoenix", "Las Vegas", "Salt Lake City", "Sacramento", "Oakland", "San Jose", "Berkeley", "Palo Alto", "Mountain View", "Menlo Park", "Cupertino", "Sunnyvale", "Santa Clara", "Bellevue", "Redmond", "Albuquerque", "Tucson", "Boise", "Boulder"],
  },
  northeast: {
    stateAbbrs: ["ME", "NH", "VT", "MA", "RI", "CT", "NY", "NJ", "PA"],
    stateNames: ["Maine", "New Hampshire", "Vermont", "Massachusetts", "Rhode Island", "Connecticut", "New York", "New Jersey", "Pennsylvania"],
    cities: ["New York", "NYC", "Boston", "Philadelphia", "Pittsburgh", "Newark", "Jersey City", "Brooklyn", "Manhattan", "Cambridge", "Hartford"],
  },
  midwest: {
    stateAbbrs: ["OH", "IN", "IL", "MI", "WI", "MO", "IA", "KS", "NE", "ND", "SD", "MN"],
    stateNames: ["Ohio", "Indiana", "Illinois", "Michigan", "Wisconsin", "Missouri", "Iowa", "Kansas", "Nebraska", "North Dakota", "South Dakota", "Minnesota"],
    cities: ["Chicago", "Detroit", "Indianapolis", "Columbus", "Milwaukee", "Minneapolis", "St. Paul", "St. Louis", "Kansas City", "Cleveland", "Cincinnati", "Omaha"],
  },
  south: {
    stateAbbrs: ["DE", "MD", "DC", "VA", "WV", "NC", "SC", "GA", "FL", "KY", "TN", "AL", "MS", "AR", "LA", "OK", "TX"],
    stateNames: ["Delaware", "Maryland", "Washington DC", "Virginia", "West Virginia", "North Carolina", "South Carolina", "Georgia", "Florida", "Kentucky", "Tennessee", "Alabama", "Mississippi", "Arkansas", "Louisiana", "Oklahoma", "Texas"],
    cities: ["Atlanta", "Miami", "Orlando", "Tampa", "Jacksonville", "Charlotte", "Raleigh", "Durham", "Nashville", "Memphis", "New Orleans", "Houston", "Dallas", "Austin", "San Antonio", "Plano", "Arlington", "Richmond", "Norfolk", "Louisville", "Birmingham"],
  },
  // "Remote only" is a special case — handled separately, NOT in this map.
};

function buildRegionOrClause(region: string): string {
  const r = REGION_PATTERNS[region];
  if (!r) return "";
  // PostgREST OR delimiter is comma, and string values containing commas
  // OR parens MUST be wrapped in double-quotes or PostgREST treats them
  // as part of the OR-separator/group syntax — that's what malformed the
  // first version of this clause. Wrap every value defensively.
  const quoteValue = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
  const parts: string[] = [];
  for (const city of r.cities) {
    parts.push(`job_location.ilike.${quoteValue(`%${city}%`)}`);
  }
  for (const name of r.stateNames) {
    parts.push(`job_location.ilike.${quoteValue(`%${name}%`)}`);
  }
  // State abbreviations anchored with ", " prefix (matches "City, XX" and
  // "City, XX, US"). The comma is the reason these need quoting.
  for (const abbr of r.stateAbbrs) {
    parts.push(`job_location.ilike.${quoteValue(`%, ${abbr}%`)}`);
  }
  return parts.join(",");
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Lightweight company list for the filter dropdown on the public feed.
// Returns just enough to populate a cascading "industry → company" picker
// without exposing operational fields (subscriber_count, last_check_status,
// auto_disabled). Cached at the CDN/browser level — companies change rarely.
router.get("/companies", async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, industry")
      .order("name", { ascending: true });
    if (error) throw error;
    res.set("Cache-Control", "public, max-age=300"); // 5 min
    res.json(data || []);
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/feed/companies error:", err);
    res.status(500).json({ error: "Failed to fetch company list" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const industryParam = typeof req.query.industry === "string" ? req.query.industry : null;
    const industry = industryParam && VALID_INDUSTRIES.has(industryParam) ? industryParam : null;

    const levelParam = typeof req.query.level === "string" ? req.query.level : null;
    const level = levelParam && VALID_LEVELS.has(levelParam) ? levelParam : null;

    const qRaw = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const q = qRaw.length > 0 ? qRaw : null;

    const includeClosed = req.query.include_closed === "true";

    const companyParam = typeof req.query.company === "string" ? req.query.company : null;
    const companyId = companyParam && UUID_RE.test(companyParam) ? companyParam : null;

    const sortParam = typeof req.query.sort === "string" ? req.query.sort : "latest";
    const sort = VALID_SORTS.has(sortParam) ? sortParam : "latest";

    const regionParam = typeof req.query.region === "string" ? req.query.region : null;
    const region = regionParam && VALID_REGIONS.has(regionParam) ? regionParam : null;

    const cityRaw = typeof req.query.city === "string" ? req.query.city.trim().slice(0, 60) : "";
    const cityFilter = cityRaw.length > 0 ? cityRaw : null;

    // Foreign-key join via Supabase's nested select. `companies!inner` makes
    // the filter on `companies.industry` an INNER JOIN so non-matching jobs
    // are excluded server-side instead of post-filtered in JS.
    let query = supabase
      .from("seen_jobs")
      .select(
        "id, job_title, job_location, job_url_path, first_seen_at, job_level, status, companies!inner ( id, name, careers_url, industry )",
        { count: "exact" }
      )
      .eq("is_baseline", false);

    if (sort === "oldest") {
      query = query.order("first_seen_at", { ascending: true });
    } else if (sort === "company") {
      // Sort by company name then date so all of one company's jobs cluster.
      // `referencedTable` is the v2 name (replaced `foreignTable`); both used
      // to work but newer PostgREST silently ignored foreignTable for nested
      // sorts, which is why /api/feed?sort=company was returning the default
      // date-desc order in production.
      query = query
        .order("name", { referencedTable: "companies", ascending: true })
        .order("first_seen_at", { ascending: false });
    } else {
      query = query.order("first_seen_at", { ascending: false });
    }

    if (includeClosed) {
      // Active + removed; archived is too old to be useful.
      query = query.in("status", ["active", "removed"]);
    } else {
      query = query.eq("status", "active");
    }

    if (industry) query = query.eq("companies.industry", industry);
    if (companyId) query = query.eq("company_id", companyId);
    if (level) query = query.eq("job_level", level);
    if (q) {
      // Postgres ilike — case-insensitive substring match on title.
      // % wildcards are safe here: query is constrained to 100 chars and
      // ilike treats % as a wildcard token, not an injection vector.
      query = query.ilike("job_title", `%${q}%`);
    }

    // Region: "remote" is a special case (substring match on the word).
    // The four geo regions push an OR of city + state-name + state-abbr
    // patterns into PostgREST. Without this, pagination + counts were wrong
    // because the region filter only ran client-side after fetch.
    if (region === "remote") {
      query = query.ilike("job_location", "%Remote%");
    } else if (region) {
      const orClause = buildRegionOrClause(region);
      if (orClause) query = query.or(orClause);
    }

    if (cityFilter) {
      query = query.ilike("job_location", `%${cityFilter.replace(/[%_]/g, "\\$&")}%`);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    type JoinedRow = {
      id: string;
      job_title: string;
      job_location: string | null;
      job_url_path: string;
      first_seen_at: string;
      job_level: string | null;
      status: string | null;
      companies: { id: string; name: string; careers_url: string; industry: string };
    };

    const rows = (data as unknown as JoinedRow[]) || [];
    const jobs = rows.map((row) => ({
      id: row.id,
      title: row.job_title,
      location: row.job_location,
      urlPath: row.job_url_path,
      firstSeenAt: row.first_seen_at,
      level: row.job_level,
      status: row.status,
      company: row.companies,
    }));

    res.json({
      jobs,
      total: count ?? jobs.length,
      limit,
      offset,
      filters: { industry, level, q, includeClosed, companyId, sort, region, city: cityFilter },
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/feed error:", err);
    res.status(500).json({ error: "Failed to fetch feed" });
  }
});

export default router;
