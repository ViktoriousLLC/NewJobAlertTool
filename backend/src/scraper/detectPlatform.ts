import puppeteer from "puppeteer";
import { lookupATSRegistry } from "./atsRegistry";

export interface PlatformDetectionResult {
  platformType: string;
  platformConfig: Record<string, string>;
  confidence: "high" | "medium" | "low";
}

/**
 * Detects the ATS platform behind a careers URL.
 *
 * Detection order (fast → slow):
 * 1. Known custom hostnames (no fetch)
 * 2. Direct ATS URLs (no fetch)
 * 3. Fetch HTML + detect embeds
 * 4. Puppeteer fallback for SPAs
 * 5. Speculative API probes (try slug against Greenhouse/Lever APIs)
 * 6. Return "generic" if nothing detected
 */
export async function detectPlatform(url: string, companyName?: string): Promise<PlatformDetectionResult> {
  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // 1. Known custom API companies (no fetch needed)
  const customHosts: Record<string, string> = {
    "atlassian.com": "atlassian",
    "stripe.com": "stripe",
    "uber.com": "uber",
    "google.com": "google",
    "netflix.net": "netflix",
    "netflix.com": "netflix",
    "ea.com": "ea",
  };

  for (const [host, name] of Object.entries(customHosts)) {
    if (hostname.includes(host)) {
      return {
        platformType: "custom_api",
        platformConfig: { company: name },
        confidence: "high",
      };
    }
  }

  // 1b. ATS registry lookup — shared source of truth for known hostname → ATS mappings
  const registryEntry = lookupATSRegistry(hostname);
  if (registryEntry) {
    // Normalize greenhouse_departments → greenhouse for external consumers
    const platformType = registryEntry.platformType === "greenhouse_departments"
      ? "greenhouse"
      : registryEntry.platformType;
    return {
      platformType,
      platformConfig: { ...registryEntry.platformConfig },
      confidence: "high",
    };
  }

  // 2. Direct ATS URLs (no fetch needed)
  // Greenhouse: boards.greenhouse.io/{board}
  if (hostname === "boards.greenhouse.io") {
    const boardName = parsed.pathname.split("/")[1];
    if (boardName) {
      return {
        platformType: "greenhouse",
        platformConfig: { boardName },
        confidence: "high",
      };
    }
  }

  // Lever: jobs.lever.co/{handle}
  if (hostname === "jobs.lever.co") {
    const handle = parsed.pathname.split("/")[1];
    if (handle) {
      return {
        platformType: "lever",
        platformConfig: { handle },
        confidence: "high",
      };
    }
  }

  // Ashby: jobs.ashbyhq.com/{org}
  if (hostname === "jobs.ashbyhq.com") {
    const orgName = parsed.pathname.split("/")[1];
    if (orgName && orgName !== "api") {
      return {
        platformType: "ashby",
        platformConfig: { orgName },
        confidence: "high",
      };
    }
  }

  // Workday: *.myworkdayjobs.com
  if (hostname.endsWith(".myworkdayjobs.com")) {
    // Extract tenant and board path from URL
    // e.g., salesforce.wd12.myworkdayjobs.com → tenant = salesforce, subdomain = wd12
    const parts = hostname.split(".");
    const tenant = parts[0]; // e.g., "salesforce"
    const subdomain = parts[1]; // e.g., "wd12"
    // Board path is derived from the URL path, e.g., /Slack or /en-US/External
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const boardPath = pathParts[0] || "";
    return {
      platformType: "workday",
      platformConfig: { tenant, subdomain, boardPath },
      confidence: "high",
    };
  }

  // SmartRecruiters: jobs.smartrecruiters.com/{company}
  if (hostname === "jobs.smartrecruiters.com") {
    const company = parsed.pathname.split("/")[1];
    if (company) {
      return {
        platformType: "smartrecruiters",
        platformConfig: { company },
        confidence: "high",
      };
    }
  }

  // iCIMS: *.icims.com
  if (hostname.endsWith(".icims.com")) {
    const slug = hostname.replace(/\.icims\.com$/, "").replace(/^careers-/, "");
    return {
      platformType: "icims",
      platformConfig: { company: slug, baseUrl: url },
      confidence: "high",
    };
  }

  // Eightfold: *.eightfold.ai
  if (hostname.endsWith(".eightfold.ai")) {
    return {
      platformType: "eightfold",
      platformConfig: { careersUrl: url },
      confidence: "high",
    };
  }

  // 3. Fetch HTML and detect embedded ATS
  try {
    const result = await detectFromHTML(url);
    if (result) return result;
  } catch (err) {
    console.log(`Platform detection: HTML fetch failed for ${url}:`, err);
  }

  // 5. Puppeteer fallback for SPAs that render embeds via JS
  try {
    const result = await detectWithPuppeteer(url);
    if (result) return result;
  } catch (err) {
    console.log(`Platform detection: Puppeteer fallback failed for ${url}:`, err);
  }

  // 6. Speculative API probes — try the company slug against Greenhouse/Lever APIs.
  // Catches custom-domain companies backed by these ATS (e.g., careers.twitch.com → Greenhouse "twitch")
  try {
    const result = await probeATSApis(hostname, companyName);
    if (result) return result;
  } catch (err) {
    console.log(`Platform detection: API probe failed for ${url}:`, err);
  }

  // 7. Nothing detected → generic Puppeteer scraper
  return {
    platformType: "generic",
    platformConfig: {},
    confidence: "low",
  };
}

/**
 * Fetches HTML and looks for ATS embed signatures.
 */
async function detectFromHTML(url: string): Promise<PlatformDetectionResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!res.ok) return null;
    const html = await res.text();
    return parseHTMLForATS(html);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parses HTML content for known ATS embed patterns.
 */
function parseHTMLForATS(html: string): PlatformDetectionResult | null {
  // Greenhouse embeds
  const ghEmbedMatch = html.match(/boards\.greenhouse\.io\/embed\/job_board\/js\?for=([a-zA-Z0-9_-]+)/);
  if (ghEmbedMatch) {
    return {
      platformType: "greenhouse",
      platformConfig: { boardName: ghEmbedMatch[1] },
      confidence: "high",
    };
  }

  const ghAppMatch = html.match(/id=["']grnhse_app["']/);
  const ghBoardFromLink = html.match(/boards\.greenhouse\.io\/([a-zA-Z0-9_-]+)\/jobs/);
  if (ghAppMatch && ghBoardFromLink) {
    return {
      platformType: "greenhouse",
      platformConfig: { boardName: ghBoardFromLink[1] },
      confidence: "high",
    };
  }

  // Also detect Greenhouse from plain links (e.g., job listing links pointing to greenhouse)
  const ghLinkMatch = html.match(/href=["'][^"']*boards\.greenhouse\.io\/([a-zA-Z0-9_-]+)/);
  if (ghLinkMatch) {
    return {
      platformType: "greenhouse",
      platformConfig: { boardName: ghLinkMatch[1] },
      confidence: "medium",
    };
  }

  // Greenhouse via gh_jid query parameter (companies using custom frontends like Consider)
  const ghJidMatch = html.match(/href=["'][^"']*[?&]gh_jid=\d+/);
  if (ghJidMatch) {
    // Try to extract board name from the link's domain
    const ghLinkDomainMatch = html.match(/href=["'](https?:\/\/[^"']+[?&]gh_jid=\d+)/);
    if (ghLinkDomainMatch) {
      try {
        const linkUrl = new URL(ghLinkDomainMatch[1]);
        // Use the SLD (second-level domain) as board name guess
        // e.g. a16z.com → "a16z", stripe.com → "stripe"
        const parts = linkUrl.hostname.replace(/^www\./, "").split(".");
        const boardGuess = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        return {
          platformType: "greenhouse",
          platformConfig: { boardName: boardGuess },
          confidence: "medium",
        };
      } catch {
        // URL parse failed, skip
      }
    }
  }

  // Lever embeds
  const leverMatch = html.match(/jobs\.lever\.co\/([a-zA-Z0-9_-]+)/);
  if (leverMatch) {
    return {
      platformType: "lever",
      platformConfig: { handle: leverMatch[1] },
      confidence: "high",
    };
  }

  const leverContainer = html.match(/id=["']lever-jobs-container["']/);
  if (leverContainer) {
    // Try to find the handle from nearby links
    const leverHandleMatch = html.match(/lever\.co\/([a-zA-Z0-9_-]+)/);
    if (leverHandleMatch) {
      return {
        platformType: "lever",
        platformConfig: { handle: leverHandleMatch[1] },
        confidence: "medium",
      };
    }
  }

  // Ashby embeds
  const ashbyMatch = html.match(/jobs\.ashbyhq\.com\/([a-zA-Z0-9_-]+)/);
  if (ashbyMatch && ashbyMatch[1] !== "api") {
    return {
      platformType: "ashby",
      platformConfig: { orgName: ashbyMatch[1] },
      confidence: "high",
    };
  }

  // Workday embeds (iframes or links)
  const workdayMatch = html.match(/([a-zA-Z0-9_-]+)\.(wd\d+)\.myworkdayjobs\.com/);
  if (workdayMatch) {
    // Try to extract the board path from the URL
    const boardPathMatch = html.match(
      new RegExp(`${workdayMatch[1]}\\.${workdayMatch[2]}\\.myworkdayjobs\\.com\\/(?:wday\\/cxs\\/[^/]+\\/)?([a-zA-Z0-9_-]+)`)
    );
    return {
      platformType: "workday",
      platformConfig: {
        tenant: workdayMatch[1],
        subdomain: workdayMatch[2],
        boardPath: boardPathMatch?.[1] || "",
      },
      confidence: "medium",
    };
  }

  // SmartRecruiters embeds
  const srMatch = html.match(/jobs\.smartrecruiters\.com\/([a-zA-Z0-9._-]+)/);
  if (srMatch) {
    return {
      platformType: "smartrecruiters",
      platformConfig: { company: srMatch[1] },
      confidence: "high",
    };
  }

  const srApiMatch = html.match(/api\.smartrecruiters\.com\/v1\/companies\/([a-zA-Z0-9._-]+)/);
  if (srApiMatch) {
    return {
      platformType: "smartrecruiters",
      platformConfig: { company: srApiMatch[1] },
      confidence: "high",
    };
  }

  // iCIMS embeds
  const icimsMatch = html.match(/([a-zA-Z0-9_-]+)\.icims\.com/);
  if (icimsMatch) {
    const slug = icimsMatch[1].replace(/^careers-/, "");
    return {
      platformType: "icims",
      platformConfig: { company: slug, baseUrl: `https://${icimsMatch[0]}` },
      confidence: "medium",
    };
  }

  // Eightfold embeds
  const eightfoldMatch = html.match(/([a-zA-Z0-9_-]+)\.eightfold\.ai/);
  if (eightfoldMatch) {
    // Reconstruct the base eightfold URL
    const eightfoldUrl = `https://${eightfoldMatch[1]}.eightfold.ai`;
    return {
      platformType: "eightfold",
      platformConfig: { careersUrl: eightfoldUrl },
      confidence: "medium",
    };
  }

  return null;
}

/**
 * Uses Puppeteer to load the page (catches SPA-rendered embeds)
 * and re-checks for ATS signatures in the rendered DOM.
 */
async function detectWithPuppeteer(url: string): Promise<PlatformDetectionResult | null> {
  console.log(`Platform detection: Trying Puppeteer for ${url}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Network request interception: catch client-side API calls to ATS backends
    const networkDetections: PlatformDetectionResult[] = [];
    page.on("request", (request) => {
      if (networkDetections.length > 0) return; // Already found one
      const reqUrl = request.url();
      matchATSNetworkRequest(reqUrl, (result) => {
        networkDetections.push(result);
      });
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Check network interception results first (highest signal — actual API calls)
    if (networkDetections.length > 0) {
      const detected = networkDetections[0];
      console.log(`Platform detection: Network interception detected ${detected.platformType}`);
      return detected;
    }

    const html = await page.content();
    const result = parseHTMLForATS(html);
    if (result) {
      // Upgrade confidence since we confirmed via full render
      return result;
    }

    // Also check for iframes that might contain ATS
    const iframeSrcs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("iframe[src]"))
        .map((iframe) => iframe.getAttribute("src") || "")
        .filter((src) => src.length > 0);
    });

    for (const src of iframeSrcs) {
      if (src.includes("boards.greenhouse.io")) {
        const match = src.match(/boards\.greenhouse\.io\/([a-zA-Z0-9_-]+)/);
        if (match) {
          return {
            platformType: "greenhouse",
            platformConfig: { boardName: match[1] },
            confidence: "medium",
          };
        }
      }
      if (src.includes("jobs.lever.co")) {
        const match = src.match(/jobs\.lever\.co\/([a-zA-Z0-9_-]+)/);
        if (match) {
          return {
            platformType: "lever",
            platformConfig: { handle: match[1] },
            confidence: "medium",
          };
        }
      }
      if (src.includes("ashbyhq.com")) {
        const match = src.match(/jobs\.ashbyhq\.com\/([a-zA-Z0-9_-]+)/);
        if (match && match[1] !== "api") {
          return {
            platformType: "ashby",
            platformConfig: { orgName: match[1] },
            confidence: "medium",
          };
        }
      }
      if (src.includes("smartrecruiters.com")) {
        const match = src.match(/jobs\.smartrecruiters\.com\/([a-zA-Z0-9._-]+)/);
        if (match) {
          return {
            platformType: "smartrecruiters",
            platformConfig: { company: match[1] },
            confidence: "medium",
          };
        }
      }
      if (src.includes("icims.com")) {
        const match = src.match(/([a-zA-Z0-9_-]+)\.icims\.com/);
        if (match) {
          const slug = match[1].replace(/^careers-/, "");
          return {
            platformType: "icims",
            platformConfig: { company: slug, baseUrl: `https://${match[0]}` },
            confidence: "medium",
          };
        }
      }
    }

    return null;
  } finally {
    await browser.close();
  }
}

/**
 * Matches a network request URL against known ATS API patterns.
 * Calls `onMatch` with the detection result if a match is found.
 */
function matchATSNetworkRequest(
  reqUrl: string,
  onMatch: (result: PlatformDetectionResult) => void
): void {
  // Greenhouse API: api.greenhouse.io/v1/boards/{slug}/*
  const ghApiMatch = reqUrl.match(/api\.greenhouse\.io\/v1\/boards\/([a-zA-Z0-9_-]+)/);
  if (ghApiMatch) {
    onMatch({
      platformType: "greenhouse",
      platformConfig: { boardName: ghApiMatch[1] },
      confidence: "high",
    });
    return;
  }

  // Greenhouse embed: boards.greenhouse.io/embed/job_board/js?for={slug}
  const ghEmbedMatch = reqUrl.match(/boards\.greenhouse\.io\/embed\/job_board\/js\?for=([a-zA-Z0-9_-]+)/);
  if (ghEmbedMatch) {
    onMatch({
      platformType: "greenhouse",
      platformConfig: { boardName: ghEmbedMatch[1] },
      confidence: "high",
    });
    return;
  }

  // Lever API: api.lever.co/v0/postings/{handle}/*
  const leverMatch = reqUrl.match(/api\.lever\.co\/v0\/postings\/([a-zA-Z0-9_-]+)/);
  if (leverMatch) {
    onMatch({
      platformType: "lever",
      platformConfig: { handle: leverMatch[1] },
      confidence: "high",
    });
    return;
  }

  // Ashby API: jobs.ashbyhq.com/api/*
  const ashbyMatch = reqUrl.match(/jobs\.ashbyhq\.com\/api\/.*organizationHostedJobsPageName.*?[=:]"?([a-zA-Z0-9_-]+)/);
  if (ashbyMatch) {
    onMatch({
      platformType: "ashby",
      platformConfig: { orgName: ashbyMatch[1] },
      confidence: "high",
    });
    return;
  }

  // Workday API: *.myworkdayjobs.com/wday/cxs/*
  const workdayMatch = reqUrl.match(/([a-zA-Z0-9_-]+)\.(wd\d+)\.myworkdayjobs\.com\/wday\/cxs\/[^/]+\/([a-zA-Z0-9_-]+)/);
  if (workdayMatch) {
    onMatch({
      platformType: "workday",
      platformConfig: {
        tenant: workdayMatch[1],
        subdomain: workdayMatch[2],
        boardPath: workdayMatch[3],
      },
      confidence: "high",
    });
    return;
  }

  // SmartRecruiters API: api.smartrecruiters.com/v1/companies/{company}/*
  const srApiMatch = reqUrl.match(/api\.smartrecruiters\.com\/v1\/companies\/([a-zA-Z0-9._-]+)/);
  if (srApiMatch) {
    onMatch({
      platformType: "smartrecruiters",
      platformConfig: { company: srApiMatch[1] },
      confidence: "high",
    });
    return;
  }

  // iCIMS: *.icims.com/jobs/*
  const icimsMatch = reqUrl.match(/([a-zA-Z0-9_-]+)\.icims\.com\/jobs\//);
  if (icimsMatch) {
    const slug = icimsMatch[1].replace(/^careers-/, "");
    onMatch({
      platformType: "icims",
      platformConfig: { company: slug, baseUrl: `https://${icimsMatch[1]}.icims.com` },
      confidence: "high",
    });
    return;
  }
}

/**
 * Extracts candidate ATS slugs from a hostname and optional company name.
 * Generates multiple slug variants for speculative API probes.
 *
 * e.g., hostname "careers.twitch.com" → ["twitch"]
 *       hostname "razorpay.com", name "Razorpay" → ["razorpay", "razorpay-inc", "razorpayinc", ...]
 */
function extractCandidateSlugs(hostname: string, companyName?: string): string[] {
  const CAREER_PREFIXES = ["careers", "jobs", "www", "work", "hiring", "join", "apply", "hire"];
  const slugs: string[] = [];

  // From hostname: strip common career-site subdomain prefixes
  const parts = hostname.split(".");
  const prefix = parts[0];

  if (parts.length >= 3 && CAREER_PREFIXES.includes(prefix)) {
    slugs.push(parts[1]);
  } else if (parts.length >= 2) {
    slugs.push(parts[parts.length - 2]);
  }

  // From company name: generate additional slug variants
  if (companyName) {
    const base = companyName.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim();
    const noSpaces = base.replace(/\s+/g, "");
    const hyphenated = base.replace(/\s+/g, "-");

    slugs.push(noSpaces);
    if (noSpaces !== hyphenated) slugs.push(hyphenated);

    // Common corporate suffixes
    const SUFFIXES = ["inc", "co", "hq", "software", "tech", "labs", "io", "app"];
    for (const suffix of SUFFIXES) {
      slugs.push(`${noSpaces}${suffix}`);
      slugs.push(`${noSpaces}-${suffix}`);
    }
  }

  return [...new Set(slugs.filter(Boolean))];
}

/**
 * Cross-checks an ATS probe hit to prevent false positives.
 * Compares the company name returned by the ATS API against the slug we probed with.
 * Returns true if the names plausibly match (i.e., the slug is contained in the ATS name
 * or vice versa), false if it looks like a different company.
 *
 * e.g., slug "aha", ATS name "Animal Health Associates" → false (different company)
 *       slug "twitch", ATS name "Twitch" → true
 *       slug "doordashusa", ATS name "DoorDash" → true
 */
function isProbeNameMatch(slug: string, atsCompanyName: string): boolean {
  const normalizedSlug = slug.toLowerCase().replace(/[-_]/g, "");
  const normalizedAts = atsCompanyName.toLowerCase().replace(/[-_]/g, "");

  // Direct containment: slug in ATS name or ATS name in slug
  if (normalizedAts.includes(normalizedSlug) || normalizedSlug.includes(normalizedAts)) {
    return true;
  }

  // Also check the ATS name with spaces removed (e.g., "Door Dash" → "doordash")
  const atsNoSpaces = normalizedAts.replace(/\s+/g, "");
  if (atsNoSpaces.includes(normalizedSlug) || normalizedSlug.includes(atsNoSpaces)) {
    return true;
  }

  // Check initials/acronym: "Animal Health Associates" → "aha"
  // Only trust this for slugs of 4+ chars to avoid false positives on short acronyms
  if (normalizedSlug.length >= 4) {
    const words = atsCompanyName.toLowerCase().split(/\s+/).filter(Boolean);
    const initials = words.map((w) => w[0]).join("");
    if (initials === normalizedSlug) return true;
  }

  return false;
}

/**
 * Probes Greenhouse, Lever, SmartRecruiters, and Ashby public APIs with candidate slugs
 * derived from the hostname. If an API responds, cross-checks the returned company name
 * against the slug to prevent false positives.
 */
async function probeATSApis(hostname: string, companyName?: string): Promise<PlatformDetectionResult | null> {
  const slugs = extractCandidateSlugs(hostname, companyName);
  if (slugs.length === 0) return null;

  console.log(`Platform detection: Probing ATS APIs with slugs: ${slugs.join(", ")}`);

  // Probe all slugs in parallel (Greenhouse + Lever + SmartRecruiters + Ashby for each)
  const probeResults = await Promise.all(
    slugs.map(async (slug) => {
      const [ghName, leverName, srName, ashbyName] = await Promise.all([
        validateGreenhouseBoard(slug),
        validateLeverHandle(slug),
        validateSmartRecruitersCompany(slug),
        validateAshbyOrg(slug),
      ]);
      return { slug, ghName, leverName, srName, ashbyName };
    })
  );

  for (const { slug, ghName, leverName, srName, ashbyName } of probeResults) {
    if (ghName) {
      if (isProbeNameMatch(slug, ghName)) {
        console.log(`Platform detection: Greenhouse API probe hit for "${slug}" (name: "${ghName}")`);
        return {
          platformType: "greenhouse",
          platformConfig: { boardName: slug },
          confidence: "medium",
        };
      } else {
        console.log(`Platform detection: Greenhouse probe "${slug}" rejected — ATS name "${ghName}" doesn't match`);
      }
    }
    if (leverName) {
      console.log(`Platform detection: Lever API probe hit for "${slug}"`);
      return {
        platformType: "lever",
        platformConfig: { handle: slug },
        confidence: "medium",
      };
    }
    if (srName) {
      if (isProbeNameMatch(slug, srName)) {
        console.log(`Platform detection: SmartRecruiters API probe hit for "${slug}" (name: "${srName}")`);
        return {
          platformType: "smartrecruiters",
          platformConfig: { company: slug },
          confidence: "medium",
        };
      } else {
        console.log(`Platform detection: SmartRecruiters probe "${slug}" rejected — ATS name "${srName}" doesn't match`);
      }
    }
    if (ashbyName) {
      console.log(`Platform detection: Ashby API probe hit for "${slug}"`);
      return {
        platformType: "ashby",
        platformConfig: { orgName: slug },
        confidence: "medium",
      };
    }
  }

  return null;
}

/**
 * Validates a detected Greenhouse board by checking the public API.
 * Returns the board's company name if valid, or null if not.
 */
export async function validateGreenhouseBoard(boardName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.greenhouse.io/v1/boards/${boardName}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.name || boardName;
  } catch {
    return null;
  }
}

/**
 * Validates a detected Lever handle by checking the public API.
 * Returns the handle as company name if valid, or null if not.
 */
export async function validateLeverHandle(handle: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${handle}?limit=1&mode=json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return handle;
  } catch {
    return null;
  }
}

/**
 * Validates a SmartRecruiters company slug by checking the public API.
 * Returns the company name if valid, or null if not.
 */
export async function validateSmartRecruitersCompany(company: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=1`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.totalFound <= 0) return null;
    // Try to extract company name from first posting
    return data.content?.[0]?.company?.name || company;
  } catch {
    return null;
  }
}

/**
 * Validates an Ashby org slug by checking the GraphQL API.
 * Returns the org slug as name if valid, or null if not.
 */
export async function validateAshbyOrg(orgName: string): Promise<string | null> {
  try {
    const res = await fetch(
      "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationName: "ApiJobBoardWithTeams",
          variables: { organizationHostedJobsPageName: orgName },
          query: `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
            jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
              teams { id __typename }
              __typename
            }
          }`,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data?.jobBoard?.teams) return null;
    return orgName;
  } catch {
    return null;
  }
}

/**
 * Broad ATS discovery — used as a fallback when generic scraper returns 0 jobs.
 * Tries legal entity suffixes (pvtltd, privatelimited, etc.) to find ATS boards
 * where the slug is the full legal entity name (e.g., "razorpaysoftwareprivatelimited").
 *
 * Only probes Greenhouse and Lever since they have public APIs.
 */
export async function broadATSDiscovery(
  url: string,
  companyName?: string
): Promise<PlatformDetectionResult | null> {
  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // Derive company name from URL if not provided
  const { detectCompanyName } = await import("./detectCompanyName");
  const name = companyName || detectCompanyName(url, null, null);

  const base = name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim();
  const noSpaces = base.replace(/\s+/g, "");

  // Also extract hostname-based slug
  const CAREER_PREFIXES = ["careers", "jobs", "www", "work", "hiring", "join", "apply", "hire"];
  const parts = hostname.split(".");
  let hostSlug = parts[parts.length - 2] || "";
  if (parts.length >= 3 && CAREER_PREFIXES.includes(parts[0])) {
    hostSlug = parts[1];
  }

  // Legal entity suffixes commonly used in ATS board names
  const LEGAL_SUFFIXES = [
    "pvtltd", "privatelimited", "softwareprivatelimited",
    "technologiesprivatelimited", "technologyprivatelimited",
    "llc", "corp", "corporation", "limited", "ltd",
    "gmbh", "bv", "srl", "sarl", "ag",
    "global", "international", "worldwide",
    "careers", "jobs", "hiring",
  ];

  const slugs = new Set<string>();

  // Generate slug candidates from company name + legal suffixes
  for (const suffix of LEGAL_SUFFIXES) {
    slugs.add(`${noSpaces}${suffix}`);
    slugs.add(`${noSpaces}-${suffix}`);
    if (hostSlug && hostSlug !== noSpaces) {
      slugs.add(`${hostSlug}${suffix}`);
      slugs.add(`${hostSlug}-${suffix}`);
    }
  }

  // Also try base slugs without suffixes (in case standard probing missed them)
  slugs.add(noSpaces);
  if (hostSlug) slugs.add(hostSlug);

  const slugArray = [...slugs].filter(Boolean);
  console.log(`Broad ATS discovery: Probing ${slugArray.length} slug candidates for "${name}"`);

  // Probe in batches of 10 to avoid overwhelming APIs
  const BATCH_SIZE = 10;
  for (let i = 0; i < slugArray.length; i += BATCH_SIZE) {
    const batch = slugArray.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (slug) => {
        const [ghName, leverName, srName, ashbyName] = await Promise.all([
          validateGreenhouseBoard(slug),
          validateLeverHandle(slug),
          validateSmartRecruitersCompany(slug),
          validateAshbyOrg(slug),
        ]);
        return { slug, ghName, leverName, srName, ashbyName };
      })
    );

    for (const { slug, ghName, leverName, srName, ashbyName } of results) {
      if (ghName && isProbeNameMatch(slug, ghName)) {
        console.log(`Broad ATS discovery: Greenhouse hit for "${slug}" (name: "${ghName}")`);
        return {
          platformType: "greenhouse",
          platformConfig: { boardName: slug },
          confidence: "medium" as const,
        };
      }
      if (leverName) {
        console.log(`Broad ATS discovery: Lever hit for "${slug}"`);
        return {
          platformType: "lever",
          platformConfig: { handle: slug },
          confidence: "medium" as const,
        };
      }
      if (srName && isProbeNameMatch(slug, srName)) {
        console.log(`Broad ATS discovery: SmartRecruiters hit for "${slug}" (name: "${srName}")`);
        return {
          platformType: "smartrecruiters",
          platformConfig: { company: slug },
          confidence: "medium" as const,
        };
      }
      if (ashbyName) {
        console.log(`Broad ATS discovery: Ashby hit for "${slug}"`);
        return {
          platformType: "ashby",
          platformConfig: { orgName: slug },
          confidence: "medium" as const,
        };
      }
    }
  }

  console.log(`Broad ATS discovery: No ATS found for "${name}"`);
  return null;
}
