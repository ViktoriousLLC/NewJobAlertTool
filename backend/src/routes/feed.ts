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

// Seniority rank for per-company threshold comparison. companies.min_relevant_seniority
// can be NULL | 'early' | 'mid' | 'director'. A job passes if its rank >=
// company's threshold rank. NULL threshold = show all. Jobs with no detected
// level always pass — uncategorized titles are more likely senior misclassifies
// than junior; better to over-show than over-filter.
const SENIORITY_RANK: Record<string, number> = { early: 0, mid: 1, director: 2 };
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
  // PostgREST OR delimiter is comma; values containing commas or parens MUST
  // be wrapped in double-quotes. Wrap every value defensively.
  const quoteValue = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
  const parts: string[] = [];

  // Cities + full state names are unique words → ilike is safe.
  for (const city of r.cities) {
    parts.push(`job_location.ilike.${quoteValue(`%${city}%`)}`);
  }
  for (const name of r.stateNames) {
    parts.push(`job_location.ilike.${quoteValue(`%${name}%`)}`);
  }

  // 2-letter state abbreviations have TWO false-positive problems:
  //   - case-insensitive: "%, NE%" hits ", New Jersey" / ", New York" because
  //     "New" begins with case-insensitive "Ne"
  //   - country-code collision: ", IN" is Indiana but also India (e.g. EY's
  //     "Kochi, KL, IN, 682313")
  // Fix: use case-sensitive `like` AND require an explicit US country anchor.
  // Covers "City, XX, US" and "City, XX, USA" and "City, XX, United States"
  // and the bare "XX, United States" head-of-string case from Oracle HCM.
  // Trade-off: misses the rare "Chicago, IL" with no country marker. Backlog
  // item: derive region at scrape time into a real column.
  for (const abbr of r.stateAbbrs) {
    parts.push(`job_location.like.${quoteValue(`%, ${abbr}, US%`)}`);
    parts.push(`job_location.like.${quoteValue(`%, ${abbr}, USA%`)}`);
    parts.push(`job_location.like.${quoteValue(`%, ${abbr}, United States%`)}`);
    parts.push(`job_location.like.${quoteValue(`${abbr}, US%`)}`);
    parts.push(`job_location.like.${quoteValue(`${abbr}, USA%`)}`);
    parts.push(`job_location.like.${quoteValue(`${abbr}, United States%`)}`);
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

    // Minimum total-comp filter (sourced from comp_cache by company + level).
    // 0 / unset = no filter. Capped at 10M to bound JS Number behavior in the
    // unlikely event of weird input.
    const minCompRaw = Number(req.query.min_comp);
    const minComp = Number.isFinite(minCompRaw) && minCompRaw > 0 ? Math.min(minCompRaw, 10_000_000) : 0;

    // Foreign-key join via Supabase's nested select. `companies!inner` makes
    // the filter on `companies.industry` an INNER JOIN so non-matching jobs
    // are excluded server-side instead of post-filtered in JS.
    let query = supabase
      .from("seen_jobs")
      .select(
        "id, job_title, job_location, job_url_path, first_seen_at, job_level, status, companies!inner ( id, name, careers_url, industry, min_relevant_seniority )",
        { count: "exact" }
      )
      .eq("is_baseline", false);

    if (sort === "oldest") {
      query = query.order("first_seen_at", { ascending: true });
    } else if (sort === "company") {
      // PostgREST silently ignores foreign-table order under our setup
      // (tried both `foreignTable` and `referencedTable` options, neither
      // honored). Falling back to a fetch-and-sort-in-Node approach for
      // this sort mode — see the SORT_COMPANY_CAP / Node slice block below.
      // Still order by first_seen_at as a deterministic secondary so the
      // chunk we fetch is reproducible.
      query = query.order("first_seen_at", { ascending: false });
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

    // sort=company: fetch the whole filtered result set (capped) and sort
    // in Node since PostgREST is silently ignoring foreign-table order in
    // our setup. Cap matches the practical upper bound of one filter query
    // — well under the ~5k jobs we'd ever have post-filter.
    const SORT_COMPANY_CAP = 5000;
    if (sort === "company") {
      query = query.range(0, SORT_COMPANY_CAP - 1);
    } else {
      query = query.range(offset, offset + limit - 1);
    }

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
      companies: { id: string; name: string; careers_url: string; industry: string; min_relevant_seniority: string | null };
    };

    const rows = (data as unknown as JoinedRow[]) || [];
    type FeedJob = {
      id: string;
      title: string;
      location: string | null;
      urlPath: string;
      firstSeenAt: string;
      level: string | null;
      status: string | null;
      company: JoinedRow["companies"];
      comp: { min: number; max: number; median: number | null; tier: string } | null;
    };
    let jobs: FeedJob[] = rows.map((row) => ({
      id: row.id,
      title: row.job_title,
      location: row.job_location,
      urlPath: row.job_url_path,
      firstSeenAt: row.first_seen_at,
      level: row.job_level,
      status: row.status,
      company: row.companies,
      comp: null,
    }));

    // ---- Enrich with comp tiers from comp_cache ----
    // Distinct company names in this page → one batched query → map per job's
    // job_level to the company's tier. Companies without levels.fyi data
    // remain `comp = null`. Used both for display and the min_comp filter.
    const distinctCompanyNames = Array.from(new Set(jobs.map((j) => j.company.name)));
    if (distinctCompanyNames.length > 0) {
      const { data: compRows } = await supabase
        .from("comp_cache")
        .select("company_name, data")
        .in("company_name", distinctCompanyNames);
      const compByName = new Map<string, { tiers?: { early?: { min: number; max: number }; mid?: { min: number; max: number }; director?: { min: number; max: number } }; overallMedianTC?: number }>();
      for (const row of compRows || []) {
        compByName.set(row.company_name as string, (row.data as Parameters<typeof compByName.set>[1]) || {});
      }
      for (const job of jobs) {
        const compData = compByName.get(job.company.name);
        if (!compData?.tiers) continue;
        const tierKey = job.level === "director" ? "director" : job.level === "mid" ? "mid" : "early";
        const tier = compData.tiers[tierKey as "early" | "mid" | "director"];
        if (tier && tier.min && tier.max) {
          const median = Math.round((tier.min + tier.max) / 2);
          job.comp = { min: tier.min, max: tier.max, median, tier: tierKey };
        }
      }
    }

    // Per-company seniority filter (manual override, still in effect after PR #33).
    const seniorityFiltered = jobs.filter((j) => {
      const threshold = j.company.min_relevant_seniority;
      if (!threshold) return true;
      if (!j.level) return true;
      const tRank = SENIORITY_RANK[threshold] ?? 0;
      const jRank = SENIORITY_RANK[j.level] ?? 0;
      return jRank >= tRank;
    });
    const filteredOutBySeniority = jobs.length - seniorityFiltered.length;
    jobs = seniorityFiltered;

    // Min-comp filter. Excludes jobs without comp data when the filter is on —
    // we can't verify they meet the threshold, so default to excluding rather
    // than polluting the user's "$X+" view with unknowns. User can clear the
    // filter to see all again.
    let filteredOutByComp = 0;
    if (minComp > 0) {
      const compFiltered = jobs.filter((j) => {
        if (!j.comp || !j.comp.median) return false;
        return j.comp.median >= minComp;
      });
      filteredOutByComp = jobs.length - compFiltered.length;
      jobs = compFiltered;
    }

    let totalForResponse = count ?? jobs.length;
    if (filteredOutBySeniority + filteredOutByComp > 0 && totalForResponse > 0) {
      totalForResponse = Math.max(0, totalForResponse - filteredOutBySeniority - filteredOutByComp);
    }

    if (sort === "company") {
      // Sort by company name ASC, ties broken by newest first within a company.
      jobs.sort((a, b) => {
        const cmp = a.company.name.localeCompare(b.company.name);
        if (cmp !== 0) return cmp;
        return new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime();
      });
      totalForResponse = jobs.length;
      jobs = jobs.slice(offset, offset + limit);
    }

    res.json({
      jobs,
      total: totalForResponse,
      limit,
      offset,
      filters: { industry, level, q, includeClosed, companyId, sort, region, city: cityFilter, minComp },
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("GET /api/feed error:", err);
    res.status(500).json({ error: "Failed to fetch feed" });
  }
});

export default router;
