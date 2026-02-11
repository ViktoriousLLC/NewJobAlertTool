import puppeteer from "puppeteer";

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
 * 4. Validate via public API
 * 5. Puppeteer fallback for SPAs
 * 6. Return "generic" if nothing detected
 */
export async function detectPlatform(url: string): Promise<PlatformDetectionResult> {
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

  // 6. Nothing detected → generic Puppeteer scraper
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

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

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
    }

    return null;
  } finally {
    await browser.close();
  }
}

/**
 * Validates a detected Greenhouse board by checking the public API.
 */
export async function validateGreenhouseBoard(boardName: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.greenhouse.io/v1/boards/${boardName}/jobs`, {
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Validates a detected Lever handle by checking the public API.
 */
export async function validateLeverHandle(handle: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${handle}?limit=1&mode=json`, {
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
