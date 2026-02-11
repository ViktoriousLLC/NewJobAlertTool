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
  slack: "#4A154B",
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

// Companies whose careers_url is on an ATS domain — map name → real domain
const DOMAIN_OVERRIDES: Record<string, string> = {
  discord: "discord.com",
  doordash: "doordash.com",
  reddit: "reddit.com",
  instacart: "instacart.com",
  figma: "figma.com",
  airbnb: "airbnb.com",
  openai: "openai.com",
  slack: "slack.com",
};

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    // Strip ATS domains to avoid getting the ATS favicon
    const ats = [
      "boards.greenhouse.io",
      "api.greenhouse.io",
      "jobs.lever.co",
      "jobs.ashbyhq.com",
      "myworkdayjobs.com",
      "eightfold.ai",
    ];
    for (const a of ats) {
      if (hostname.endsWith(a)) return hostname; // will be overridden
    }
    return hostname;
  } catch {
    return "";
  }
}

export function getFaviconUrl(companyName: string, careersUrl: string): string {
  const override = DOMAIN_OVERRIDES[companyName.toLowerCase()];
  const domain = override ?? extractDomain(careersUrl);
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}
