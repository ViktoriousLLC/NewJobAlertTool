import { supabase } from "./supabase";

// Known company → levels.fyi slug mapping
const SLUG_MAP: Record<string, string> = {
  Atlassian: "atlassian",
  DoorDash: "doordash",
  Discord: "discord",
  Reddit: "reddit",
  Instacart: "instacart",
  Figma: "figma",
  Airbnb: "airbnb",
  OpenAI: "openai",
  Slack: "salesforce",
  Stripe: "stripe",
  Uber: "uber",
  Google: "google",
  Netflix: "netflix",
  PayPal: "paypal",
  Meta: "meta",
  Microsoft: "microsoft",
  Amazon: "amazon",
  Apple: "apple",
  Spotify: "spotify",
  Pinterest: "pinterest",
  Snap: "snap",
  LinkedIn: "linkedin",
  Twitter: "twitter",
  Lyft: "lyft",
  Coinbase: "coinbase",
  Robinhood: "robinhood",
  Databricks: "databricks",
};

interface LevelData {
  level: string;
  medianTC: number;
}

interface TierRange {
  min: number;
  max: number;
}

export interface CompData {
  levels: LevelData[];
  overallMedianTC: number;
  tiers: {
    early?: TierRange;
    mid?: TierRange;
    director?: TierRange;
  };
  levelsFyiUrl: string;
  attribution: string;
}

function resolveSlug(companyName: string): string {
  return SLUG_MAP[companyName] || companyName.toLowerCase().replace(/\s+/g, "-");
}

function buildUrl(slug: string): string {
  return `https://www.levels.fyi/companies/${slug}/salaries/product-manager`;
}

/**
 * Parse level data and overall median from the levels.fyi HTML page.
 * Extracts:
 * 1. JSON-LD schema for overall median TC
 * 2. Level-specific TC from the SSR'd compensation table
 */
function parseHtml(html: string): { levels: LevelData[]; overallMedianTC: number } | null {
  // 1. Extract JSON-LD for overall median
  let overallMedianTC = 0;
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const jsonLd = JSON.parse(jsonLdMatch[1]);
      if (jsonLd.estimatedSalary) {
        // Could be array or object
        const salaries = Array.isArray(jsonLd.estimatedSalary) ? jsonLd.estimatedSalary : [jsonLd.estimatedSalary];
        for (const s of salaries) {
          if (s.median) {
            overallMedianTC = Number(s.median);
            break;
          }
        }
      }
    } catch {
      // JSON-LD parse failed — continue without overall median
    }
  }

  // 2. Extract level-specific data from page content
  // Levels.fyi SSR includes compensation data in the HTML.
  // Look for patterns like level names followed by dollar amounts.
  const levels: LevelData[] = [];

  // Strategy: find all level + TC pairs in the HTML
  // The page renders levels like "L4" or "APM1" with corresponding "$274K" or "$274,000"
  // Look for table-like patterns in the HTML

  // Pattern 1: Look for structured level data in Next.js __NEXT_DATA__ script
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      // Navigate through Next.js data structure to find level data
      const pageProps = nextData?.props?.pageProps;
      if (pageProps) {
        // Try to find levels data in various possible locations
        const levelsData = pageProps.levels || pageProps.salaryData?.levels || pageProps.companyData?.levels;
        if (Array.isArray(levelsData)) {
          for (const l of levelsData) {
            const name = l.level || l.name || l.title;
            const tc = l.medianTotalComp || l.medianTC || l.totalComp || l.median;
            if (name && tc) {
              levels.push({ level: String(name), medianTC: Number(tc) });
            }
          }
        }
      }
    } catch {
      // __NEXT_DATA__ parse failed
    }
  }

  // Pattern 2: Regex-based extraction from rendered HTML
  // Match patterns like: >L4</...>$274K< or >L4</...>$274,000<
  if (levels.length === 0) {
    // Look for level identifiers followed by dollar amounts
    // Common level patterns: L1-L10, APM1-2, IC1-IC6, E3-E8, PM1-PM6, etc.
    const levelPattern = /(?:>|")((?:L|APM|IC|E|PM|T|SDE|P|M)\d+|Associate|Senior|Staff|Principal|Director|VP)[^<"]*(?:<|")/gi;
    const amountPattern = /\$[\d,]+(?:\.\d+)?[KkMm]?/g;

    // Find sections that look like compensation tables
    // Look for rows with level name + dollar amount
    const rowPattern = /(?:>|")((?:L|APM|IC|E|PM|T)\d+)[^$]*?\$([\d,]+)(?:\.\d+)?([KkMm])?/g;
    let rowMatch;
    while ((rowMatch = rowPattern.exec(html)) !== null) {
      const levelName = rowMatch[1];
      let amount = Number(rowMatch[2].replace(/,/g, ""));
      const suffix = rowMatch[3]?.toUpperCase();
      if (suffix === "K") amount *= 1000;
      if (suffix === "M") amount *= 1000000;
      // Only include reasonable TC amounts ($50K–$5M)
      if (amount >= 50000 && amount <= 5000000) {
        // Avoid duplicates
        if (!levels.find((l) => l.level === levelName)) {
          levels.push({ level: levelName, medianTC: amount });
        }
      }
    }
  }

  // Sort levels by compensation (ascending = junior → senior)
  levels.sort((a, b) => a.medianTC - b.medianTC);

  if (levels.length === 0 && overallMedianTC === 0) {
    return null;
  }

  return { levels, overallMedianTC };
}

/**
 * Split levels into thirds and compute tier ranges.
 */
function computeTiers(levels: LevelData[]): CompData["tiers"] {
  if (levels.length === 0) return {};

  if (levels.length === 1) {
    return { mid: { min: levels[0].medianTC, max: levels[0].medianTC } };
  }

  if (levels.length === 2) {
    return {
      early: { min: levels[0].medianTC, max: levels[0].medianTC },
      director: { min: levels[1].medianTC, max: levels[1].medianTC },
    };
  }

  // Split into thirds
  const third = Math.ceil(levels.length / 3);
  const earlyLevels = levels.slice(0, third);
  const midLevels = levels.slice(third, third * 2);
  const dirLevels = levels.slice(third * 2);

  const tiers: CompData["tiers"] = {};

  if (earlyLevels.length > 0) {
    tiers.early = {
      min: earlyLevels[0].medianTC,
      max: earlyLevels[earlyLevels.length - 1].medianTC,
    };
  }
  if (midLevels.length > 0) {
    tiers.mid = {
      min: midLevels[0].medianTC,
      max: midLevels[midLevels.length - 1].medianTC,
    };
  }
  if (dirLevels.length > 0) {
    tiers.director = {
      min: dirLevels[0].medianTC,
      max: dirLevels[dirLevels.length - 1].medianTC,
    };
  }

  return tiers;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get compensation data for a single company.
 * Uses comp_cache table with 24hr TTL.
 */
export async function getCompData(companyName: string): Promise<CompData | null> {
  const slug = resolveSlug(companyName);

  // Check company-level override slug
  const { data: companyRow } = await supabase
    .from("companies")
    .select("levelsfyi_slug")
    .eq("name", companyName)
    .maybeSingle();

  const effectiveSlug = companyRow?.levelsfyi_slug || slug;

  // Check cache
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const { data: cached } = await supabase
    .from("comp_cache")
    .select("data")
    .eq("company_slug", effectiveSlug)
    .gt("fetched_at", cutoff)
    .maybeSingle();

  if (cached?.data) {
    return cached.data as CompData;
  }

  // Fetch from levels.fyi
  const url = buildUrl(effectiveSlug);
  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewPMJobs/1.0)",
        Accept: "text/html",
      },
    });
    if (!response.ok) return null;
    html = await response.text();
  } catch {
    return null;
  }

  const parsed = parseHtml(html);
  if (!parsed) return null;

  const compData: CompData = {
    levels: parsed.levels,
    overallMedianTC: parsed.overallMedianTC,
    tiers: computeTiers(parsed.levels),
    levelsFyiUrl: url,
    attribution: "Data source: Levels.fyi (https://www.levels.fyi)",
  };

  // Upsert into cache
  try {
    await supabase.from("comp_cache").upsert(
      {
        company_slug: effectiveSlug,
        company_name: companyName,
        data: compData,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "company_slug" }
    );
  } catch (err) {
    console.error("Failed to cache comp data:", err);
  }

  return compData;
}

/**
 * Get compensation data for multiple companies at once.
 * Checks cache first, fetches missing ones in parallel.
 */
export async function getAllCompData(
  companyNames: string[]
): Promise<Record<string, CompData>> {
  const result: Record<string, CompData> = {};

  // Check cache for all companies
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const slugs = companyNames.map((n) => resolveSlug(n));

  const { data: cached } = await supabase
    .from("comp_cache")
    .select("company_name, company_slug, data")
    .in("company_slug", slugs)
    .gt("fetched_at", cutoff);

  const cachedSlugs = new Set<string>();
  if (cached) {
    for (const row of cached) {
      if (row.data) {
        result[row.company_name] = row.data as CompData;
        cachedSlugs.add(row.company_slug);
      }
    }
  }

  // Fetch missing companies in parallel (max 5 concurrent)
  const missing = companyNames.filter((n) => !cachedSlugs.has(resolveSlug(n)));

  if (missing.length > 0) {
    const batchSize = 5;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (name) => {
          const data = await getCompData(name);
          if (data) result[name] = data;
        })
      );
    }
  }

  return result;
}
