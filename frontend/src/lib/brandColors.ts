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
    // boards.greenhouse.io/discord → discord
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
    // *.myworkdayjobs.com → extract subdomain prefix or path slug
    host: /myworkdayjobs\.com$/,
    slugFromUrl: () => null, // complex structure, fall through to name-based
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
    // careers.google.com → google (subdomain extraction)
    host: /^careers\./,
    slugFromUrl: (u) => {
      const parts = u.hostname.replace(/^www\./, "").split(".");
      // careers.google.com → google
      return parts.length >= 3 ? parts[1] : null;
    },
  },
];

function extractFaviconDomain(companyName: string, careersUrl: string): string {
  try {
    const url = new URL(careersUrl);
    const hostname = url.hostname.replace(/^www\./, "");

    // Check if it's an ATS-hosted URL
    for (const pattern of ATS_PATTERNS) {
      if (pattern.host.test(hostname)) {
        const slug = pattern.slugFromUrl(url);
        if (slug) return `${slug}.com`;
        // Fall through to name-based fallback
        break;
      }
    }

    // Direct company domain — use as-is
    return hostname;
  } catch {
    // URL parse failed — use company name
    return `${companyName.toLowerCase().replace(/\s+/g, "")}.com`;
  }
}

export function getFaviconUrl(companyName: string, careersUrl: string): string {
  const domain = extractFaviconDomain(companyName, careersUrl);
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}
