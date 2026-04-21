/**
 * Shared ATS slug registry — single source of truth for hostname → ATS platform mappings.
 *
 * Used by both detectPlatform.ts (to instantly resolve known companies)
 * and scraper.ts (to route to the correct ATS scraper without hostname if/else chains).
 *
 * Custom scrapers (Uber, Google, Netflix, EA, Atlassian) are NOT in this registry
 * because they use bespoke scraping logic, not standard ATS APIs.
 */

export interface ATSRegistryEntry {
  platformType: "greenhouse" | "greenhouse_departments" | "lever" | "ashby" | "workday" | "icims" | "smartrecruiters";
  /** ATS-specific config: boardName for Greenhouse, handle for Lever, etc. */
  platformConfig: Record<string, string>;
  /** Human-readable label for logging */
  label: string;
}

/**
 * Maps hostname patterns to ATS platform + config.
 * Keys are matched via `hostname.includes(key)` or `hostname === key`.
 */
const ATS_REGISTRY: Record<string, ATSRegistryEntry> = {
  // Greenhouse boards (keyword-filtered)
  "doordash.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "doordashusa" },
    label: "DoorDash",
  },
  "careersatdoordash.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "doordashusa" },
    label: "DoorDash",
  },
  "discord.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "discord" },
    label: "Discord",
  },
  "instacart.careers": {
    platformType: "greenhouse",
    platformConfig: { boardName: "instacart" },
    label: "Instacart",
  },
  "instacart.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "instacart" },
    label: "Instacart",
  },
  "figma.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "figma" },
    label: "Figma",
  },
  "airbnb.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "airbnb" },
    label: "Airbnb",
  },
  "jobs.a16z.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "a16z" },
    label: "a16z",
  },
  "careers.twitch.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "twitch" },
    label: "Twitch",
  },

  // Greenhouse boards (departments-filtered for better accuracy)
  "reddit.com": {
    platformType: "greenhouse_departments",
    platformConfig: { boardName: "reddit" },
    label: "Reddit",
  },
  "redditinc.com": {
    platformType: "greenhouse_departments",
    platformConfig: { boardName: "reddit" },
    label: "Reddit",
  },
  "roblox.com": {
    platformType: "greenhouse_departments",
    platformConfig: { boardName: "roblox" },
    label: "Roblox",
  },

  "anthropic.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "anthropic" },
    label: "Anthropic",
  },
  "stripe.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "stripe" },
    label: "Stripe",
  },
  "datadoghq.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "datadog" },
    label: "Datadog",
  },
  "linkedin.com": {
    platformType: "greenhouse",
    platformConfig: { boardName: "linkedin" },
    label: "LinkedIn",
  },

  // Ashby
  "openai.com": {
    platformType: "ashby",
    platformConfig: { orgName: "openai" },
    label: "OpenAI",
  },

  // Workday
  "slack.com": {
    platformType: "workday",
    platformConfig: { tenant: "salesforce", subdomain: "wd12", boardPath: "Slack" },
    label: "Slack",
  },
};

/**
 * Look up a hostname in the ATS registry.
 * Tries exact match first, then includes-based matching.
 */
export function lookupATSRegistry(hostname: string): ATSRegistryEntry | null {
  // Exact match first (most specific)
  if (ATS_REGISTRY[hostname]) {
    return ATS_REGISTRY[hostname];
  }

  // Includes-based match (e.g., "careers.discord.com" matches "discord.com")
  for (const [pattern, entry] of Object.entries(ATS_REGISTRY)) {
    if (hostname.includes(pattern)) {
      return entry;
    }
  }

  return null;
}
