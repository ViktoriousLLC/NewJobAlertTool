// Brand colors for known companies — lowercase name → hex
export const BRAND_COLORS: Record<string, string> = {
  atlassian: "#0052CC",
  doordash: "#FF3008",
  discord: "#5865F2",
  reddit: "#FF4500",
  instacart: "#43B02A",
  figma: "#A259FF",
  airbnb: "#FF5A5F",
  openai: "#10A37F",
  slack: "#611F69",
  stripe: "#635BFF",
  uber: "#000000",
  google: "#4285F4",
  netflix: "#E50914",
  paypal: "#003087",
  apple: "#000000",
  meta: "#0668E1",
  amazon: "#FF9900",
  microsoft: "#00A4EF",
  spotify: "#1DB954",
  ebay: "#E53238",
  anthropic: "#D4A574",
  vanta: "#5C2D91",
  cisco: "#049FD9",
  roblox: "#E2231A",
  bitkraft: "#1A1A2E",
};

export const DEFAULT_BRAND_COLOR = "#6B7280";

export function getBrandColor(companyName: string): string {
  return BRAND_COLORS[companyName.toLowerCase()] ?? DEFAULT_BRAND_COLOR;
}

/**
 * Blend a hex color toward white by `amount` (0 = original, 1 = white).
 */
export function softenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

/**
 * Derive a favicon URL from the company name and careers URL.
 *
 * Strategy:
 * 1. For ATS-hosted URLs (greenhouse, lever, ashby, workday, eightfold),
 *    extract the board/org slug and try {slug}.com — works for most companies.
 * 2. For direct company domains, use the hostname as-is.
 * 3. Fallback: use the company name as {name}.com.
 */

// ATS hostname patterns → regex to extract company slug from URL
const ATS_PATTERNS: { host: RegExp; slugFromUrl: (url: URL) => string | null }[] = [
  {
    // boards.greenhouse.io/discord → discord. Also job-boards.greenhouse.io/bitkraft.
    host: /greenhouse\.io$/,
    slugFromUrl: (u) => u.pathname.split("/").filter(Boolean)[0] || null,
  },
  {
    // jobs.lever.co/spotify → spotify
    host: /lever\.co$/,
    slugFromUrl: (u) => u.pathname.split("/").filter(Boolean)[0] || null,
  },
  {
    // jobs.ashbyhq.com/openai → openai
    host: /ashbyhq\.com$/,
    slugFromUrl: (u) => u.pathname.split("/").filter(Boolean)[0] || null,
  },
  {
    // nvidia.wd5.myworkdayjobs.com → nvidia (FIXED 2026-05-19 — was returning
    // null, falling through to the full hostname which logo.dev/favicon CDNs
    // can't resolve. Workday subdomain is always {company}.wd*.myworkdayjobs.com.)
    host: /myworkdayjobs\.com$/,
    slugFromUrl: (u) => {
      const parts = u.hostname.split(".");
      // Expect: {company}.wd{N}.myworkdayjobs.com → 4 parts minimum
      return parts.length >= 4 ? parts[0] : null;
    },
  },
  {
    // paypal.eightfold.ai → paypal (subdomain)
    host: /eightfold\.ai$/,
    slugFromUrl: (u) => {
      const parts = u.hostname.split(".");
      return parts.length > 2 ? parts[0] : null;
    },
  },
  {
    // *.icims.com → {prefix} (e.g. uscareers-docusign.icims.com → uscareers-docusign,
    // then strip prefixes like "uscareers-" or "careers-" if present)
    host: /icims\.com$/,
    slugFromUrl: (u) => {
      const parts = u.hostname.split(".");
      if (parts.length < 3) return null;
      let slug = parts[0];
      // Strip common iCIMS subdomain prefixes
      slug = slug.replace(/^(us)?careers-/, "");
      return slug || null;
    },
  },
  {
    // *.oraclecloud.com → tenant prefix (e.g., jpmc.fa.oraclecloud.com → jpmc)
    host: /oraclecloud\.com$/,
    slugFromUrl: (u) => {
      const parts = u.hostname.split(".");
      return parts.length >= 3 ? parts[0] : null;
    },
  },
  {
    // careers.google.com → google (subdomain extraction)
    host: /^careers\./,
    slugFromUrl: (u) => {
      const parts = u.hostname.replace(/^www\./, "").split(".");
      // careers.google.com → google
      return parts.length >= 3 ? parts[1] : null;
    },
  },
];

// Overrides for companies whose logo-resolvable domain isn't slug+".com".
// Hand-curated when we notice a logo isn't loading — beats trying to guess
// every company's actual web domain. Slug here matches what extractFaviconDomain
// would produce; the value is what logo CDNs actually resolve.
const LOGO_DOMAIN_OVERRIDE: Record<string, string> = {
  // Slug we'd produce → actual brand domain
  "confluent.com": "confluent.io",
  "anthropic.com": "anthropic.com",
  "supabase.com": "supabase.com",
  "vercel.com": "vercel.com",
  "linear.com": "linear.app",
  "notion.com": "notion.so",
  "openai.com": "openai.com",
  "asana.com": "asana.com",
  "magic.com": "magic.dev",
  "kraken.com": "kraken.com",
  "earnin.com": "earnin.com",
};

function extractFaviconDomain(companyName: string, careersUrl: string): string {
  let domain: string;
  try {
    const url = new URL(careersUrl);
    const hostname = url.hostname.replace(/^www\./, "");

    domain = hostname;
    for (const pattern of ATS_PATTERNS) {
      if (pattern.host.test(hostname)) {
        const slug = pattern.slugFromUrl(url);
        if (slug) {
          domain = `${slug}.com`;
        }
        break;
      }
    }
  } catch {
    domain = `${companyName.toLowerCase().replace(/\s+/g, "")}.com`;
  }
  // Apply per-company override if the slug-derived domain doesn't resolve
  return LOGO_DOMAIN_OVERRIDE[domain] || domain;
}

// logo.dev publishable key (exposed to the browser by design — designed
// for client-side embedding, like a Stripe pk). Set NEXT_PUBLIC_LOGO_DEV_TOKEN
// in Vercel to enable; falls back to DuckDuckGo when unset (local dev,
// preview envs without the key, etc.).
const LOGO_DEV_TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN || "";

export function getFaviconUrl(companyName: string, careersUrl: string): string {
  const domain = extractFaviconDomain(companyName, careersUrl);
  if (LOGO_DEV_TOKEN) {
    // logo.dev: higher-quality logos than free favicon services, real brand
    // marks rather than tiny ICO/PNG favicons. Token-gated.
    return `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&size=64`;
  }
  // Fallback when no token configured: DuckDuckGo's free icon CDN.
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

/**
 * Backup favicon URL — fed into <img>'s onError fallback chain. Behind the
 * entire chain, the colored brand chip with a letter is always rendered, so
 * even when both CDNs fail the UI shows something meaningful.
 *
 * When logo.dev is primary: falls back to DuckDuckGo (which falls back to
 * Google's service via the JobFeed's two-step onError handler).
 * When DuckDuckGo is primary (no logo.dev token): falls back to Google.
 */
export function getFaviconFallbackUrl(companyName: string, careersUrl: string): string {
  const domain = extractFaviconDomain(companyName, careersUrl);
  if (LOGO_DEV_TOKEN) {
    return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  }
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}
