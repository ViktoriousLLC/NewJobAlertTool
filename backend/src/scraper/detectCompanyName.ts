/**
 * Auto-detect company name from URL + platform detection info.
 * Pure function, no I/O. Best-effort — user can always edit before confirming.
 */

/** Known hostnames → friendly company names */
const KNOWN_HOSTS: Record<string, string> = {
  "atlassian.com": "Atlassian",
  "stripe.com": "Stripe",
  "uber.com": "Uber",
  "google.com": "Google",
  "netflix.net": "Netflix",
  "netflix.com": "Netflix",
  "ea.com": "Electronic Arts",
  "doordash.com": "DoorDash",
  "discord.com": "Discord",
  "reddit.com": "Reddit",
  "instacart.com": "Instacart",
  "figma.com": "Figma",
  "airbnb.com": "Airbnb",
  "openai.com": "OpenAI",
  "slack.com": "Slack",
  "paypal.com": "PayPal",
  "spotify.com": "Spotify",
  "apple.com": "Apple",
  "meta.com": "Meta",
  "microsoft.com": "Microsoft",
  "amazon.com": "Amazon",
  "salesforce.com": "Salesforce",
  "adobe.com": "Adobe",
  "linkedin.com": "LinkedIn",
  "twitter.com": "Twitter",
  "snap.com": "Snap",
  "pinterest.com": "Pinterest",
  "lyft.com": "Lyft",
  "robinhood.com": "Robinhood",
  "coinbase.com": "Coinbase",
  "databricks.com": "Databricks",
  "snowflake.com": "Snowflake",
  "plaid.com": "Plaid",
  "notion.so": "Notion",
  "ramp.com": "Ramp",
  "brex.com": "Brex",
  "rippling.com": "Rippling",
  "gusto.com": "Gusto",
  "shopify.com": "Shopify",
  "twitch.tv": "Twitch",
  "zoom.us": "Zoom",
  "dropbox.com": "Dropbox",
  "a16z.com": "a16z",
  "jobs.a16z.com": "a16z",
};

/** Capitalize a slug: "doordashusa" → "Doordashusa", "open-ai" → "Open Ai" */
function capitalize(slug: string): string {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function detectCompanyName(
  url: string,
  platformType: string | null,
  platformConfig: Record<string, string> | null
): string {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();

  // 1. Known hostnames — check if any known host is part of the hostname
  for (const [host, name] of Object.entries(KNOWN_HOSTS)) {
    if (hostname === host || hostname.endsWith(`.${host}`)) {
      return name;
    }
  }

  // 2. ATS platform slugs — use the board/handle/org name
  if (platformType && platformConfig) {
    switch (platformType) {
      case "greenhouse": {
        const board = platformConfig.boardName;
        if (board) return capitalize(board);
        break;
      }
      case "lever": {
        const handle = platformConfig.handle;
        if (handle) return capitalize(handle);
        break;
      }
      case "ashby": {
        const org = platformConfig.orgName;
        if (org) return capitalize(org);
        break;
      }
      case "workday": {
        const tenant = platformConfig.tenant;
        if (tenant) return capitalize(tenant);
        break;
      }
      case "eightfold": {
        // Extract subdomain: "paypal.eightfold.ai" → "PayPal"
        const efHost = parsed.hostname;
        const sub = efHost.split(".")[0];
        if (sub && sub !== "www") return capitalize(sub);
        break;
      }
    }
  }

  // 3. Generic fallback — strip common prefixes from hostname
  let domain = hostname
    .replace(/^www\./, "")
    .replace(/^jobs\./, "")
    .replace(/^careers\./, "")
    .replace(/^career\./, "")
    .replace(/^hire\./, "")
    .replace(/^apply\./, "");

  // Take just the first segment before the TLD
  const parts = domain.split(".");
  if (parts.length >= 2) {
    domain = parts[0];
  }

  return capitalize(domain);
}
