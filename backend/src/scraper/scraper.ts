import puppeteer, { Page } from "puppeteer";
import { lookupATSRegistry } from "./atsRegistry";

export interface ScrapedJob {
  title: string;
  location: string;
  urlPath: string;
}

/**
 * Out-param scrapers can write to so the cron knows how many raw jobs the
 * source returned BEFORE PM_KEYWORDS filtering. Used by dailyCheck to decide
 * whether to run stealth fallback: if a scraper saw 50 jobs and just had no
 * PMs, that's a legitimate zero — no point running Puppeteer-with-stealth.
 *
 * Filter-heavy scrapers (Greenhouse, Workday, Ashby, Eightfold) set this.
 * Other scrapers leave it at 0; dailyCheck falls back to checking jobs.length.
 */
export interface ScrapeStats {
  totalScanned: number;
}

/**
 * Canonical Windows Chrome/120 User-Agent. Used for all server-side scraper
 * fetches except: Apple (Mac UA at jobs.apple.com), Goldman/Revolut (Chrome/124
 * — intentional fingerprint match for those specific APIs).
 */
const SCRAPER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * iCIMS deployments that expose a public `/api/jobs` REST endpoint. These
 * companies have `platform_type='icims'` in the DB but their baseUrl points at
 * a custom domain (not `*.icims.com`) that serves clean JSON via the public
 * iCIMS API. Routing them through `scrapeICIMSAPICareers` skips the Puppeteer
 * scraper, which only knows the legacy iCIMS template — not the modern Jibe
 * SPA used by most current iCIMS tenants. DEV-18.
 */
const ICIMS_API_HOSTS = [
  "careers.rivian.com",
  "careers.costco.com",
];

/**
 * Known ATS hosts whose URL paths embed the company slug (e.g.
 * api.greenhouse.io/v1/boards/{slug}). For these, a cross-domain sniff is
 * legitimate — inferPlatformFromSniffedUrl re-anchors the data to the right
 * company via the slug. For non-ATS hosts, a cross-domain sniff usually means
 * a redirect to a parent/acquired company's careers page, and the sniffed
 * jobs do not belong to the company we're scraping.
 */
const KNOWN_ATS_SNIFF_HOSTS = new Set([
  "api.greenhouse.io",
  "boards-api.greenhouse.io",
  "api.lever.co",
  "api.ashbyhq.com",
  "api.smartrecruiters.com",
]);

/**
 * Returns true if the sniffed URL is on a different registrable domain than
 * the company's careers URL AND isn't a known ATS host. Used by
 * stealthFallbackScrape to reject buckets that belong to a parent company.
 *
 * Example: careersUrl=https://neon.com/careers, sniffedUrl=https://www.databricks.com/...
 *   → true (Databricks acquired Neon; careers page redirected; their data is
 *   not Neon's data).
 *
 * Example: careersUrl=https://jobs.shopify.com, sniffedUrl=https://api.greenhouse.io/v1/boards/shopify/...
 *   → false (Greenhouse host, slug=shopify embedded in path — legitimate ATS sniff).
 */
function isCrossCompanySniff(careersUrl: string, sniffedUrl: string): boolean {
  try {
    const careersHost = new URL(careersUrl).hostname.replace(/^www\./, "");
    const sniffedHost = new URL(sniffedUrl).hostname.replace(/^www\./, "");
    if (careersHost === sniffedHost) return false;
    // Same registrable domain (eTLD+1 approximation — last 2 labels).
    const careersBase = careersHost.split(".").slice(-2).join(".");
    const sniffedBase = sniffedHost.split(".").slice(-2).join(".");
    if (careersBase === sniffedBase) return false;
    // Known ATS hosts re-anchor via slug in path.
    if (KNOWN_ATS_SNIFF_HOSTS.has(sniffedHost)) return false;
    return true;
  } catch {
    return true;
  }
}

const JOB_URL_RE =
  /\/jobs\/[a-z0-9][\w-]{1,}|\/job\/[a-z0-9][\w-]{1,}|\/positions\/[a-z0-9][\w-]{1,}|\/position\/[a-z0-9][\w-]{1,}|\/careers\/[a-z0-9][\w-]{1,}|\/openings\/[a-z0-9][\w-]{1,}|\/roles\/[a-z0-9][\w-]{1,}|\/postings\/[a-z0-9][\w-]{1,}/;

const SKIP_PATHS_RE =
  /\/(search|departments|locations|teams|categories|benefits|culture|about|faq)(\/|$|\?)/;

/**
 * Shared logic to parse a single job link element into title + location.
 * Runs inside page.evaluate (browser context).
 */
function parseJobLinkInBrowser(link: Element, baseUrl: string) {
  const href = link.getAttribute("href") || "";
  const lowerHref = href.toLowerCase();

  const jobRe =
    /\/jobs\/[a-z0-9][\w-]{1,}|\/job\/[a-z0-9][\w-]{1,}|\/positions\/[a-z0-9][\w-]{1,}|\/position\/[a-z0-9][\w-]{1,}|\/careers\/[a-z0-9][\w-]{1,}|\/openings\/[a-z0-9][\w-]{1,}|\/roles\/[a-z0-9][\w-]{1,}|\/postings\/[a-z0-9][\w-]{1,}/;
  const skipRe =
    /\/(search|departments|locations|teams|categories|benefits|culture|about|faq)(\/|$|\?)/;

  if (!jobRe.test(lowerHref) || skipRe.test(lowerHref)) return null;

  let urlPath: string;
  try {
    const fullUrl = new URL(href, baseUrl);
    // Always use the full URL to ensure consistent deduplication
    urlPath = fullUrl.href;
  } catch {
    return null;
  }

  // Try to extract structured title + location from child elements
  const children = Array.from(link.children);
  let title = "";
  let location = "";

  if (children.length >= 2) {
    // First meaningful child = title, remaining = location/details
    const firstChild = children[0];
    title = (firstChild.textContent || "").trim();

    // For location, check last child or second child
    // Skip children that are just action buttons ("Apply", etc.)
    const detailChildren = children.slice(1).filter((c) => {
      const t = (c.textContent || "").trim().toLowerCase();
      return t !== "apply" && t !== "apply now" && t.length > 0;
    });

    if (detailChildren.length > 0) {
      // Use the last non-action child's text as location
      const locText = (detailChildren[detailChildren.length - 1].textContent || "").trim();
      location = locText;
    }
  } else {
    // No structured children — use full text and we'll clean it up later
    title = (link.textContent || "").trim();
  }

  if (!title || title.length < 3) return null;

  // Clean up location: remove trailing department labels (may be concatenated without space)
  location = location
    .replace(/(Product|Engineering|Design|Marketing|Sales|Finance|Legal|Operations|Security)\s*$/i, "")
    .replace(/Product Management\s*$/i, "")
    .trim();

  // Clean up title: remove "Apply" / department labels that got concatenated
  title = title
    .replace(/Apply(?:\s+now)?$/i, "")
    .replace(/Product Management$/i, "")
    .trim();

  // If location is still stuck in the title, try to split on a known city pattern
  if (!location) {
    const cityMatch = title.match(
      /(.+?)(?=San Francisco|San Mateo|New York|London|Seattle|Washington|Remote|Tokyo|Dublin|Sydney|Munich|Boston|Singapore|Paris|Berlin|Zurich|Toronto|Austin|Chicago|Los Angeles)/
    );
    if (cityMatch && cityMatch[1].trim().length > 5) {
      const splitIdx = cityMatch[0].length;
      location = title.substring(splitIdx).replace(/Apply(?:\s+now)?$/i, "").trim();
      title = cityMatch[1].trim();
    }
  }

  // Clean trailing separators
  location = location.replace(/^[;|,\s]+/, "").replace(/[;|,\s]+$/, "").trim();
  title = title.replace(/[;|,\s]+$/, "").trim();

  return { title, location, urlPath };
}

async function extractJobsFromProductSections(
  page: Page,
  baseUrl: string
): Promise<ScrapedJob[] | null> {
  return page.evaluate(
    (baseUrl: string, parseFnStr: string) => {
      const parseFn = new Function("link", "baseUrl", `return (${parseFnStr})(link, baseUrl)`) as (
        link: Element,
        baseUrl: string
      ) => { title: string; location: string; urlPath: string } | null;

      const headings = Array.from(
        document.querySelectorAll("h2, h3, h4, [role='heading']")
      );

      let productHeadings = headings.filter((h) => {
        const text = (h.textContent || "").trim().toLowerCase();
        return /\bproduct\b/.test(text) && !/\bproduction\b/.test(text);
      });

      if (productHeadings.length === 0) return null;

      const primaryProductHeadings = productHeadings.filter((h) => {
        const text = (h.textContent || "").trim().toLowerCase();
        return /^product\b/.test(text);
      });

      if (primaryProductHeadings.length > 0) {
        productHeadings = primaryProductHeadings;
      }

      const jobs: { title: string; location: string; urlPath: string }[] = [];
      const seen = new Set<string>();

      for (const heading of productHeadings) {
        let container = heading.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!container) break;
          const links = container.querySelectorAll("a[href]");
          const jobRe =
            /\/jobs\/[a-z0-9][\w-]{1,}|\/job\/[a-z0-9][\w-]{1,}|\/positions\/[a-z0-9][\w-]{1,}|\/position\/[a-z0-9][\w-]{1,}|\/careers\/[a-z0-9][\w-]{1,}|\/openings\/[a-z0-9][\w-]{1,}|\/roles\/[a-z0-9][\w-]{1,}|\/postings\/[a-z0-9][\w-]{1,}/;
          const jobLinks = Array.from(links).filter((a) =>
            jobRe.test((a.getAttribute("href") || "").toLowerCase())
          );

          if (jobLinks.length > 0) {
            const headingsInContainer = container.querySelectorAll(heading.tagName);
            const productHeadingsInContainer = Array.from(headingsInContainer).filter((h) =>
              /\bproduct\b/.test((h.textContent || "").trim().toLowerCase())
            );

            if (
              headingsInContainer.length > 1 &&
              productHeadingsInContainer.length < headingsInContainer.length
            ) {
              container = container.parentElement;
              continue;
            }

            for (const link of jobLinks) {
              const parsed = parseFn(link, baseUrl);
              if (!parsed) continue;
              if (seen.has(parsed.urlPath)) continue;
              seen.add(parsed.urlPath);
              jobs.push(parsed);
            }
            break;
          }
          container = container.parentElement;
        }
      }

      return jobs.length > 0 ? jobs : null;
    },
    baseUrl,
    parseJobLinkInBrowser.toString()
  );
}

async function extractAllJobsFromPage(
  page: Page,
  baseUrl: string
): Promise<ScrapedJob[]> {
  return page.evaluate(
    (baseUrl: string, parseFnStr: string) => {
      const parseFn = new Function("link", "baseUrl", `return (${parseFnStr})(link, baseUrl)`) as (
        link: Element,
        baseUrl: string
      ) => { title: string; location: string; urlPath: string } | null;

      const links = Array.from(document.querySelectorAll("a[href]"));
      const jobs: { title: string; location: string; urlPath: string }[] = [];
      const seen = new Set<string>();

      for (const link of links) {
        const parsed = parseFn(link, baseUrl);
        if (!parsed) continue;
        if (seen.has(parsed.urlPath)) continue;
        seen.add(parsed.urlPath);
        jobs.push(parsed);
      }

      return jobs;
    },
    baseUrl,
    parseJobLinkInBrowser.toString()
  );
}

/**
 * Fallback Phase 3: Extract jobs from JSON-LD structured data (Schema.org JobPosting).
 * Many career pages include machine-readable job data in <script type="application/ld+json">.
 */
async function extractJobsFromJsonLd(
  page: Page,
  baseUrl: string
): Promise<ScrapedJob[]> {
  return page.evaluate((baseUrl: string) => {
    const scripts = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    );

    const jobs: { title: string; location: string; urlPath: string }[] = [];
    const seen = new Set<string>();

    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || "");
        // Handle both single objects and arrays
        const items = Array.isArray(data) ? data : data["@graph"] || [data];

        for (const item of items) {
          if (item["@type"] !== "JobPosting") continue;

          const title = (item.title || "").trim();
          if (!title || title.length < 3) continue;

          let urlPath = item.url || "";
          if (!urlPath) continue;
          try {
            urlPath = new URL(urlPath, baseUrl).href;
          } catch {
            continue;
          }

          if (seen.has(urlPath)) continue;
          seen.add(urlPath);

          // Extract location from jobLocation
          let location = "";
          const loc = item.jobLocation;
          if (loc) {
            const locations = Array.isArray(loc) ? loc : [loc];
            const parts: string[] = [];
            for (const l of locations) {
              const addr = l.address || l;
              const city = addr.addressLocality || "";
              const state = addr.addressRegion || "";
              const country = addr.addressCountry?.name || addr.addressCountry || "";
              const locStr = [city, state, country].filter(Boolean).join(", ");
              if (locStr) parts.push(locStr);
            }
            location = parts.join(" | ");
          }

          jobs.push({ title, location, urlPath });
        }
      } catch {
        // Invalid JSON, skip
      }
    }

    return jobs;
  }, baseUrl);
}

/**
 * Fallback Phase 4: Broader URL matching including query-param-based job URLs.
 * Catches patterns like ?gh_jid=, ?job_id=, ?id=, plus /apply/, /vacancies/, /opportunity/.
 */
async function extractJobsFromBroadUrlMatch(
  page: Page,
  baseUrl: string
): Promise<ScrapedJob[]> {
  return page.evaluate((baseUrl: string) => {
    // Broader URL patterns (path-based + query-param-based)
    const broadPathRe = /\/(?:apply|vacancies|vacancy|opportunity|opportunities|requisition|job-detail|jobdetail)\/[a-z0-9][\w-]{1,}/i;
    const jobQueryRe = /[?&](?:gh_jid|job_id|jid|requisitionId|req_id|position_id|opening_id)=\w+/i;

    const skipRe = /\/(search|departments|locations|teams|categories|benefits|culture|about|faq)(\/|$|\?)/;

    const links = Array.from(document.querySelectorAll("a[href]"));
    const jobs: { title: string; location: string; urlPath: string }[] = [];
    const seen = new Set<string>();

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (!href) continue;

      const matchesPath = broadPathRe.test(href);
      const matchesQuery = jobQueryRe.test(href);
      if (!matchesPath && !matchesQuery) continue;
      if (skipRe.test(href)) continue;

      let urlPath: string;
      try {
        urlPath = new URL(href, baseUrl).href;
      } catch {
        continue;
      }

      if (seen.has(urlPath)) continue;
      seen.add(urlPath);

      // Extract title from link text or nearby heading
      let title = (link.textContent || "").trim();
      if (!title || title.length < 3 || title.toLowerCase() === "apply" || title.toLowerCase() === "apply now") {
        // Look for a heading sibling or parent's heading
        const parent = link.closest("[class*='job'], [class*='role'], [class*='position'], [class*='listing'], li, article, tr");
        if (parent) {
          const heading = parent.querySelector("h1, h2, h3, h4, [class*='title']");
          if (heading) title = (heading.textContent || "").trim();
        }
      }

      if (!title || title.length < 3) continue;
      title = title.replace(/Apply(?:\s+now)?$/i, "").trim();

      jobs.push({ title, location: "", urlPath });
    }

    return jobs;
  }, baseUrl);
}

/**
 * Fallback Phase 5: DOM structure heuristic.
 * Finds repeated elements (same tag + class) containing links, indicating a job list.
 * Uses the most common repeating pattern (5+ elements) as job cards.
 */
async function extractJobsFromDomStructure(
  page: Page,
  baseUrl: string
): Promise<ScrapedJob[]> {
  return page.evaluate((baseUrl: string) => {
    // Find all elements that look like list items containing links
    const candidates = Array.from(
      document.querySelectorAll("li a[href], article a[href], [class*='job'] a[href], [class*='role'] a[href], [class*='listing'] a[href], [class*='position'] a[href], [class*='card'] a[href]")
    );

    // Group links by their container's tag+class signature
    const groups = new Map<string, Element[]>();
    for (const link of candidates) {
      const container = link.closest("li, article, div[class], tr");
      if (!container) continue;
      const sig = `${container.tagName}.${(container.className?.toString() || "").split(/\s+/).sort().join(".")}`;
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(link);
    }

    // Find the largest group with 5+ items (most likely the job list)
    let bestGroup: Element[] = [];
    for (const [, links] of groups) {
      if (links.length >= 5 && links.length > bestGroup.length) {
        bestGroup = links;
      }
    }

    if (bestGroup.length === 0) return [];

    const jobs: { title: string; location: string; urlPath: string }[] = [];
    const seen = new Set<string>();

    for (const link of bestGroup) {
      const href = link.getAttribute("href") || "";
      if (!href || href === "#" || href.startsWith("javascript:")) continue;

      let urlPath: string;
      try {
        urlPath = new URL(href, baseUrl).href;
      } catch {
        continue;
      }

      // Skip nav/footer links (same page, short paths)
      try {
        const url = new URL(urlPath);
        if (url.pathname.length < 3 && !url.search) continue;
      } catch { continue; }

      if (seen.has(urlPath)) continue;
      seen.add(urlPath);

      // Get title from the link or nearby heading
      const container = link.closest("li, article, div[class], tr");
      let title = "";
      if (container) {
        const heading = container.querySelector("h1, h2, h3, h4, [class*='title']");
        if (heading) {
          title = (heading.textContent || "").trim();
        }
      }
      if (!title) {
        title = (link.textContent || "").trim();
      }

      if (!title || title.length < 3) continue;
      title = title.replace(/Apply(?:\s+now)?$/i, "").trim();

      // Try to find location from a sibling element
      let location = "";
      if (container) {
        const locEl = container.querySelector("[class*='location'], [class*='loc'], [class*='city'], [class*='place']");
        if (locEl) {
          location = (locEl.textContent || "").trim();
        }
      }

      jobs.push({ title, location, urlPath });
    }

    return jobs;
  }, baseUrl);
}

/**
 * Atlassian: Use their JSON API at /endpoint/careers/listings.
 * Filter for Product Management category and extract US locations.
 */
async function scrapeAtlassianCareers(): Promise<ScrapedJob[]> {
  console.log("Fetching Atlassian careers API...");
  const res = await fetch("https://www.atlassian.com/endpoint/careers/listings");
  if (!res.ok) throw new Error(`Atlassian API returned ${res.status}`);

  const allJobs: Array<{
    id: number;
    title: string;
    category: string;
    locations: string[];
  }> = await res.json();

  const pmJobs = allJobs.filter(
    (j) => j.category === "Product Management"
  );

  console.log(`Atlassian: ${allJobs.length} total jobs, ${pmJobs.length} PM jobs`);

  return pmJobs.map((j) => {
    // Build a clean location string from the locations array
    // Format is like "Seattle - United States - Seattle, Washington United States"
    // Extract the first part before " - " for a clean city name
    const locationParts = j.locations
      .map((loc) => loc.split(" - ")[0].trim())
      .filter((loc) => loc !== "Remote");
    const hasRemote = j.locations.some((loc) => loc.includes("Remote"));
    const location = [
      ...new Set(locationParts),
      ...(hasRemote ? ["Remote"] : []),
    ].join(", ");

    return {
      title: j.title,
      location,
      urlPath: `https://www.atlassian.com/company/careers/details/${j.id}`,
    };
  });
}

/**
 * Shared Greenhouse API scraper.
 * Fetches all jobs from a Greenhouse board and filters for PM roles.
 */
export const PM_KEYWORDS = [
  "product manager",
  "product management",  // AmEx / JPMorgan / Oracle put the function name in the title
  "product lead",
  "group product manager",
  "senior product manager",
  "staff product manager",
  "principal product manager",
  "director of product",
  "director, product",
  "head of product",
  "vp of product",
  "vp, product",
  "vp product",
  "chief product officer",
  "chief product",
  "product policy",
  "product led growth",
  "product growth",
];

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string };
  departments: Array<{ name: string }>;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

async function scrapeGreenhouseCareers(
  boardName: string,
  companyLabel: string,
  stats?: ScrapeStats
): Promise<ScrapedJob[]> {
  console.log(`${companyLabel}: Fetching jobs from Greenhouse API (board: ${boardName})`);

  // Try primary endpoint, fall back to alternate hostname if it fails
  const endpoints = [
    `https://api.greenhouse.io/v1/boards/${boardName}/jobs`,
    `https://boards-api.greenhouse.io/v1/boards/${boardName}/jobs`,
  ];

  let response: Response | null = null;
  for (const url of endpoints) {
    const res = await fetch(url);
    if (res.ok) {
      response = res;
      break;
    }
    console.warn(`${companyLabel}: Greenhouse endpoint returned ${res.status}: ${url}`);
  }

  if (!response) {
    throw new Error(`${companyLabel}: All Greenhouse endpoints failed for board "${boardName}"`);
  }

  const data: GreenhouseResponse = await response.json();
  console.log(`${companyLabel}: Found ${data.jobs.length} total jobs`);
  if (stats) stats.totalScanned = data.jobs.length;

  const productJobs = data.jobs.filter((job) => {
    const lowerTitle = job.title.toLowerCase();
    return PM_KEYWORDS.some((kw) => lowerTitle.includes(kw));
  });

  console.log(`${companyLabel}: Found ${productJobs.length} product manager roles`);

  return productJobs.map((job) => ({
    title: job.title,
    location: job.location?.name || "",
    urlPath: job.absolute_url,
  }));
}

/**
 * Greenhouse departments-based scraper.
 * Fetches the "Product Management" department and returns all jobs in it,
 * then also sweeps all jobs for PM keyword matches to catch PM roles filed
 * in other departments (e.g., Product Led Growth in a Growth dept).
 * Falls back to keyword-based scrapeGreenhouseCareers if no PM department found.
 */
async function scrapeGreenhouseDepartments(
  boardName: string,
  companyLabel: string,
  stats?: ScrapeStats
): Promise<ScrapedJob[]> {
  console.log(`${companyLabel}: Fetching departments from Greenhouse API (board: ${boardName})`);

  const [deptResponse, allJobsResponse] = await Promise.all([
    fetch(`https://api.greenhouse.io/v1/boards/${boardName}/departments`),
    fetch(`https://api.greenhouse.io/v1/boards/${boardName}/jobs`),
  ]);

  if (!deptResponse.ok) {
    console.log(`${companyLabel}: Departments endpoint failed, falling back to keyword filter`);
    return scrapeGreenhouseCareers(boardName, companyLabel, stats);
  }

  const deptData: { departments: Array<{ id: number; name: string; jobs: GreenhouseJob[] }> } =
    await deptResponse.json();

  // Find Product Management department(s)
  const pmDepts = deptData.departments.filter((d) => {
    const name = d.name.toLowerCase();
    return name.includes("product management") && !name.includes("production");
  });

  if (pmDepts.length === 0) {
    console.log(`${companyLabel}: No Product Management department found, falling back to keyword filter`);
    return scrapeGreenhouseCareers(boardName, companyLabel, stats);
  }

  const deptJobs = pmDepts.flatMap((d) => d.jobs);
  const deptJobIds = new Set(deptJobs.map((j) => j.id));
  console.log(`${companyLabel}: Found ${deptJobs.length} jobs in Product Management department`);

  // Also sweep all jobs for PM keyword matches not already in the department
  let keywordExtras: GreenhouseJob[] = [];
  let allJobsTotal = 0;
  if (allJobsResponse.ok) {
    const allData: GreenhouseResponse = await allJobsResponse.json();
    allJobsTotal = allData.jobs.length;
    keywordExtras = allData.jobs.filter((job) => {
      if (deptJobIds.has(job.id)) return false; // Already captured via department
      const lowerTitle = job.title.toLowerCase();
      return PM_KEYWORDS.some((kw) => lowerTitle.includes(kw));
    });
    if (keywordExtras.length > 0) {
      console.log(`${companyLabel}: Found ${keywordExtras.length} additional PM roles via keyword sweep`);
    }
  }
  // Report board size to caller — fall back to dept job count if /jobs failed.
  if (stats) stats.totalScanned = allJobsTotal > 0 ? allJobsTotal : deptJobs.length;

  const combined = [...deptJobs, ...keywordExtras];
  return combined.map((job) => ({
    title: job.title,
    location: job.location?.name || "",
    urlPath: job.absolute_url,
  }));
}

/**
 * Stripe uses server-side rendered pages with ?skip= pagination.
 * Filters for Product Manager/Lead roles and fetches locations from detail pages.
 */
async function scrapeStripeCareers(): Promise<ScrapedJob[]> {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
      SCRAPER_UA
    );

    const productJobs: { title: string; url: string }[] = [];
    let skip = 0;

    // Phase 1: Collect all Product Manager jobs from all pages
    while (skip <= 1200) {
      const url = `https://stripe.com/jobs/search?skip=${skip}`;
      console.log(`Stripe: Fetching ${url}`);

      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

        const jobs = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/jobs/listing"]');
          const seen = new Set<string>();
          const results: { title: string; url: string }[] = [];

          links.forEach((link) => {
            const href = link.getAttribute("href") || "";
            if (seen.has(href)) return;
            seen.add(href);

            const title = (link.textContent || "").trim();
            const lower = title.toLowerCase();

            // Filter for Product Manager/Lead roles, exclude sales roles
            const isProductRole =
              lower.includes("product manager") ||
              lower.includes("product lead") ||
              lower.includes("product director") ||
              lower.includes("head of product") ||
              lower.includes("vp of product") ||
              lower.includes("vp, product") ||
              lower.includes("chief product");

            const isExcluded =
              lower.includes("account executive") ||
              lower.includes("sales engineer") ||
              lower.includes("sales representative") ||
              lower.includes("account manager");

            if (isProductRole && !isExcluded) {
              results.push({ title, url: href });
            }
          });

          return results;
        });

        if (jobs.length > 0) {
          console.log(`  Found ${jobs.length} product roles on this page`);
          productJobs.push(...jobs);
        }

        // Check if we've reached the last page
        const hasMore = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/jobs/listing"]');
          return links.length > 0;
        });

        if (!hasMore) break;
        skip += 100;
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.log(`Stripe: Error at skip=${skip}:`, err);
        break;
      }
    }

    console.log(`Stripe: Found ${productJobs.length} total product jobs`);

    // Phase 2: Fetch location details for each job
    const allJobs: ScrapedJob[] = [];

    for (const job of productJobs) {
      try {
        await page.goto(job.url, { waitUntil: "networkidle2", timeout: 30000 });

        const details = await page.evaluate(() => {
          const bodyText = document.body.innerText;
          const lines = bodyText.split("\n").filter((l) => l.trim());

          const officeLocations: string[] = [];
          const remoteLocations: string[] = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line === "Office locations") {
              for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                const nextLine = lines[j].trim();
                if (
                  nextLine === "Remote locations" ||
                  nextLine === "Team" ||
                  nextLine === "Full time"
                )
                  break;
                if (nextLine.length > 0 && nextLine.length < 100) {
                  officeLocations.push(nextLine);
                }
              }
            }

            if (line === "Remote locations") {
              for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                const nextLine = lines[j].trim();
                if (
                  nextLine === "Team" ||
                  nextLine === "Full time" ||
                  nextLine === "Office locations"
                )
                  break;
                if (nextLine.length > 0 && nextLine.length < 100) {
                  remoteLocations.push(nextLine);
                }
              }
            }
          }

          return { officeLocations, remoteLocations };
        });

        // Combine office and remote locations
        const locations = [
          ...details.officeLocations,
          ...details.remoteLocations,
        ]
          .filter((l) => l)
          .join(" | ");

        allJobs.push({
          title: job.title,
          location: locations,
          urlPath: job.url,
        });

        console.log(`  ${job.title}: ${locations || "No location"}`);
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        // If detail page fails, still include job without location
        allJobs.push({
          title: job.title,
          location: "",
          urlPath: job.url,
        });
        console.log(`  ${job.title}: Failed to get location`);
      }
    }

    return allJobs;
  } finally {
    await browser.close();
  }
}

/**
 * Workday ATS scraper (used by Slack/Salesforce, etc.)
 * Fetches all jobs via the Workday API and filters for Product Manager roles.
 */
async function scrapeWorkdayCareers(
  tenant: string,
  subdomain: string,
  boardPath: string,
  companyLabel: string,
  stats?: ScrapeStats
): Promise<ScrapedJob[]> {
  console.log(`${companyLabel}: Fetching jobs from Workday API (${tenant}.${subdomain}/${boardPath})`);

  const baseUrl = `https://${tenant}.${subdomain}.myworkdayjobs.com/wday/cxs/${tenant}/${boardPath}/jobs`;
  const allJobs: ScrapedJob[] = [];
  let offset = 0;
  const limit = 20;
  let totalJobs = 0;

  interface WorkdayJob {
    title: string;
    locationsText?: string;
    externalPath: string;
  }

  interface WorkdayResponse {
    total: number;
    jobPostings: WorkdayJob[];
  }

  interface WorkdayJobDetail {
    jobPostingInfo: {
      location?: string;
      additionalLocations?: string[];
    };
  }

  // Fetches actual location names from the job detail endpoint
  async function fetchJobLocation(externalPath: string): Promise<string> {
    try {
      const detailUrl = `https://${tenant}.${subdomain}.myworkdayjobs.com/wday/cxs/${tenant}/${boardPath}${externalPath}`;
      const resp = await fetch(detailUrl, {
        headers: {
          "Accept": "application/json",
          "User-Agent": SCRAPER_UA,
        },
      });
      if (!resp.ok) return "";
      const detail: WorkdayJobDetail = await resp.json();
      const locations: string[] = [];
      if (detail.jobPostingInfo?.location) {
        locations.push(detail.jobPostingInfo.location);
      }
      if (detail.jobPostingInfo?.additionalLocations) {
        locations.push(...detail.jobPostingInfo.additionalLocations);
      }
      return locations.join(", ");
    } catch {
      return "";
    }
  }

  // Collect PM job candidates first, then fetch their real locations
  const pmCandidates: { title: string; externalPath: string; locationsText: string }[] = [];

  while (true) {
    try {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": SCRAPER_UA,
          "Accept": "application/json",
        },
        body: JSON.stringify({
          limit,
          offset,
        }),
      });

      if (!response.ok) {
        console.log(`${companyLabel}: API returned status ${response.status}`);
        break;
      }

      const data: WorkdayResponse = await response.json();

      // Store total from first request
      if (offset === 0) {
        totalJobs = data.total || 0;
        console.log(`${companyLabel}: Total jobs available: ${totalJobs}`);
      }

      console.log(`${companyLabel}: Fetched offset=${offset}, got ${data.jobPostings?.length || 0} jobs`);

      if (!data.jobPostings || data.jobPostings.length === 0) {
        break;
      }

      // Filter for PM roles
      for (const job of data.jobPostings) {
        if (!job || !job.title) continue;

        const lowerTitle = job.title.toLowerCase();
        const isPM = PM_KEYWORDS.some((kw) => lowerTitle.includes(kw));

        if (isPM) {
          pmCandidates.push({
            title: job.title,
            externalPath: job.externalPath,
            locationsText: job.locationsText || "",
          });
        }
      }

      offset += data.jobPostings.length;

      // Stop if we've fetched all jobs
      if (offset >= totalJobs) {
        break;
      }

      // Rate limiting
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.log(`${companyLabel}: Error at offset=${offset}:`, err);
      break;
    }
  }

  // For PM jobs with vague/missing location text, fetch detail for real names
  for (const candidate of pmCandidates) {
    let location = candidate.locationsText;
    const isVague =
      !location ||
      location.trim().length === 0 ||
      /^\d+ Locations?$/i.test(location) ||
      /^Multiple Locations?$/i.test(location) ||
      /^Hybrid$/i.test(location) ||
      /^Remote$/i.test(location.trim()) ||
      // Single word without comma/space = likely not a real city
      (!location.includes(",") && !location.includes(" ") && location.length < 20);

    if (isVague) {
      console.log(`${companyLabel}: Fetching detail for "${candidate.title}" (was "${location || "(empty)"}")`);
      const detailLocation = await fetchJobLocation(candidate.externalPath);
      // Only use detail result if it's non-empty; otherwise keep original
      if (detailLocation) {
        location = detailLocation;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    allJobs.push({
      title: candidate.title,
      location,
      urlPath: `https://${tenant}.${subdomain}.myworkdayjobs.com/${boardPath}${candidate.externalPath}`,
    });
  }

  console.log(`${companyLabel}: Found ${allJobs.length} Product Manager roles out of ${totalJobs} total jobs`);
  if (stats) stats.totalScanned = totalJobs;
  return allJobs;
}

/**
 * Ashby ATS scraper (used by OpenAI, etc.)
 * Fetches jobs via GraphQL API and filters for Product Management roles.
 */
async function scrapeAshbyCareers(
  orgName: string,
  companyLabel: string,
  stats?: ScrapeStats
): Promise<ScrapedJob[]> {
  console.log(`${companyLabel}: Fetching jobs from Ashby GraphQL API (org: ${orgName})`);

  const query = {
    operationName: "ApiJobBoardWithTeams",
    variables: {
      organizationHostedJobsPageName: orgName,
    },
    query: `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
      jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
        teams {
          id
          name
          parentTeamId
          __typename
        }
        jobPostings {
          id
          title
          teamId
          locationId
          locationName
          employmentType
          secondaryLocations {
            locationId
            locationName
            __typename
          }
          compensationTierSummary
          __typename
        }
        __typename
      }
    }`,
  };

  interface AshbyTeam {
    id: string;
    name: string;
    parentTeamId: string | null;
  }

  interface AshbySecondaryLocation {
    locationId: string;
    locationName: string;
  }

  interface AshbyJobPosting {
    id: string;
    title: string;
    teamId: string;
    locationId: string;
    locationName: string;
    employmentType: string;
    secondaryLocations: AshbySecondaryLocation[];
    compensationTierSummary: string | null;
  }

  interface AshbyResponse {
    data: {
      jobBoard: {
        teams: AshbyTeam[];
        jobPostings: AshbyJobPosting[];
      } | null;
    };
  }

  const response = await fetch(
    "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          SCRAPER_UA,
      },
      body: JSON.stringify(query),
    }
  );

  const data: AshbyResponse = await response.json();

  if (!data.data?.jobBoard) {
    console.warn(`${companyLabel}: Ashby API returned null jobBoard (org: ${orgName}) — board may have moved or been renamed`);
    return [];
  }

  const { jobPostings } = data.data.jobBoard;

  console.log(`${companyLabel}: Found ${jobPostings.length} total jobs`);
  if (stats) stats.totalScanned = jobPostings.length;

  // Filter by title keywords, not team name. Modern companies embed PMs inside
  // product-area teams (Growth, Payments, Platform, Kafka Cloud), so matching on
  // a team named "Product Management" misses them. Same pattern as Greenhouse.
  const productJobs = jobPostings.filter((job) => {
    const lowerTitle = job.title.toLowerCase();
    return PM_KEYWORDS.some((kw) => lowerTitle.includes(kw));
  });

  console.log(`${companyLabel}: Found ${productJobs.length} PM roles after title filter`);

  return productJobs.map((job) => {
    // Combine primary and secondary locations
    const allLocations = [job.locationName];
    for (const secondary of job.secondaryLocations || []) {
      if (secondary.locationName && !allLocations.includes(secondary.locationName)) {
        allLocations.push(secondary.locationName);
      }
    }

    return {
      title: job.title,
      location: allLocations.join(" | "),
      urlPath: `https://jobs.ashbyhq.com/${orgName}/${job.id}`,
    };
  });
}

/**
 * Reddit uses Greenhouse API with departments endpoint for better filtering.
 * First finds the Product department, then fetches only jobs in that department,
 * and applies PM keyword filter for accuracy.
 */
async function scrapeRedditCareers(): Promise<ScrapedJob[]> {
  console.log("Reddit: Fetching departments from Greenhouse API");

  // Step 1: Get departments to find Product department ID
  const deptResponse = await fetch(
    "https://api.greenhouse.io/v1/boards/reddit/departments"
  );

  if (!deptResponse.ok) {
    console.log("Reddit: Departments endpoint failed, falling back to all jobs");
    return scrapeGreenhouseCareers("reddit", "Reddit");
  }

  interface GreenhouseDepartment {
    id: number;
    name: string;
    jobs: GreenhouseJob[];
  }

  const deptData: { departments: GreenhouseDepartment[] } = await deptResponse.json();

  // Find Product-related departments
  const productDepts = deptData.departments.filter((d) => {
    const name = d.name.toLowerCase();
    return name.includes("product") && !name.includes("production");
  });

  if (productDepts.length === 0) {
    console.log("Reddit: No Product department found, falling back to keyword filter");
    return scrapeGreenhouseCareers("reddit", "Reddit");
  }

  console.log(`Reddit: Found ${productDepts.length} product departments: ${productDepts.map(d => d.name).join(", ")}`);

  // Step 2: Collect jobs from product departments
  const allDeptJobs = productDepts.flatMap((d) => d.jobs);
  console.log(`Reddit: ${allDeptJobs.length} jobs in product departments`);

  // Step 3: Apply PM keyword filter for accuracy
  const pmJobs = allDeptJobs.filter((job) => {
    const lowerTitle = job.title.toLowerCase();
    return PM_KEYWORDS.some((kw) => lowerTitle.includes(kw));
  });

  console.log(`Reddit: ${pmJobs.length} PM roles after keyword filter`);

  return pmJobs.map((job) => ({
    title: job.title,
    location: job.location?.name || "",
    urlPath: job.absolute_url,
  }));
}

/**
 * EA (Electronic Arts) — Avature ATS with server-rendered HTML pages of 20 jobs each.
 *
 * Parsing model: split the HTML by `<article` to get per-job chunks, then extract
 * title (data-jobname), URL (first JobDetail href), and one or more location spans
 * from within each chunk. This guarantees title↔URL↔location pair correctly within
 * the same DOM block — the old approach ran three independent regexes over the
 * whole page and zipped by index, which misaligned whenever any of the three counts
 * drifted (a real failure mode after EA template tweaks).
 *
 * Pagination: EA removed the "of N results" banner from the markup, so the old
 * total-driven pagination loop never ran (totalResults = 0 → no pages 2+ scraped).
 * Now we paginate-until-empty: stop when a page returns zero NEW URLs OR fewer than
 * perPage results.
 */
async function scrapeEACareers(stats?: ScrapeStats): Promise<ScrapedJob[]> {
  const baseUrl = "https://jobs.ea.com/en_US/careers/SearchJobs/product%20manager";
  const perPage = 20;
  const MAX_PAGES = 20; // 400 results scanned max
  const allJobs: ScrapedJob[] = [];
  const seenUrls = new Set<string>();

  const headers = {
    "User-Agent":
      SCRAPER_UA,
    Accept: "text/html",
  };

  function parseArticles(html: string): ScrapedJob[] {
    // chunks[0] is everything before the first <article>; real articles start at chunks[1].
    const chunks = html.split(/<article\b/);
    const jobs: ScrapedJob[] = [];

    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];

      const titleMatch = chunk.match(/data-jobname="([^"]*)"/);
      if (!titleMatch) continue;
      const title = titleMatch[1]
        .replace(/&amp;amp;/g, "&")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');

      const urlMatch = chunk.match(
        /href="(https:\/\/jobs\.ea\.com\/en_US\/careers\/JobDetail\/[^"]+)"/
      );
      if (!urlMatch) continue;
      const url = urlMatch[1];

      // A single article may have one or more location spans (multi-location jobs).
      // Join them with " | " so the downstream US filter passes if any are US.
      const locRegex = /<span class="list-item-location">([^<]*)<\/span>/g;
      const locations: string[] = [];
      let locMatch;
      while ((locMatch = locRegex.exec(chunk)) !== null) {
        locations.push(locMatch[1].trim());
      }
      const location = locations.join(" | ");

      jobs.push({ title, location, urlPath: url });
    }

    return jobs;
  }

  let offset = 0;
  let totalScanned = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const pageUrl = `${baseUrl}?jobRecordsPerPage=${perPage}&jobOffset=${offset}`;
    console.log(`EA: fetching offset=${offset}`);

    const res = await fetch(pageUrl, { headers });
    if (!res.ok) {
      console.warn(`EA: page at offset=${offset} returned HTTP ${res.status} — stopping pagination`);
      break;
    }

    const html = await res.text();
    const pageJobs = parseArticles(html);
    totalScanned += pageJobs.length;

    let newThisPage = 0;
    for (const job of pageJobs) {
      if (seenUrls.has(job.urlPath)) continue;
      seenUrls.add(job.urlPath);
      allJobs.push(job);
      newThisPage++;
    }

    // End conditions: page returned 0 new URLs (we've cycled) OR fewer than perPage results (last page).
    if (newThisPage === 0) break;
    if (pageJobs.length < perPage) break;

    offset += perPage;
    await new Promise((r) => setTimeout(r, 300));
  }

  if (stats) stats.totalScanned = totalScanned;

  const pmJobs = allJobs.filter((job) => {
    const lowerTitle = job.title.toLowerCase();
    return PM_KEYWORDS.some((kw) => lowerTitle.includes(kw));
  });

  console.log(
    `EA: scraped ${allJobs.length} jobs across ${Math.ceil(allJobs.length / perPage)} pages, ${pmJobs.length} PM-keyword matches`
  );
  return pmJobs;
}

/**
 * Apple careers — uses jobs.apple.com's internal SPA REST API.
 *
 * Two-step CSRF flow: GET /api/v1/CSRFToken returns X-Apple-CSRF-Token + cookies,
 * then POST /api/v1/search with that token + the page's expected payload shape
 * (the `format` field is mandatory — without it the API silently returns 0).
 *
 * Bounds: paginates up to 8 pages (160 search hits scanned). PM density is high
 * on pages 1-6 and collapses by page 8 — the early-exit on zero PM hits saves
 * tail pages once relevance drops off.
 */
async function scrapeAppleCareers(stats?: ScrapeStats): Promise<ScrapedJob[]> {
  const BASE = "https://jobs.apple.com";
  const MAX_PAGES = 8;  // 160 search hits scanned; PM density collapses past page 6
  const PAGE_DELAY_MS = 300;
  const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  let csrfToken: string;
  let cookieHeader: string;
  try {
    const csrfRes = await fetch(`${BASE}/api/v1/CSRFToken`, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: `${BASE}/en-us/search`,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!csrfRes.ok) throw new Error(`CSRF fetch returned ${csrfRes.status}`);
    csrfToken = csrfRes.headers.get("X-Apple-CSRF-Token") || "";
    if (!csrfToken) throw new Error("No X-Apple-CSRF-Token header in response");
    const raw = csrfRes.headers.get("set-cookie") || "";
    // Forward every cookie Apple sets except known-analytics. AWS ALB stickiness
    // cookies (AWSALBAPP-*, AWSALB) are needed if Apple rolls our session between
    // load-balancer targets mid-pagination.
    const ANALYTICS_COOKIE = /^(s_|_ga|_gid|geo|pxsid|dssf|dssid)/i;
    const cookies: string[] = [];
    for (const part of raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
      const pair = part.split(";")[0].trim();
      const name = pair.split("=")[0];
      if (name && !ANALYTICS_COOKIE.test(name)) cookies.push(pair);
    }
    cookieHeader = cookies.join("; ");
  } catch (err) {
    console.warn("Apple: CSRF token fetch failed:", err);
    return [];
  }

  interface AppleLocation {
    city?: string;
    stateProvince?: string;
    countryName?: string;
    countryID?: string;
    name?: string;
  }
  interface AppleSearchJob {
    positionId?: string;
    postingTitle?: string;
    transformedPostingTitle?: string;
    locations?: AppleLocation[];
  }

  const seen = new Set<string>();
  const pmJobs: ScrapedJob[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = {
      query: "product manager",
      filters: { locations: ["postLocation-USA"] },
      page,
      locale: "en-us",
      sort: "relevance",
      format: { longDate: "MMMM D, YYYY", mediumDate: "MMM D, YYYY" },
    };
    let data: { res?: { searchResults?: AppleSearchJob[]; totalRecords?: number } };
    try {
      const res = await fetch(`${BASE}/api/v1/search`, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: BASE,
          Referer: `${BASE}/en-us/search?key=product+manager&location=united-states-USA`,
          "X-Apple-CSRF-Token": csrfToken,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Apple search API returned ${res.status}`);
      data = await res.json();
    } catch (err) {
      console.warn(`Apple: page ${page} fetch failed:`, err);
      break;
    }

    const results = data?.res?.searchResults ?? [];
    if (stats) stats.totalScanned = (stats.totalScanned || 0) + results.length;
    if (results.length === 0) break;

    let pageHits = 0;
    for (const job of results) {
      const posId = job.positionId;
      if (!posId || seen.has(posId)) continue;
      seen.add(posId);

      const title = job.postingTitle || "";
      const lowerTitle = title.toLowerCase();
      if (!PM_KEYWORDS.some((kw) => lowerTitle.includes(kw))) continue;

      pageHits++;

      const loc = job.locations?.[0];
      let location = "";
      if (loc) {
        const parts = [loc.city, loc.stateProvince].filter(Boolean);
        location = parts.length > 0 ? parts.join(", ") : loc.name || "";
      }

      const slug = job.transformedPostingTitle || "";
      const urlPath = slug
        ? `${BASE}/en-us/details/${posId}/${slug}`
        : `${BASE}/en-us/details/${posId}`;

      pmJobs.push({ title, location, urlPath });
    }

    console.log(`Apple: page ${page} — ${pageHits} PM hits / ${results.length} total`);
    if (pageHits === 0 && page > 1) break;
    if (page < MAX_PAGES) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  console.log(`Apple: scraped ${pmJobs.length} PM jobs total`);
  return pmJobs;
}

/**
 * Netflix uses a JSON API with pagination.
 * Extracts team filters from the URL and fetches all jobs via API.
 */
async function scrapeNetflixCareers(careersUrl: string): Promise<ScrapedJob[]> {
  const url = new URL(careersUrl);

  // Extract team filters from URL (e.g., Teams=Product%20Management)
  const teams = url.searchParams.getAll("Teams");

  if (teams.length === 0) {
    // Default to Product Management if no teams specified
    teams.push("Product Management");
  }

  const baseApiUrl = "https://explore.jobs.netflix.net/api/apply/v2/jobs";
  const allJobs: ScrapedJob[] = [];
  let start = 0;
  const batchSize = 100;

  // First request to get total count
  const params = new URLSearchParams();
  params.append("domain", "netflix.com");
  params.append("start", "0");
  params.append("num", batchSize.toString());
  for (const team of teams) {
    params.append("Teams", team);
  }

  const initialResponse = await fetch(`${baseApiUrl}?${params.toString()}`, {
    headers: {
      "User-Agent": SCRAPER_UA,
      "Accept": "application/json",
    },
  });

  const initialData = await initialResponse.json();
  const totalCount = initialData.count || 0;

  console.log(`Netflix: Found ${totalCount} total jobs for teams: ${teams.join(", ")}`);

  // Process initial batch
  for (const job of initialData.positions || []) {
    const location = (job.location || "").replace(/,/g, ", ");
    allJobs.push({
      title: job.name,
      location,
      urlPath: `https://explore.jobs.netflix.net/careers/job/${job.id}`,
    });
  }

  start = allJobs.length;

  // Paginate through remaining jobs
  while (start < totalCount) {
    const nextParams = new URLSearchParams();
    nextParams.append("domain", "netflix.com");
    nextParams.append("start", start.toString());
    nextParams.append("num", batchSize.toString());
    for (const team of teams) {
      nextParams.append("Teams", team);
    }

    console.log(`Netflix: Fetching jobs starting at ${start}...`);

    const response = await fetch(`${baseApiUrl}?${nextParams.toString()}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    const data = await response.json();
    if (!data.positions || data.positions.length === 0) break;

    for (const job of data.positions) {
      const location = (job.location || "").replace(/,/g, ", ");
      allJobs.push({
        title: job.name,
        location,
        urlPath: `https://explore.jobs.netflix.net/careers/job/${job.id}`,
      });
    }

    start += data.positions.length;

    // Small delay to be respectful
    await new Promise((r) => setTimeout(r, 200));
  }

  // Filter for PM-titled jobs only (the "Product Management" team filter
  // can include designers, engineers, and analysts)
  const pmJobs = allJobs.filter((job) => {
    const lowerTitle = job.title.toLowerCase();
    return PM_KEYWORDS.some((kw) => lowerTitle.includes(kw));
  });

  console.log(`Netflix: Scraped ${allJobs.length} jobs, ${pmJobs.length} after PM keyword filter`);
  return pmJobs;
}

/**
 * Eightfold.ai platform (used by PayPal, etc.)
 * Uses a direct API with pagination (start=0, start=10, etc.)
 */
async function scrapeEightfoldCareers(careersUrl: string): Promise<ScrapedJob[]> {
  const url = new URL(careersUrl);
  // Extract company domain: "paypal.eightfold.ai" → "paypal.com"
  // For custom domains like "apply.careers.microsoft.com", extract the main domain
  const hostParts = url.hostname.split(".");
  const domain = hostParts.includes("eightfold")
    ? hostParts[0] + ".com"
    : hostParts.slice(-2).join("."); // e.g., "microsoft.com"
  const baseOrigin = url.origin;

  // Extract filter parameters from the careers URL
  const location = url.searchParams.get("location") || "";
  const sortBy = url.searchParams.get("sort_by") || "relevance";
  const filterDistance = url.searchParams.get("filter_distance") || "";
  const filterJobCategory = url.searchParams.get("filter_job_category") || "";

  console.log(`Eightfold: Scraping ${domain} careers`);

  const allJobs: ScrapedJob[] = [];
  let start = 0;

  while (true) {
    // Build API URL with same filters as the careers page
    const apiUrl = new URL(`${baseOrigin}/api/pcsx/search`);
    apiUrl.searchParams.set("domain", domain);
    apiUrl.searchParams.set("query", "");
    apiUrl.searchParams.set("start", start.toString());
    if (location) apiUrl.searchParams.set("location", location);
    if (sortBy) apiUrl.searchParams.set("sort_by", sortBy);
    if (filterDistance) apiUrl.searchParams.set("filter_distance", filterDistance);
    if (filterJobCategory) apiUrl.searchParams.set("filter_job_category", filterJobCategory);

    console.log(`Eightfold: Fetching start=${start}`);

    try {
      const res = await fetch(apiUrl.toString(), {
        headers: {
          "User-Agent":
            SCRAPER_UA,
        },
      });

      interface EightfoldPosition {
        id: number;
        name: string;
        locations?: string[];
        standardizedLocations?: string[];
        positionUrl?: string;
      }

      interface EightfoldResponse {
        status: number;
        data: {
          positions: EightfoldPosition[];
          count: number;
        };
      }

      // Guard against HTML error pages (Microsoft sometimes returns 200 with HTML "Not Found")
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) {
        const preview = await res.text();
        console.warn(`Eightfold: API returned ${res.status} (${contentType}): ${preview.slice(0, 100)}`);
        break;
      }

      const result: EightfoldResponse = await res.json();

      if (result.status !== 200 || !result.data?.positions) {
        console.log(`Eightfold: API returned non-success status: ${result.status}`);
        break;
      }

      const positions = result.data.positions;
      const totalCount = result.data.count;

      console.log(`  Found ${positions.length} jobs (total: ${totalCount})`);

      for (const job of positions) {
        const locations = (job.standardizedLocations || job.locations || []).join(" | ");
        const jobUrl = job.positionUrl
          ? `${baseOrigin}${job.positionUrl}`
          : `${baseOrigin}/careers/job/${job.id}`;

        allJobs.push({
          title: job.name,
          location: locations,
          urlPath: jobUrl,
        });
      }

      // Check if we've fetched all jobs
      if (allJobs.length >= totalCount || positions.length === 0) {
        break;
      }

      start += 10; // Eightfold uses 10 items per page
      await new Promise((r) => setTimeout(r, 300)); // Rate limiting
    } catch (err) {
      console.log(`Eightfold: Error at start=${start}:`, err);
      break;
    }
  }

  console.log(`Eightfold: Found ${allJobs.length} total jobs`);
  return allJobs;
}

/**
 * SmartRecruiters public API scraper.
 * Fetches all postings via paginated GET and filters for PM roles.
 */
async function scrapeSmartRecruitersCareers(
  company: string,
  companyLabel: string
): Promise<ScrapedJob[]> {
  console.log(`${companyLabel}: Fetching jobs from SmartRecruiters API (company: ${company})`);

  const allJobs: ScrapedJob[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const apiUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=${limit}&offset=${offset}`;

    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": SCRAPER_UA,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      if (offset === 0) {
        throw new Error(`${companyLabel}: SmartRecruiters API returned ${response.status}`);
      }
      break;
    }

    interface SRPosting {
      id: string;
      name: string;
      refNumber?: string;
      location: {
        city?: string;
        region?: string;
        country?: string;
        remote?: boolean;
      };
      department?: { label?: string };
      ref: string;
    }

    interface SRResponse {
      totalFound: number;
      content: SRPosting[];
    }

    const data: SRResponse = await response.json();

    if (offset === 0) {
      console.log(`${companyLabel}: SmartRecruiters total postings: ${data.totalFound}`);
    }

    if (!data.content || data.content.length === 0) break;

    for (const posting of data.content) {
      const lowerTitle = posting.name.toLowerCase();
      const isPM = PM_KEYWORDS.some((kw) => lowerTitle.includes(kw));
      if (!isPM) continue;

      const locParts: string[] = [];
      if (posting.location.city) locParts.push(posting.location.city);
      if (posting.location.region) locParts.push(posting.location.region);
      if (posting.location.country) locParts.push(posting.location.country);
      const location = posting.location.remote
        ? locParts.length > 0 ? `${locParts.join(", ")} (Remote)` : "Remote"
        : locParts.join(", ");

      allJobs.push({
        title: posting.name,
        location,
        urlPath: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${posting.id}`,
      });
    }

    offset += data.content.length;
    if (offset >= data.totalFound) break;

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`${companyLabel}: Found ${allJobs.length} PM roles from SmartRecruiters`);
  return allJobs;
}

/**
 * Amazon Jobs API scraper.
 * Uses amazon.jobs/en/search.json with category + keyword filtering.
 * Paginates through all results (max 10 per page).
 */
async function scrapeAmazonCareers(): Promise<ScrapedJob[]> {
  console.log("Fetching Amazon Jobs API...");
  const allJobs: ScrapedJob[] = [];
  const pageSize = 100;
  let offset = 0;
  let totalHits = 0;

  do {
    const url = `https://www.amazon.jobs/en/search.json?base_query=product+manager&country=USA&result_limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Amazon API returned ${res.status}`);

    const data = await res.json();
    totalHits = data.hits || 0;

    if (!data.jobs || data.jobs.length === 0) break;

    for (const job of data.jobs) {
      allJobs.push({
        title: job.title,
        location: job.location || `${job.city || ""}, ${job.state || ""}`.replace(/^, |, $/g, ""),
        urlPath: `https://www.amazon.jobs${job.job_path}`,
      });
    }

    offset += data.jobs.length;
    if (offset >= totalHits) break;

    await new Promise((r) => setTimeout(r, 300));
  } while (true);

  console.log(`Amazon: Found ${allJobs.length} jobs (total hits: ${totalHits})`);
  return allJobs;
}

/**
 * iCIMS REST API scraper (no Puppeteer).
 * Uses the /api/jobs endpoint that some iCIMS sites expose.
 * Supports keyword filtering and pagination.
 */
async function scrapeICIMSAPICareers(
  baseUrl: string,
  companyLabel: string,
  keywords?: string,
): Promise<ScrapedJob[]> {
  console.log(`${companyLabel}: Scraping iCIMS API at ${baseUrl}`);
  const allJobs: ScrapedJob[] = [];
  const pageSize = 100;
  let offset = 0;
  let totalCount = 0;

  do {
    const params = new URLSearchParams();
    if (keywords) params.append("keywords", keywords);
    params.append("limit", pageSize.toString());
    params.append("offset", offset.toString());

    const url = `${baseUrl}/api/jobs?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`${companyLabel} iCIMS API returned ${res.status}`);

    const data = await res.json();
    totalCount = data.totalCount || 0;

    if (!data.jobs || data.jobs.length === 0) break;

    for (const job of data.jobs) {
      const d = job.data || job;
      const city = d.city || "";
      const state = d.state || "";
      const country = d.country_code || d.country || "";
      const location = [city, state, country].filter(Boolean).join(", ");

      allJobs.push({
        title: d.title || "",
        location,
        urlPath: `${baseUrl}/${d.slug || d.req_id || ""}`,
      });
    }

    offset += data.jobs.length;
    if (offset >= totalCount) break;

    await new Promise((r) => setTimeout(r, 300));
  } while (true);

  console.log(`${companyLabel}: Found ${allJobs.length} jobs from iCIMS API (total: ${totalCount})`);
  return allJobs;
}

/**
 * Intuit TalentBrew scraper.
 * Fetches HTML-in-JSON from the TalentBrew search API and parses job data from HTML.
 * Paginates through all pages.
 */
async function scrapeIntuitCareers(): Promise<ScrapedJob[]> {
  console.log("Fetching Intuit TalentBrew API...");
  const allJobs: ScrapedJob[] = [];
  const pageSize = 25;
  let currentPage = 1;
  let totalPages = 1;
  const seen = new Set<string>();

  do {
    const params = new URLSearchParams({
      ActiveFacetID: "0",
      CurrentPage: currentPage.toString(),
      RecordsPerPage: pageSize.toString(),
      Distance: "50",
      RadiusUnitType: "0",
      Keywords: "product manager",
      Location: "United States",
      ShowRadius: "False",
      IsPagination: currentPage > 1 ? "True" : "False",
      SearchResultsModuleName: "Search Results",
      SearchFiltersModuleName: "Search Filters",
      SortCriteria: "0",
      SortDirection: "0",
      SearchType: "5",
    });

    const res = await fetch(`https://jobs.intuit.com/search-jobs/results?${params.toString()}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Intuit TalentBrew API returned ${res.status}`);

    const data = await res.json();
    const html: string = data.results || "";

    // Parse total pages from first response
    if (currentPage === 1) {
      const totalPagesMatch = html.match(/data-total-pages="(\d+)"/);
      totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1]) : 1;
      const totalResultsMatch = html.match(/data-total-results="(\d+)"/);
      const totalResults = totalResultsMatch ? parseInt(totalResultsMatch[1]) : 0;
      console.log(`Intuit: ${totalResults} total results, ${totalPages} pages`);
    }

    // Parse jobs from HTML list items
    const jobPattern = /<li[^>]*data-intuit-jobid[^>]*>[\s\S]*?<\/li>/g;
    let match;
    while ((match = jobPattern.exec(html)) !== null) {
      const li = match[0];
      const titleMatch = li.match(/<h2>(.*?)<\/h2>/);
      const locationMatch = li.match(/class="job-location">(.*?)<\/span>/);
      const hrefMatch = li.match(/href="([^"]+)"/);

      if (!titleMatch || !hrefMatch) continue;

      const urlPath = `https://jobs.intuit.com${hrefMatch[1]}`;
      if (seen.has(urlPath)) continue;
      seen.add(urlPath);

      allJobs.push({
        title: titleMatch[1].trim(),
        location: locationMatch ? locationMatch[1].trim() : "",
        urlPath,
      });
    }

    currentPage++;
    if (currentPage > totalPages) break;

    await new Promise((r) => setTimeout(r, 300));
  } while (true);

  console.log(`Intuit: Found ${allJobs.length} jobs from TalentBrew`);
  return allJobs;
}

/**
 * Oracle HCM Cloud scraper.
 * Used by JPMorgan Chase, Oracle, and other companies on Oracle's ATS.
 * Uses the recruitingCEJobRequisitions REST API with keyword search.
 */
async function scrapeOracleHCMCareers(
  tenantUrl: string,
  siteNumber: string,
  companyLabel: string,
): Promise<ScrapedJob[]> {
  // Validate inputs (DB-sourced but defense in depth)
  if (!/^https:\/\/[a-z0-9.-]+\.oraclecloud\.com$/i.test(tenantUrl)) {
    throw new Error(`${companyLabel}: Invalid Oracle HCM tenant URL: ${tenantUrl}`);
  }
  if (!/^[A-Z0-9_]+$/i.test(siteNumber)) {
    throw new Error(`${companyLabel}: Invalid Oracle HCM site number: ${siteNumber}`);
  }
  console.log(`${companyLabel}: Scraping Oracle HCM at ${tenantUrl}`);
  const allJobs: ScrapedJob[] = [];
  const pageSize = 25;
  let offset = 0;
  let totalCount = 0;

  do {
    const apiUrl = `${tenantUrl}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=${siteNumber},limit=${pageSize},offset=${offset},keyword=product+manager,sortBy=POSTING_DATES_DESC&expand=requisitionList.secondaryLocations`;

    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`${companyLabel} Oracle HCM API returned ${res.status}`);

    const data = await res.json();
    const items = data.items?.[0];
    if (!items) break;

    totalCount = items.TotalJobsCount || 0;
    const requisitions = items.requisitionList || [];

    if (requisitions.length === 0) break;

    for (const job of requisitions) {
      allJobs.push({
        title: job.Title || "",
        location: job.PrimaryLocation || "",
        urlPath: `${tenantUrl}/hcmUI/CandidateExperience/en/sites/${siteNumber}/job/${job.Id}`,
      });
    }

    offset += requisitions.length;
    if (offset >= totalCount) break;

    await new Promise((r) => setTimeout(r, 300));
  } while (true);

  console.log(`${companyLabel}: Found ${allJobs.length} jobs from Oracle HCM (total: ${totalCount})`);
  return allJobs;
}

/**
 * iCIMS ATS scraper (Puppeteer-based).
 * iCIMS career pages are server-rendered HTML with consistent structure.
 * Does NOT filter by PM_KEYWORDS — lets validateScrapeResults handle it.
 */
async function scrapeICIMSCareers(
  company: string,
  baseUrl: string,
  companyLabel: string
): Promise<ScrapedJob[]> {
  console.log(`${companyLabel}: Scraping iCIMS careers page at ${baseUrl}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
      SCRAPER_UA
    );

    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait for job listings to load
    await new Promise((r) => setTimeout(r, 2000));

    // iCIMS has several page structures — try structured extraction first, then generic links
    const jobs = await page.evaluate((baseUrl: string) => {
      const results: { title: string; location: string; urlPath: string }[] = [];
      const seen = new Set<string>();

      // Strategy 1: iCIMS table rows (.iCIMS_JobsTable .row)
      const tableRows = document.querySelectorAll(".iCIMS_JobsTable .row, .iCIMS_MainWrapper .row");
      if (tableRows.length > 0) {
        for (const row of Array.from(tableRows)) {
          const link = row.querySelector("a[href]");
          if (!link) continue;

          const href = link.getAttribute("href") || "";
          if (!href) continue;

          let urlPath: string;
          try {
            urlPath = new URL(href, baseUrl).href;
          } catch {
            continue;
          }

          if (seen.has(urlPath)) continue;
          seen.add(urlPath);

          const title = (link.textContent || "").trim();
          if (!title || title.length < 3) continue;

          const locEl = row.querySelector(".iCIMS_JobsTable__col--location, [class*='location']");
          const location = locEl ? (locEl.textContent || "").trim() : "";

          results.push({ title, location, urlPath });
        }
      }

      // Strategy 2: Generic job links (href containing /jobs/ on icims.com)
      if (results.length === 0) {
        const allLinks = Array.from(document.querySelectorAll("a[href]"));
        for (const link of allLinks) {
          const href = link.getAttribute("href") || "";
          if (!href.includes("/jobs/") && !href.includes("/job/")) continue;

          let urlPath: string;
          try {
            urlPath = new URL(href, baseUrl).href;
          } catch {
            continue;
          }

          if (seen.has(urlPath)) continue;
          seen.add(urlPath);

          const title = (link.textContent || "").trim();
          if (!title || title.length < 3) continue;
          if (/^(apply|back|next|previous|search)/i.test(title)) continue;

          // Try to find location from parent container
          let location = "";
          const container = link.closest("li, tr, div[class*='job'], div[class*='listing'], article");
          if (container) {
            const locEl = container.querySelector("[class*='location'], [class*='loc'], [class*='city']");
            if (locEl) location = (locEl.textContent || "").trim();
          }

          results.push({ title, location, urlPath });
        }
      }

      return results;
    }, baseUrl);

    console.log(`${companyLabel}: iCIMS scraper found ${jobs.length} jobs`);
    return jobs;
  } finally {
    await browser.close();
  }
}

/**
 * Lever public API scraper (used by Cloudflare, Notion, Databricks, etc.)
 * Fetches all postings via GET and filters for PM roles.
 */
async function scrapeLeverCareers(
  handle: string,
  companyLabel: string
): Promise<ScrapedJob[]> {
  console.log(`${companyLabel}: Fetching jobs from Lever API (handle: ${handle})`);

  const response = await fetch(
    `https://api.lever.co/v0/postings/${handle}?mode=json`,
    {
      headers: {
        "User-Agent": SCRAPER_UA,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`${companyLabel}: Lever API returned ${response.status}`);
  }

  interface LeverPosting {
    id: string;
    text: string;
    categories: {
      team?: string;
      department?: string;
      location?: string;
    };
    hostedUrl: string;
    workplaceType?: string;
  }

  const postings: LeverPosting[] = await response.json();
  console.log(`${companyLabel}: Found ${postings.length} total postings`);

  const pmJobs = postings.filter((posting) => {
    const lowerTitle = posting.text.toLowerCase();
    return PM_KEYWORDS.some((kw) => lowerTitle.includes(kw));
  });

  console.log(`${companyLabel}: Found ${pmJobs.length} PM roles after keyword filter`);

  return pmJobs.map((posting) => {
    let location = posting.categories?.location || "";
    if (posting.workplaceType) {
      const workplace = posting.workplaceType.toLowerCase();
      if (workplace === "remote" && !location.toLowerCase().includes("remote")) {
        location = location ? `${location} (Remote)` : "Remote";
      }
    }

    return {
      title: posting.text,
      location,
      urlPath: posting.hostedUrl,
    };
  });
}

/**
 * Google Careers uses page-based pagination with ?page= parameter.
 * Extracts job listings from the search results page.
 */
async function scrapeGoogleCareers(careersUrl: string): Promise<ScrapedJob[]> {
  console.log("Google: Starting careers scraper");

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
      SCRAPER_UA
    );

    const allJobs: ScrapedJob[] = [];
    const seen = new Set<string>();

    // Ensure page parameter is in the URL
    const baseUrl = careersUrl.includes("page=")
      ? careersUrl.replace(/page=\d+/, "page=")
      : careersUrl + (careersUrl.includes("?") ? "&page=" : "?page=");

    // Paginate through all pages
    for (let pageNum = 1; pageNum <= 20; pageNum++) {
      const pageUrl = baseUrl + pageNum;
      console.log(`Google: Fetching page ${pageNum}...`);

      await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 2000));

      // Get total job count on first page
      if (pageNum === 1) {
        const totalJobs = await page.evaluate(() => {
          const bodyText = document.body.innerText;
          const match = bodyText.match(/(\d+)\s*jobs?\s*matched/i);
          return match ? parseInt(match[1]) : 0;
        });
        console.log(`Google: Total jobs to find: ${totalJobs}`);
      }

      const pageJobs = await page.evaluate(() => {
        const baseUrlPrefix = "https://www.google.com/about/careers/applications/";
        const allLinks = Array.from(document.querySelectorAll("a[href]"));
        const jobLinks = allLinks.filter((a) => {
          const href = a.getAttribute("href") || "";
          // Match links like: jobs/results/128346269826327238-group-product-manager-ai-infra
          return /jobs\/results\/\d+-/.test(href);
        });

        const jobs: { title: string; location: string; urlPath: string }[] = [];
        const localSeen = new Set<string>();

        for (const link of jobLinks) {
          const href = link.getAttribute("href") || "";

          let fullUrl: string;
          if (href.startsWith("http")) {
            fullUrl = href;
          } else if (href.startsWith("/")) {
            fullUrl = "https://www.google.com" + href;
          } else {
            fullUrl = baseUrlPrefix + href;
          }

          // Clean URL - remove query parameters for deduplication
          const urlObj = new URL(fullUrl);
          const cleanUrl = urlObj.origin + urlObj.pathname;

          if (localSeen.has(cleanUrl)) continue;
          localSeen.add(cleanUrl);

          // Extract title and location from parent container
          let title = "";
          let location = "";

          const parent = link.closest("li") || link.parentElement?.parentElement?.parentElement;
          if (parent) {
            const text = (parent.textContent || "").trim();
            const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (/^(learn more|share|save|apply)$/i.test(line)) continue;

              // Look for line with "Company | Location" pattern
              if (line.includes(" | ") && !title) {
                // Previous meaningful line is the title
                for (let j = i - 1; j >= 0; j--) {
                  if (lines[j] && !/^(learn more|share|save|apply)$/i.test(lines[j])) {
                    title = lines[j];
                    break;
                  }
                }
                // Extract location after the pipe
                const parts = line.split(" | ");
                if (parts.length >= 2) {
                  location = parts
                    .slice(1)
                    .join(" | ")
                    .replace(/Minimum qualifications.*$/i, "")
                    .replace(/\s*;\s*\+\d+\s*more/gi, " (+more)")
                    .trim();
                }
                break;
              }
            }
          }

          // Fallback: extract title from URL slug
          if (!title) {
            const slugMatch = href.match(/\d+-(.+?)(?:\?|$)/);
            if (slugMatch) {
              title = slugMatch[1]
                .replace(/-/g, " ")
                .replace(/\b\w/g, (l) => l.toUpperCase());
            }
          }

          if (title) {
            jobs.push({ title, location: location || "Unknown", urlPath: cleanUrl });
          }
        }

        return jobs;
      });

      console.log(`Google: Found ${pageJobs.length} jobs on page ${pageNum}`);

      let newJobsCount = 0;
      for (const job of pageJobs) {
        if (!seen.has(job.urlPath)) {
          seen.add(job.urlPath);
          allJobs.push(job);
          newJobsCount++;
        }
      }

      console.log(`Google: New unique jobs: ${newJobsCount}, Total so far: ${allJobs.length}`);

      // Stop if no new jobs found (empty page)
      if (newJobsCount === 0) {
        console.log("Google: No new jobs found, stopping pagination");
        break;
      }
    }

    console.log(`Google: Scraped ${allJobs.length} jobs successfully`);
    return allJobs;
  } finally {
    await browser.close();
  }
}

/**
 * Coinbase migrated off public Greenhouse (board "coinbase" returns 404).
 * Their careers SPA at /careers/positions fetches /api/v2/careers via cookied requests
 * but is fronted by Cloudflare bot protection that rejects vanilla Puppeteer.
 *
 * Strategy: launch puppeteer-extra with stealth plugin so navigator.webdriver,
 * window.chrome, permissions API, and a few other tells look like real Chrome.
 * Land on /careers first to clear Cloudflare and warm up cookies, then client-side
 * route to /careers/positions so the SPA fires /v2/careers with proper headers.
 * Intercept the response and parse departments[].jobs[].
 */
async function scrapeCoinbaseCareers(): Promise<ScrapedJob[]> {
  console.log("Coinbase: Starting careers scraper (stealth Puppeteer + intercept)");

  const puppeteerExtra = (await import("puppeteer-extra")).default;
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
  puppeteerExtra.use(StealthPlugin());

  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
      SCRAPER_UA
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    type CoinbaseJob = { id: number | string; title: string; location?: { name?: string }; absolute_url?: string };
    type CoinbaseData = { departments?: Array<{ name: string; jobs: CoinbaseJob[] }> };
    let careersPayload: CoinbaseData | null = null;
    let lastApiStatus: number | null = null;

    page.on("response", async (res) => {
      const url = res.url();
      if (!/\/v2\/careers(\?|$)/.test(url)) return;
      lastApiStatus = res.status();
      if (res.status() !== 200) return;
      try {
        const json = await res.json();
        if (json && json.data) careersPayload = json.data as CoinbaseData;
      } catch {
        // Non-JSON response or parse failure — ignore
      }
    });

    // Land on /careers first to clear Cloudflare and pick up cookies
    await page.goto("https://www.coinbase.com/careers", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await new Promise((r) => setTimeout(r, 2000));

    // Client-side route to /careers/positions so the SPA hits /v2/careers
    await page.evaluate(() => {
      window.history.pushState({}, "", "/careers/positions");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    // Wait up to 15s for the API response (or a non-200 we should bail on)
    for (let i = 0; i < 15 && !careersPayload; i++) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    const payload = careersPayload as CoinbaseData | null;
    if (!payload || !payload.departments) {
      // Return [] instead of throwing so dailyCheck's stealth fallback tier gets a turn.
      console.warn(`Coinbase: /v2/careers ${lastApiStatus ?? "never fired"} — returning [] for stealth fallback`);
      return [];
    }

    const allJobs: ScrapedJob[] = [];
    for (const dept of payload.departments) {
      for (const job of dept.jobs || []) {
        const title = job.title || "";
        const location = job.location?.name || "";
        const urlPath = job.absolute_url || `https://www.coinbase.com/careers/positions/${job.id}`;
        if (title) allJobs.push({ title, location, urlPath });
      }
    }

    console.log(`Coinbase: Scraped ${allJobs.length} jobs across ${payload.departments.length} departments`);
    return allJobs;
  } finally {
    await browser.close();
  }
}

export interface StealthScrapeResult {
  jobs: ScrapedJob[];
  /** URL of the JSON XHR that produced the jobs (if found via network sniff). */
  sniffedUrl?: string;
  /** How the jobs were extracted, for diagnostics. */
  via: "json_sniff" | "dom_extract" | "none";
}

/**
 * Generic last-resort scraper using stealth Puppeteer + network sniffing.
 * Used by dailyCheck.ts when the configured platform scraper AND broadATSDiscovery
 * both return 0 jobs. Tries to extract jobs from any JSON XHR response that has
 * the right shape, then falls back to DOM-based extraction.
 *
 * Returns the jobs plus the sniffed URL so dailyCheck can try to auto-derive
 * a corrected platform config (Layer 1 auto-fix). Does NOT throw on failure —
 * returns an empty result so the caller can decide how to handle.
 */
export async function stealthFallbackScrape(careersUrl: string, companyName: string): Promise<StealthScrapeResult> {
  console.log(`StealthFallback[${companyName}]: starting on ${careersUrl}`);

  const puppeteerExtra = (await import("puppeteer-extra")).default;
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
  puppeteerExtra.use(StealthPlugin());

  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(SCRAPER_UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    type Bucket = { url: string; jobs: ScrapedJob[] };
    const jsonBuckets: Bucket[] = [];

    page.on("response", async (res) => {
      const url = res.url();
      if (res.status() !== 200) return;
      // Only inspect URLs that look careers-related
      if (!/career|position|job|opening|posting|department|recruit|board/i.test(url)) return;
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if (!ct.includes("json")) return;
      // Cross-company guard: if the sniffed URL is on a different registrable
      // domain than the company's careers_url, the data probably belongs to a
      // parent/acquired company (e.g. Neon's careers page redirected to
      // databricks.com after acquisition, attributing all 19 Databricks PM jobs
      // to Neon). Known ATS hosts are allowed because their URL path embeds
      // the company slug, so inferPlatformFromSniffedUrl will re-anchor it.
      if (isCrossCompanySniff(careersUrl, url)) {
        console.warn(`StealthFallback[${companyName}]: skipping cross-company sniff ${url}`);
        return;
      }
      try {
        const json = await res.json();
        const extracted = extractJobsFromUnknownJson(json, careersUrl);
        if (extracted.length >= 3) jsonBuckets.push({ url, jobs: extracted });
      } catch {
        // ignore parse failures
      }
    });

    try {
      await page.goto(careersUrl, { waitUntil: "networkidle2", timeout: 60000 });
    } catch (err) {
      console.warn(`StealthFallback[${companyName}]: goto warning:`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 4000));

    // Best JSON bucket wins (largest extracted set from a single response)
    if (jsonBuckets.length > 0) {
      jsonBuckets.sort((a, b) => b.jobs.length - a.jobs.length);
      const winner = jsonBuckets[0];
      console.log(`StealthFallback[${companyName}]: JSON sniff → ${winner.jobs.length} jobs from ${winner.url}`);
      return { jobs: dedupeJobs(winner.jobs), sniffedUrl: winner.url, via: "json_sniff" };
    }

    // Fallback: scroll to load lazy content, then DOM-extract job links
    let prevHeight = 0;
    for (let i = 0; i < 8; i++) {
      const h = await page.evaluate(() => document.body.scrollHeight);
      if (h === prevHeight) break;
      prevHeight = h;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 1200));
    }

    const baseUrl = new URL(careersUrl).origin;
    const domJobs = await page.evaluate((base) => {
      const jobRe = /\/(jobs|job|positions|position|careers|openings|roles|postings)\/[a-z0-9][\w-]/i;
      const skipRe = /\/(search|departments|locations|teams|categories|benefits|culture|about|faq|sitemap)(\/|$|\?)/i;
      const links = Array.from(document.querySelectorAll("a[href]"));
      const out: { title: string; location: string; urlPath: string }[] = [];
      const seen = new Set<string>();
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        if (!jobRe.test(href) || skipRe.test(href)) continue;
        let urlPath: string;
        try {
          urlPath = new URL(href, base).href;
        } catch {
          continue;
        }
        if (seen.has(urlPath)) continue;
        seen.add(urlPath);
        const title = (link.textContent || "").trim().split("\n")[0].slice(0, 200);
        if (title.length < 4) continue;
        out.push({ title, location: "", urlPath });
      }
      return out;
    }, baseUrl);

    console.log(`StealthFallback[${companyName}]: DOM extract → ${domJobs.length} jobs`);
    return { jobs: dedupeJobs(domJobs), via: domJobs.length > 0 ? "dom_extract" : "none" };
  } finally {
    await browser.close();
  }
}

/**
 * Layer 1 auto-fix: given a URL that stealth fallback successfully sniffed
 * jobs from, try to derive a known platform_type + platform_config. If it
 * matches a recognizable ATS pattern, the cron can update the company's DB
 * row so future scrapes skip stealth and hit the API directly.
 *
 * Returns null for unknown URL patterns — those still get logged to
 * scraper_events for visibility in the Monday digest.
 */
export function inferPlatformFromSniffedUrl(
  url: string
): { platformType: string; platformConfig: Record<string, string> } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const path = parsed.pathname;

    // Greenhouse: (api|boards-api).greenhouse.io/v1/boards/{slug}/...
    if (host === "api.greenhouse.io" || host === "boards-api.greenhouse.io") {
      const m = path.match(/^\/v1\/boards\/([^/]+)/);
      if (m && m[1]) return { platformType: "greenhouse", platformConfig: { boardName: m[1] } };
    }

    // Lever: api.lever.co/v0/postings/{handle}
    if (host === "api.lever.co") {
      const m = path.match(/^\/v0\/postings\/([^/]+)/);
      if (m && m[1]) return { platformType: "lever", platformConfig: { handle: m[1] } };
    }

    // Ashby: api.ashbyhq.com/posting-api/job-board/{org}
    if (host === "api.ashbyhq.com") {
      const m = path.match(/^\/posting-api\/job-board\/([^/]+)/);
      if (m && m[1]) return { platformType: "ashby", platformConfig: { orgName: m[1] } };
    }

    // SmartRecruiters: api.smartrecruiters.com/v1/companies/{slug}/postings
    if (host === "api.smartrecruiters.com") {
      const m = path.match(/^\/v1\/companies\/([^/]+)/);
      if (m && m[1]) return { platformType: "smartrecruiters", platformConfig: { company: m[1] } };
    }

    // Revolut: www.revolut.com/_next/data/{buildId}/careers.json
    // The buildId rotates on every Revolut deploy. The stealth tier sniffs the
    // real URL after Puppeteer renders /careers, so this branch auto-recovers
    // the new buildId for the next cron run.
    if (host === "www.revolut.com") {
      const m = path.match(/^\/_next\/data\/([A-Za-z0-9_-]+)\/careers\.json$/);
      if (m && m[1]) return { platformType: "revolut", platformConfig: { buildId: m[1] } };
    }

    return null;
  } catch {
    return null;
  }
}

function dedupeJobs(jobs: ScrapedJob[]): ScrapedJob[] {
  const seen = new Map<string, ScrapedJob>();
  for (const j of jobs) {
    if (!seen.has(j.urlPath)) seen.set(j.urlPath, j);
  }
  return Array.from(seen.values());
}

/**
 * Walks an unknown JSON object and pulls out anything that looks like a job listing.
 * Looks for arrays of objects where each item has a title-like field plus any
 * id/location/url hints. Used by stealthFallbackScrape to recover jobs without
 * knowing the API's schema.
 */
function extractJobsFromUnknownJson(root: unknown, baseUrl: string): ScrapedJob[] {
  const found: ScrapedJob[] = [];
  const baseOrigin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return "";
    }
  })();

  function visit(node: unknown): void {
    if (!node) return;
    if (Array.isArray(node)) {
      // Is this an array of job-like objects?
      if (node.length >= 1 && typeof node[0] === "object") {
        const sample = node[0] as Record<string, unknown>;
        const titleKey = ["title", "name", "jobTitle", "position", "displayName", "text"].find((k) => typeof sample[k] === "string");
        const idKey = ["id", "jobId", "_id", "identifier", "slug", "absolute_url", "url", "applyUrl"].find((k) => sample[k] !== undefined);
        // "text" is broad enough to match nav links / FAQ entries / sidebar
        // cards. Require a co-occurring job hint when we'd be accepting "text"
        // as the title. Revolut's positions ({id, text, locations[], team})
        // still qualify via locations[]. Added 2026-05-18.
        const looksJobLike = titleKey !== "text" || hasJobHint(sample);
        if (titleKey && idKey && looksJobLike) {
          for (const item of node) {
            if (!item || typeof item !== "object") continue;
            const it = item as Record<string, unknown>;
            const title = typeof it[titleKey] === "string" ? (it[titleKey] as string) : "";
            if (!title || title.length < 3) continue;
            const location = extractLocation(it);
            const urlPath = extractUrl(it, baseOrigin);
            if (!urlPath) continue;
            found.push({ title, location, urlPath });
          }
          return; // don't recurse deeper into this array
        }
      }
      for (const child of node) visit(child);
      return;
    }
    if (typeof node === "object") {
      for (const v of Object.values(node as Record<string, unknown>)) visit(v);
    }
  }

  visit(root);
  return found;
}

/**
 * Used by extractJobsFromUnknownJson when the only title-shaped field is "text"
 * (broad). Returns true if the sample object also has a job-shaped sibling:
 * locations array, team/department string, or a URL whose path looks job-like.
 * Keeps Revolut positions matching while rejecting nav/FAQ/sidebar arrays.
 */
function hasJobHint(sample: Record<string, unknown>): boolean {
  if (Array.isArray(sample.locations) && sample.locations.length > 0) return true;
  if (typeof sample.team === "string" && sample.team.length > 0) return true;
  if (typeof sample.department === "string" && sample.department.length > 0) return true;
  const urlCandidate =
    (typeof sample.url === "string" && sample.url) ||
    (typeof sample.applyUrl === "string" && sample.applyUrl) ||
    (typeof sample.absolute_url === "string" && sample.absolute_url) ||
    "";
  if (urlCandidate && /\/(job|career|position|opening|role|posting)/i.test(urlCandidate)) return true;
  return false;
}

function extractLocation(obj: Record<string, unknown>): string {
  const candidates = ["location", "locations", "office", "city", "region"];
  for (const k of candidates) {
    const v = obj[k];
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const nested = (v as Record<string, unknown>).name || (v as Record<string, unknown>).city;
      if (typeof nested === "string") return nested;
    }
    if (Array.isArray(v) && v.length > 0) {
      const first = v[0];
      if (typeof first === "string") return first;
      if (first && typeof first === "object") {
        const nested = (first as Record<string, unknown>).name || (first as Record<string, unknown>).city;
        if (typeof nested === "string") return nested;
      }
    }
  }
  return "";
}

function extractUrl(obj: Record<string, unknown>, baseOrigin: string): string {
  const direct = obj.absolute_url || obj.url || obj.applyUrl || obj.apply_url;
  if (typeof direct === "string" && direct.startsWith("http")) return direct;
  const id = obj.id || obj.jobId || obj._id || obj.identifier || obj.slug;
  if (id !== undefined && baseOrigin) return `${baseOrigin}/jobs/${id}`;
  return typeof direct === "string" ? direct : "";
}


/**
 * Uber uses a JSON API instead of HTML job links.
 * Fetches jobs directly via POST to their API (no browser needed).
 */
async function scrapeUberCareers(careersUrl: string): Promise<ScrapedJob[]> {
  const url = new URL(careersUrl);
  const department = url.searchParams.get("department") || "Product";

  const allJobs: ScrapedJob[] = [];
  let pageNum = 0;

  while (true) {
    const res = await fetch(
      "https://www.uber.com/api/loadSearchJobsResults?localeCode=en",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": "x",
          "User-Agent":
            SCRAPER_UA,
        },
        body: JSON.stringify({
          limit: 50,
          page: pageNum,
          params: { department: [department] },
        }),
      }
    );

    const result = await res.json();
    if (result.status !== "success" || !result.data.results) break;

    const totalResults = result.data.totalResults?.low || 0;

    for (const job of result.data.results) {
      const locations = (job.allLocations || [])
        .map((l: { city: string; region?: string; country?: string }) =>
          l.region ? `${l.city}, ${l.region}` : `${l.city}, ${l.country}`
        )
        .join(" | ");

      allJobs.push({
        title: job.title,
        location: locations,
        urlPath: `https://www.uber.com/global/en/careers/list/${job.id}`,
      });
    }

    if (allJobs.length >= totalResults) break;
    pageNum++;
  }

  return allJobs;
}

/**
 * Shopify uses Ashby in embedded mode — the standard Ashby hosted board API returns
 * jobBoard: null for org slug "shopify". Their React Router v7 SPA at shopify.com/careers
 * renders all jobs server-side into a React Flight (RSC) streaming payload embedded in
 * the page HTML as `window.__reactRouterContext.streamController.enqueue(...)`.
 *
 * The payload is a deduplicated JSON array where field names appear once as string
 * literals (e.g., "title" at some index) and each job object references them by index
 * (e.g., {_<keyIdx>: <valueIdx>} → title = arr[valueIdx]). Indices shift on each CDN
 * deploy, so we resolve them dynamically by scanning for the known field-name strings.
 */
async function scrapeShopifyCareers(stats?: ScrapeStats): Promise<ScrapedJob[]> {
  let html: string;
  try {
    const res = await fetch("https://www.shopify.com/careers", {
      headers: { "User-Agent": SCRAPER_UA, Accept: "text/html" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.warn("Shopify: Failed to fetch careers page:", err);
    return [];
  }

  // Match every enqueue() call. Today there's one, but if Shopify ever chunks the
  // stream we'd silently under-count by parsing only the first. Concat all chunks.
  const enqueueRe = /window\.__reactRouterContext\.streamController\.enqueue\(([\s\S]*?)\);\s*<\/script>/g;
  const chunks: unknown[][] = [];
  let m: RegExpExecArray | null;
  while ((m = enqueueRe.exec(html)) !== null) {
    try {
      const outerStr = JSON.parse(m[1]) as string;
      const chunk = JSON.parse(outerStr) as unknown[];
      if (Array.isArray(chunk)) chunks.push(chunk);
    } catch (err) {
      console.warn("Shopify: Failed to parse one RSC chunk:", err);
    }
  }
  if (chunks.length === 0) {
    console.warn("Shopify: Could not find any streamController.enqueue() chunks in HTML");
    return [];
  }
  if (chunks.length > 1) {
    console.log(`Shopify: parsed ${chunks.length} RSC chunks`);
  }
  const arr: unknown[] = chunks.flat();
  if (arr.length === 0) {
    console.warn("Shopify: RSC array is empty after merging chunks");
    return [];
  }

  const KEY_FIELDS = ["title", "locationName", "locationExternalName", "workplaceType", "externalLink"] as const;
  type KeyField = typeof KEY_FIELDS[number];
  const keyIdx: Partial<Record<KeyField, number>> = {};
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v === "string" && KEY_FIELDS.includes(v as KeyField) && !(v in keyIdx)) {
      keyIdx[v as KeyField] = i;
    }
  }

  const extLinkKey = keyIdx["externalLink"];
  const titleKey = keyIdx["title"];
  if (extLinkKey === undefined || titleKey === undefined) {
    console.warn("Shopify: Could not locate required RSC key indices (title, externalLink)");
    return [];
  }

  const extLinkObjKey = `_${extLinkKey}`;
  const titleObjKey = `_${titleKey}`;
  const locExtObjKey = keyIdx["locationExternalName"] !== undefined ? `_${keyIdx["locationExternalName"]}` : null;
  const locNameObjKey = keyIdx["locationName"] !== undefined ? `_${keyIdx["locationName"]}` : null;
  const workplaceObjKey = keyIdx["workplaceType"] !== undefined ? `_${keyIdx["workplaceType"]}` : null;

  function deref(ref: unknown): string | null {
    if (typeof ref !== "number" || ref < 0 || ref >= arr.length) return null;
    const v = arr[ref];
    return typeof v === "string" ? v : null;
  }

  const SHOPIFY_JOB_URL_RE = /^https:\/\/www\.shopify\.com\/careers\?ashby_jid=[a-f0-9-]{36}$/;
  const allRaw: ScrapedJob[] = [];

  for (let i = 0; i < arr.length; i++) {
    const obj = arr[i];
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) continue;
    const record = obj as Record<string, unknown>;
    if (!(extLinkObjKey in record)) continue;

    const extLink = deref(record[extLinkObjKey]);
    if (!extLink || !SHOPIFY_JOB_URL_RE.test(extLink)) continue;

    const title = deref(record[titleObjKey]);
    if (!title) continue;

    const locationExt = locExtObjKey ? deref(record[locExtObjKey]) : null;
    const locationName = locNameObjKey ? deref(record[locNameObjKey]) : null;
    const workplace = workplaceObjKey ? deref(record[workplaceObjKey]) : null;
    const location = (locationExt || locationName || workplace || "").trim();

    allRaw.push({ title: title.trim(), location, urlPath: extLink });
  }

  if (stats) stats.totalScanned = allRaw.length;
  console.log(`Shopify: Found ${allRaw.length} total jobs in RSC payload`);

  const pmJobs = allRaw.filter((job) => {
    const lower = job.title.toLowerCase();
    return PM_KEYWORDS.some((kw) => lower.includes(kw));
  });
  console.log(`Shopify: ${pmJobs.length} PM roles after keyword filter`);
  return pmJobs;
}

interface PhenomJob {
  title?: string;
  location?: string;
  cityState?: string;
  city?: string;
  state?: string;
  reqId?: string;
  jobId?: string;
}

/**
 * Phenom People ATS scraper. Used by eBay (and other enterprises like Cisco).
 *
 * Phenom is a JS-heavy career-site platform. Their OAuth API requires credentials,
 * and the widget POST API only returns config/counts. The server pre-renders exactly
 * 10 jobs in the inline phApp.ddo["eagerLoadRefineSearch"] object — all further
 * pagination is client-side Vue 3 JS (not reproducible server-side).
 *
 * We GET the search-results page with keyword=product+manager, parse the DDO, and
 * return the 10 pre-rendered jobs. stats.totalScanned is set to totalHits so the
 * self-healing tier knows the source is live (not broken) even if we capture a
 * first-page sample.
 *
 * Known limitation: capture is 10/page only. For eBay that's typically 3-6 PMs after
 * US filter — partial coverage, but unblocks auto-disable.
 */
async function scrapePhenomCareers(
  baseDomain: string,
  companyLabel: string,
  stats?: ScrapeStats
): Promise<ScrapedJob[]> {
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(baseDomain)) {
    // Return [] instead of throwing so self-healing tiers 2+3 can run.
    // A missing https:// prefix is a misconfigured platform_config, not a
    // transient network error — self-healing may auto-detect the right platform.
    console.warn(`${companyLabel}: Invalid Phenom baseDomain (expected https://... URL): ${baseDomain} — yielding to self-healing`);
    return [];
  }

  const searchUrl = `${baseDomain}/us/en/search-results?keywords=product+manager`;
  console.log(`${companyLabel}: Phenom DDO scraper → ${searchUrl}`);

  let html: string;
  try {
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          SCRAPER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      // Return [] instead of throwing so the self-healing tier runs on transient 5xx
      // and a single bad day doesn't ratchet auto-disable.
      console.warn(`${companyLabel}: Phenom returned HTTP ${res.status} — yielding to stealth fallback`);
      return [];
    }
    html = await res.text();
  } catch (err) {
    console.warn(`${companyLabel}: Phenom fetch failed:`, err);
    return [];
  }

  const DDO_START = "phApp.ddo = ";
  const DDO_END = "; phApp.experimentData =";
  const start = html.indexOf(DDO_START);
  const end = html.indexOf(DDO_END, start);
  if (start === -1 || end === -1) {
    console.warn(`${companyLabel}: phApp.ddo boundaries not found`);
    return [];
  }

  let ddo: Record<string, unknown>;
  try {
    ddo = JSON.parse(html.slice(start + DDO_START.length, end)) as Record<string, unknown>;
  } catch {
    console.warn(`${companyLabel}: Failed to JSON-parse phApp.ddo`);
    return [];
  }

  const searchData = ddo["eagerLoadRefineSearch"] as
    | { status?: number; totalHits?: number; data?: { jobs?: PhenomJob[] } }
    | undefined;
  if (!searchData || searchData.status !== 200) {
    console.warn(`${companyLabel}: eagerLoadRefineSearch missing or non-200 (status ${searchData?.status})`);
    return [];
  }

  const totalHits = searchData.totalHits ?? 0;
  const rawJobs: PhenomJob[] = searchData.data?.jobs ?? [];
  if (stats) stats.totalScanned = totalHits;

  console.log(`${companyLabel}: Phenom returned ${rawJobs.length} server-rendered jobs (totalHits: ${totalHits})`);

  const pmJobs = rawJobs.filter((job) => {
    const lowerTitle = (job.title ?? "").toLowerCase();
    return PM_KEYWORDS.some((kw) => lowerTitle.includes(kw));
  });
  console.log(`${companyLabel}: ${pmJobs.length} PM roles after keyword filter`);

  return pmJobs.map((job) => ({
    title: job.title ?? "",
    location: job.location ?? job.cityState ?? job.city ?? "",
    urlPath: `${baseDomain}/us/en/job/${job.reqId ?? job.jobId ?? ""}`,
  }));
}

/** eBay uses Phenom People (tenant EBAEBAUS) at jobs.ebayinc.com. */
async function scrapeEbayCareers(stats?: ScrapeStats): Promise<ScrapedJob[]> {
  return scrapePhenomCareers("https://jobs.ebayinc.com", "eBay", stats);
}

/**
 * Generic SAP SuccessFactors career portal scraper.
 * Works for any SF tenant that exposes a server-rendered search page at
 * {baseUrl}/search?q=product+manager&startrow=N (25 results/page, standard
 * SF template). Confirmed: EY (careers.ey.com).
 */
async function scrapeSuccessFactorsCareers(
  baseUrl: string,
  companyLabel: string,
  stats?: ScrapeStats
): Promise<ScrapedJob[]> {
  console.log(`${companyLabel}: SuccessFactors portal at ${baseUrl}`);
  const allJobs: ScrapedJob[] = [];
  const pageSize = 25;
  const MAX_PAGES = 20;
  let startRow = 0;
  let scanned = 0;
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${baseUrl}/search?locale=en_US&q=product+manager${startRow > 0 ? `&startrow=${startRow}` : ""}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          SCRAPER_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`${companyLabel}: SuccessFactors returned ${res.status} — stopping pagination`);
      break;
    }
    const html = await res.text();

    const rowPattern = /<tr[^>]+class="data-row"[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch;
    let rowsOnPage = 0;
    while ((rowMatch = rowPattern.exec(html)) !== null) {
      const row = rowMatch[1];
      const titleMatch = row.match(/class="jobTitle-link"[^>]*>([\s\S]*?)<\/a>/);
      const hrefMatch = row.match(/href="([^"]+)"/);
      if (!titleMatch || !hrefMatch) continue;

      const locMatch = row.match(/<span[^>]+class="jobLocation"[^>]*>([\s\S]*?)<\/span>/);
      const locRaw = locMatch ? locMatch[1].replace(/<[^>]+>/g, "").trim() : "";
      const location = locRaw.replace(/\+\d+\s*more[^,]*/gi, "").replace(/\s+/g, " ").trim();

      const href = hrefMatch[1].startsWith("http") ? hrefMatch[1] : `${baseUrl}${hrefMatch[1]}`;
      if (seen.has(href)) continue;
      seen.add(href);

      allJobs.push({
        title: titleMatch[1].trim(),
        location,
        urlPath: href,
      });
      rowsOnPage++;
    }
    scanned += rowsOnPage;
    if (rowsOnPage < pageSize) break;
    startRow += pageSize;
    await new Promise((r) => setTimeout(r, 300));
  }

  if (stats) stats.totalScanned = scanned;
  console.log(`${companyLabel}: SuccessFactors yielded ${allJobs.length} jobs`);
  return allJobs;
}

/**
 * KPMG US careers — kpmguscareers.com is a custom WordPress site backed by a
 * bespoke PHP search endpoint that returns JSON with HTML job listings.
 * NOT a SuccessFactors instance (despite KPMG's SSO referencing SF for internal
 * employees). Scraper is KPMG-specific.
 */
async function scrapeKPMGCareers(stats?: ScrapeStats): Promise<ScrapedJob[]> {
  console.log("KPMG: Scraping WordPress job board");
  const BASE = "https://www.kpmguscareers.com";
  const SEARCH_URL = `${BASE}/wp-content/themes/understrap-child-main/page-templates/google/get-jobs.php`;
  const allJobs: ScrapedJob[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  for (let page = 1; page <= 20; page++) {
    const url = `${SEARCH_URL}?ajax=1&keyword=product+manager&spage=${page}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          SCRAPER_UA,
        Referer: `${BASE}/job-search/`,
        Accept: "application/json, text/javascript, */*",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`KPMG: get-jobs returned ${res.status} — stopping`);
      break;
    }
    const data = (await res.json()) as {
      postings?: { jobs?: string; size?: number };
      pagination?: string;
    };
    if (!data.postings?.jobs) break;

    const html = data.postings.jobs;
    scanned += (html.match(/<a href="\/jobdetail\//g) || []).length;

    const cardPattern = /<a href="(\/jobdetail\/\?jobId=[^"]+)"[^>]*>[\s\S]*?class="h5 text-dark-grey">([\s\S]*?)<\/div>[\s\S]*?class="text-xs text-dark-grey">([\s\S]*?)<\/div>/g;
    let match;
    let rowsOnPage = 0;
    while ((match = cardPattern.exec(html)) !== null) {
      const [, jobPath, titleRaw, locationRaw] = match;
      const urlPath = `${BASE}${jobPath}`;
      if (seen.has(urlPath)) continue;
      seen.add(urlPath);

      const locationFull = locationRaw.replace(/<[^>]+>/g, "").trim();
      const pipeParts = locationFull.split("|");
      const citiesPart = pipeParts.length > 1 ? pipeParts[1].trim() : locationFull;
      const location = citiesPart.split(";")[0].trim();

      allJobs.push({
        title: titleRaw.replace(/<[^>]+>/g, "").trim(),
        location,
        urlPath,
      });
      rowsOnPage++;
    }
    if (rowsOnPage === 0) break;

    const hasNextPage = data.pagination
      ? new RegExp(`data-href="${page + 1}"`).test(data.pagination)
      : false;
    if (!hasNextPage) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  if (stats) stats.totalScanned = scanned;
  console.log(`KPMG: Found ${allJobs.length} jobs`);
  return allJobs;
}

/**
 * Goldman Sachs "Higher" — proprietary Next.js SPA with an unauthenticated
 * GraphQL backend at api-higher.gs.com. CF allows server-side POSTs through.
 * Confirmed: 816 total jobs, ~61 US in first page.
 */
async function scrapeGoldmanSachsCareers(stats?: ScrapeStats): Promise<ScrapedJob[]> {
  console.log("Goldman Sachs: Higher GraphQL API");
  const GS_GRAPHQL_URL = "https://api-higher.gs.com/gateway/api/v1/graphql";
  const PAGE_SIZE = 100;
  const allJobs: ScrapedJob[] = [];
  let pageNumber = 0;
  let totalCount = Infinity;

  const QUERY = `
    query GetRoles($searchQueryInput: RoleSearchQueryInput!) {
      roleSearch(searchQueryInput: $searchQueryInput) {
        totalCount
        items {
          roleId
          jobTitle
          locations { primary state country city }
          status
        }
      }
    }
  `;

  interface GSLoc { primary: boolean; state: string | null; country: string | null; city: string | null; }
  interface GSItem { roleId: string; jobTitle: string; locations: GSLoc[]; status: string; }

  while (allJobs.length < totalCount && pageNumber < 20) {
    const res = await fetch(GS_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://higher.gs.com",
        Referer: "https://higher.gs.com/results",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        operationName: "GetRoles",
        variables: {
          searchQueryInput: {
            page: { pageSize: PAGE_SIZE, pageNumber },
            experiences: ["PROFESSIONAL", "EARLY_CAREER"],
            searchTerm: "product manager",
            filters: [],
          },
        },
        query: QUERY,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`Goldman Sachs: GraphQL returned ${res.status} — stopping`);
      break;
    }
    const data = (await res.json()) as {
      data?: { roleSearch?: { totalCount: number; items: GSItem[] } };
      errors?: Array<{ message: string }>;
    };
    if (data.errors?.length) {
      console.warn(`Goldman Sachs: GraphQL error: ${data.errors[0].message}`);
      break;
    }
    const roleSearch = data.data?.roleSearch;
    if (!roleSearch) break;

    totalCount = roleSearch.totalCount;
    if (roleSearch.items.length === 0) break;

    for (const item of roleSearch.items) {
      if (item.status !== "POSTED") continue;
      const primaryLoc = item.locations.find((l) => l.primary) ?? item.locations[0];
      const location = primaryLoc
        ? [primaryLoc.city, primaryLoc.state, primaryLoc.country].filter(Boolean).join(", ")
        : "";
      allJobs.push({
        title: item.jobTitle,
        location,
        urlPath: `https://higher.gs.com/roles/${item.roleId}`,
      });
    }

    pageNumber++;
    if (allJobs.length >= totalCount) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (stats) stats.totalScanned = totalCount === Infinity ? allJobs.length : totalCount;
  console.log(`Goldman Sachs: ${allJobs.length} jobs (${totalCount === Infinity ? "?" : totalCount} in index)`);
  return allJobs;
}

/**
 * Revolut self-hosted careers (Next.js SSG). CF challenges HTML at /careers
 * but allows /_next/data/{buildId}/careers.json through. ~681 positions.
 * The buildId rotates on each Revolut deploy → on 404 we return [] so the
 * stealth tier can resniff the new buildId.
 */
async function scrapeRevolutCareers(buildId: string, stats?: ScrapeStats): Promise<ScrapedJob[]> {
  const dataUrl = `https://www.revolut.com/_next/data/${buildId}/careers.json`;
  interface RevolutLoc { name: string; type: string; country: string; }
  interface RevolutPos { id: string; text: string; locations: RevolutLoc[]; team: string; }
  let positions: RevolutPos[] = [];

  try {
    const res = await fetch(dataUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
        "x-nextjs-data": "1",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 404) {
      console.warn(`Revolut: _next/data 404 — buildId "${buildId}" is stale. Yield to stealth.`);
      return [];
    }
    if (!res.ok) {
      console.warn(`Revolut: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { pageProps?: { positions?: RevolutPos[] } };
    positions = data?.pageProps?.positions ?? [];
  } catch (err) {
    console.warn("Revolut: fetch failed:", err);
    return [];
  }

  if (stats) stats.totalScanned = positions.length;
  console.log(`Revolut: ${positions.length} positions from _next/data`);

  const pmJobs: ScrapedJob[] = [];
  for (const pos of positions) {
    const title = (pos.text ?? "").trim();
    const lowerTitle = title.toLowerCase();
    if (!PM_KEYWORDS.some((kw) => lowerTitle.includes(kw))) continue;

    const usLoc = pos.locations?.find((l) => l.country === "United States");
    const location = usLoc ? usLoc.name : pos.locations?.[0]?.name ?? "";

    pmJobs.push({
      title,
      location,
      urlPath: `https://www.revolut.com/careers/position/${pos.id}`,
    });
  }

  console.log(`Revolut: ${pmJobs.length} PM matches`);
  return pmJobs;
}

/**
 * Walks `text` from startIdx (a `{` character) to the matching `}`, respecting
 * JSON string quoting and escapes. Returns the substring including both braces,
 * or null if no balanced close is found. Used by scrapeDeelCareers to safely
 * slice a job envelope out of the RSC stream before JSON.parse.
 */
function sliceBalancedObject(text: string, startIdx: number): string | null {
  if (text.charCodeAt(startIdx) !== 0x7b /* { */) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === 0x5c /* \ */) { escape = true; continue; }
      if (c === 0x22 /* " */) { inString = false; }
      continue;
    }
    if (c === 0x22 /* " */) { inString = true; continue; }
    if (c === 0x7b /* { */) depth++;
    else if (c === 0x7d /* } */) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

/**
 * Deel job board (jobs.deel.com/{slug}) — Next.js SPA. Use RSC: 1 header to
 * get the React Server Components payload which contains all positions as
 * JSON objects. Generic across Deel customers — Klarna confirmed (106 jobs).
 *
 * Parsing strategy: find each job-envelope start via a tight regex (id + jobId
 * UUIDs + title prefix), then bracket-balance-slice the full object and
 * JSON.parse. Beats the old single-regex approach which truncated jobLocations
 * on the first `]` (breaking if any nested array appeared) and only ever read
 * the first location (always Stockholm for Klarna). Picks the most US-leaning
 * location when multiple are present.
 */
async function scrapeDeelCareers(orgSlug: string, label: string, stats?: ScrapeStats): Promise<ScrapedJob[]> {
  let text: string;
  try {
    const res = await fetch(`https://jobs.deel.com/${orgSlug}`, {
      headers: {
        "User-Agent": SCRAPER_UA,
        RSC: "1",
        Accept: "text/plain",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`Deel [${label}]: HTTP ${res.status}`);
      return [];
    }
    text = await res.text();
  } catch (err) {
    console.warn(`Deel [${label}]: fetch failed:`, err);
    return [];
  }

  // Envelope-start regex: id + jobId UUIDs + title key. We then balance-slice
  // forward to get the full JSON object.
  const ENVELOPE_START = /\{"id":"[0-9a-f-]{36}","jobId":"[0-9a-f-]{36}","title":/g;
  const allRaw: ScrapedJob[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = ENVELOPE_START.exec(text)) !== null) {
    const slice = sliceBalancedObject(text, m.index);
    if (!slice) continue;
    let obj: { id?: string; title?: string; jobLocations?: Array<{ name?: string }> };
    try {
      obj = JSON.parse(slice);
    } catch {
      continue;
    }
    if (!obj.id || !obj.title || seen.has(obj.id)) continue;
    seen.add(obj.id);

    const locations = Array.isArray(obj.jobLocations)
      ? obj.jobLocations.map((l) => (typeof l?.name === "string" ? l.name : "")).filter(Boolean)
      : [];
    // Prefer US-leaning location when multi-location: Klarna's payload always
    // sorts Stockholm first, so picking [0] hides any US sites.
    const preferredLoc =
      locations.find((loc) => /united states|, usa\b|, us\b/i.test(loc)) ||
      locations.find((loc) => /\b(NY|CA|TX|WA|MA|IL|GA|NC|FL|CO|AZ|VA|PA|OH|MI|NJ|MN|TN|OR|UT)\b/.test(loc)) ||
      locations[0] ||
      "";

    allRaw.push({
      title: obj.title.trim(),
      location: preferredLoc,
      urlPath: `https://jobs.deel.com/${orgSlug}/${obj.id}`,
    });
  }

  if (stats) stats.totalScanned = allRaw.length;
  console.log(`Deel [${label}]: Found ${allRaw.length} jobs via RSC`);
  return allRaw;
}


export async function scrapeCompanyCareers(
  careersUrl: string,
  platformType?: string | null,
  platformConfig?: Record<string, string> | null,
  stats?: ScrapeStats
): Promise<ScrapedJob[]> {
  // Platform-based routing (for detected/cached platforms)
  if (platformType && platformConfig) {
    const label = platformConfig.company || platformConfig.boardName || platformConfig.handle || platformConfig.orgName || "Company";
    switch (platformType) {
      case "greenhouse":
        if (platformConfig.boardName) {
          return scrapeGreenhouseCareers(platformConfig.boardName, label, stats);
        }
        break;
      case "greenhouse_departments":
        if (platformConfig.boardName) {
          return scrapeGreenhouseDepartments(platformConfig.boardName, label, stats);
        }
        break;
      case "lever":
        if (platformConfig.handle) {
          return scrapeLeverCareers(platformConfig.handle, label);
        }
        break;
      case "ashby":
        if (platformConfig.orgName) {
          return scrapeAshbyCareers(platformConfig.orgName, label, stats);
        }
        break;
      case "workday":
        if (platformConfig.tenant && platformConfig.subdomain && platformConfig.boardPath) {
          return scrapeWorkdayCareers(platformConfig.tenant, platformConfig.subdomain, platformConfig.boardPath, label, stats);
        }
        break;
      case "eightfold":
        return scrapeEightfoldCareers(platformConfig.careersUrl || careersUrl);
      case "smartrecruiters":
        if (platformConfig.company) {
          return scrapeSmartRecruitersCareers(platformConfig.company, label);
        }
        break;
      case "icims": {
        // Some iCIMS deployments expose a public /api/jobs endpoint that
        // returns clean JSON — much faster and more reliable than the
        // Puppeteer DOM scraper. Route those by hostname before falling
        // through to the legacy Puppeteer path. DEV-18: keeps Rivian
        // working in spite of the modern Jibe template (which the
        // Puppeteer selectors don't recognize).
        const baseUrl = platformConfig.baseUrl || careersUrl;
        if (ICIMS_API_HOSTS.some((host) => baseUrl.includes(host))) {
          return scrapeICIMSAPICareers(baseUrl.replace(/\/+$/, ""), label, "product manager");
        }
        return scrapeICIMSCareers(platformConfig.company || label, baseUrl, label);
      }
      case "oracle_hcm":
        if (platformConfig.tenantUrl && platformConfig.siteNumber) {
          return scrapeOracleHCMCareers(platformConfig.tenantUrl, platformConfig.siteNumber, label);
        }
        break;
      case "apple":
        return scrapeAppleCareers(stats);
      case "shopify":
        return scrapeShopifyCareers(stats);
      case "phenom":
        if (platformConfig.baseDomain) {
          return scrapePhenomCareers(platformConfig.baseDomain, label, stats);
        }
        break;
      case "successfactors":
        if (platformConfig.baseUrl) {
          return scrapeSuccessFactorsCareers(platformConfig.baseUrl, label, stats);
        }
        break;
      case "revolut":
        if (platformConfig.buildId) {
          return scrapeRevolutCareers(platformConfig.buildId, stats);
        }
        break;
      case "deel":
        if (platformConfig.orgSlug) {
          return scrapeDeelCareers(platformConfig.orgSlug, label, stats);
        }
        break;
      case "custom_api":
        // Fall through to hostname-based routing below
        break;
      case "generic":
        // Fall through to generic Puppeteer below
        break;
    }
  }

  // --- Hostname-based routing: resolve BEFORE launching Puppeteer ---
  const hostname = new URL(careersUrl).hostname;

  // Custom scrapers — bespoke logic, not ATS-backed
  if (hostname.includes("ea.com") || hostname.includes("jobs.ea.com")) {
    console.log("Detected EA careers page, using Avature HTML scraper");
    return scrapeEACareers(stats);
  }
  if (hostname.includes("atlassian.com")) {
    console.log("Detected Atlassian careers page, using API scraper");
    return scrapeAtlassianCareers();
  }
  if (hostname.includes("netflix.net") || hostname.includes("netflix.com")) {
    console.log("Detected Netflix careers page, using API scraper");
    return scrapeNetflixCareers(careersUrl);
  }
  // Stripe migrated to Greenhouse (2026-03-30) — now handled via atsRegistry
  // if (hostname.includes("stripe.com")) { ... }
  if (hostname.includes("uber.com")) {
    console.log("Detected Uber careers page, using API scraper");
    return scrapeUberCareers(careersUrl);
  }
  if (hostname.includes("google.com") && careersUrl.includes("/careers/")) {
    console.log("Detected Google careers page, using custom scraper");
    return scrapeGoogleCareers(careersUrl);
  }
  if (hostname.includes("coinbase.com")) {
    console.log("Detected Coinbase careers page, using Puppeteer + intercept");
    return scrapeCoinbaseCareers();
  }
  if (hostname.includes("jobs.apple.com") || hostname === "apple.com" || hostname.endsWith(".apple.com")) {
    console.log("Detected Apple careers page, using REST API scraper");
    return scrapeAppleCareers(stats);
  }
  // Meta + TikTok: known to actively block server-side requests. Short-circuit to []
  // so the configured-scraper tier yields nothing, broadATSDiscovery is blocked by
  // CUSTOM_SCRAPER_HOSTS, and stealthFallbackScrape gets the real attempt.
  if (hostname.includes("metacareers.com") || hostname === "meta.com" || hostname.endsWith(".meta.com")) {
    console.log("Detected Meta careers page — yielding to stealth fallback");
    return [];
  }
  if (hostname.includes("tiktok.com")) {
    console.log("Detected TikTok careers page — yielding to stealth fallback");
    return [];
  }
  // Tesla + Wayfair: Workday is auth-gated/edge-blocked. Same yield-to-stealth pattern.
  if (hostname === "tesla.com" || hostname.endsWith(".tesla.com") || hostname.includes("tesla.wd")) {
    console.log("Detected Tesla careers page — yielding to stealth fallback");
    return [];
  }
  if (hostname.includes("wayfair.com") || hostname.includes("wayfair.wd")) {
    console.log("Detected Wayfair careers page — yielding to stealth fallback");
    return [];
  }
  if (hostname === "www.shopify.com" || hostname === "shopify.com") {
    console.log("Detected Shopify careers page, using RSC embedded scraper");
    return scrapeShopifyCareers(stats);
  }
  if (hostname.includes("ebayinc.com")) {
    console.log("Detected eBay careers page (Phenom), using Phenom DDO scraper");
    return scrapeEbayCareers(stats);
  }
  if (hostname.includes("higher.gs.com") || hostname === "gs.com" || hostname.endsWith(".gs.com")) {
    console.log("Detected Goldman Sachs careers page, using Higher GraphQL scraper");
    return scrapeGoldmanSachsCareers(stats);
  }
  if (hostname === "jobs.deel.com") {
    const deelSlug = new URL(careersUrl).pathname.replace(/^\//, "").split("/")[0];
    console.log(`Detected Deel job board (slug=${deelSlug}), using RSC scraper`);
    // label and slug match here — when a Deel company is configured in DB with
    // platform_type="deel", the platform_type switch above passes the company's
    // proper label.
    return scrapeDeelCareers(deelSlug, deelSlug, stats);
  }
  if (hostname.includes("kpmguscareers.com")) {
    console.log("Detected KPMG careers page, using WordPress scraper");
    return scrapeKPMGCareers(stats);
  }

  // ATS registry lookup — replaces per-company hostname checks for standard ATS platforms
  const registryEntry = lookupATSRegistry(hostname);
  if (registryEntry) {
    const { platformType: regType, platformConfig: regConfig, label } = registryEntry;
    console.log(`Registry match: ${label} → ${regType} (${JSON.stringify(regConfig)})`);

    switch (regType) {
      case "greenhouse":
        return scrapeGreenhouseCareers(regConfig.boardName, label, stats);
      case "greenhouse_departments":
        return scrapeGreenhouseDepartments(regConfig.boardName, label, stats);
      case "lever":
        return scrapeLeverCareers(regConfig.handle, label);
      case "ashby":
        return scrapeAshbyCareers(regConfig.orgName, label, stats);
      case "workday":
        return scrapeWorkdayCareers(regConfig.tenant, regConfig.subdomain, regConfig.boardPath, label, stats);
    }
  }

  // Lever: jobs.lever.co/{handle}
  if (hostname === "jobs.lever.co") {
    const handle = new URL(careersUrl).pathname.split("/")[1];
    if (handle) {
      console.log(`Detected Lever careers page, using API scraper (handle: ${handle})`);
      return scrapeLeverCareers(handle, handle);
    }
  }

  // Ashby: jobs.ashbyhq.com/{org}
  if (hostname === "jobs.ashbyhq.com") {
    const orgName = new URL(careersUrl).pathname.split("/")[1];
    if (orgName && orgName !== "api") {
      console.log(`Detected Ashby careers page, using API scraper (org: ${orgName})`);
      return scrapeAshbyCareers(orgName, orgName, stats);
    }
  }

  // Generic Workday: *.myworkdayjobs.com
  if (hostname.endsWith(".myworkdayjobs.com") && !careersUrl.includes("myworkdayjobs.com/Slack")) {
    const parts = hostname.split(".");
    const wdTenant = parts[0];
    const wdSubdomain = parts[1];
    const wdBoardPath = new URL(careersUrl).pathname.split("/").filter(Boolean)[0] || "";
    console.log(`Detected Workday careers page (${wdTenant}.${wdSubdomain}/${wdBoardPath})`);
    return scrapeWorkdayCareers(wdTenant, wdSubdomain, wdBoardPath, wdTenant, stats);
  }

  // Eightfold.ai platform (PayPal, etc.): use their JSON API with pagination
  if (hostname.includes("eightfold.ai")) {
    console.log("Detected Eightfold.ai careers page, using API scraper");
    return scrapeEightfoldCareers(careersUrl);
  }

  // SmartRecruiters: jobs.smartrecruiters.com/{company}
  if (hostname === "jobs.smartrecruiters.com") {
    const company = new URL(careersUrl).pathname.split("/")[1];
    if (company) {
      console.log(`Detected SmartRecruiters careers page (company: ${company})`);
      return scrapeSmartRecruitersCareers(company, company);
    }
  }

  // iCIMS: *.icims.com
  if (hostname.endsWith(".icims.com")) {
    const slug = hostname.replace(/\.icims\.com$/, "").replace(/^careers-/, "");
    console.log(`Detected iCIMS careers page (company: ${slug})`);
    return scrapeICIMSCareers(slug, careersUrl, slug);
  }

  // Amazon Jobs API
  if (hostname.includes("amazon.jobs")) {
    console.log("Detected Amazon Jobs page, using API scraper");
    return scrapeAmazonCareers();
  }

  // iCIMS API-based sites (Rivian, Costco)
  if (hostname.includes("careers.rivian.com")) {
    console.log("Detected Rivian careers (iCIMS API), using API scraper");
    return scrapeICIMSAPICareers("https://careers.rivian.com", "Rivian", "product manager");
  }
  if (hostname.includes("careers.costco.com")) {
    console.log("Detected Costco careers (iCIMS API), using API scraper");
    return scrapeICIMSAPICareers("https://careers.costco.com", "Costco", "product manager");
  }

  // Intuit TalentBrew
  if (hostname.includes("intuit.com")) {
    console.log("Detected Intuit careers page, using TalentBrew scraper");
    return scrapeIntuitCareers();
  }

  // --- Generic Puppeteer fallback: only launch Chrome for truly unknown companies ---
  console.log(`No ATS match for ${hostname}, falling back to generic Puppeteer scraper`);
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  // Wrap entire generic scraper in 120s timeout to prevent cron hangs
  const GENERIC_TIMEOUT_MS = 120_000;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Generic scraper timed out after ${GENERIC_TIMEOUT_MS / 1000}s`)), GENERIC_TIMEOUT_MS)
  );

  try {
    const scrapeWork = async () => {
    const page = await browser.newPage();
    await page.setUserAgent(
      SCRAPER_UA
    );

    await page.goto(careersUrl, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Try clicking department/category tabs with "Product" in the text
    try {
      const clickedTab = await page.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll('button, a, [role="tab"], [class*="tab"], [class*="filter"], [class*="category"]')
        );
        for (const el of candidates) {
          const text = (el.textContent || "").trim().toLowerCase();
          if (/^product\b/.test(text) && text.length < 40) {
            (el as HTMLElement).click();
            return text;
          }
        }
        return null;
      });
      if (clickedTab) {
        console.log(`Generic: Clicked "${clickedTab}" tab/filter`);
        await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch {
      // Tab clicking is best-effort
    }

    // Infinite scroll: scroll to bottom up to 15 times to load lazy content
    let previousHeight = 0;
    for (let i = 0; i < 15; i++) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === previousHeight) break;
      previousHeight = currentHeight;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 1500));
      await page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {});
    }

    // Try clicking "Show More" / "Load More" / "View More" buttons repeatedly
    for (let i = 0; i < 10; i++) {
      try {
        // CSS-based selectors
        let loadMoreBtn = await page.$(
          '[class*="load-more"], [class*="show-more"], [class*="view-more"], [class*="loadMore"], [class*="showMore"]'
        );

        // Text-based matching fallback
        if (!loadMoreBtn) {
          const textBtn = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll("button, a"));
            const textPatterns = ["load more", "show more", "view more", "see more", "see all"];
            for (const btn of buttons) {
              const text = (btn.textContent || "").trim().toLowerCase();
              if (textPatterns.some((p) => text === p || text.startsWith(p))) {
                // Add a temporary attribute so we can select it
                btn.setAttribute("data-load-more-found", "true");
                return true;
              }
            }
            return false;
          });

          if (textBtn) {
            loadMoreBtn = await page.$('[data-load-more-found="true"]');
          }

          if (!loadMoreBtn) break;
        }

        if (!loadMoreBtn) break;
        const isVisible = await loadMoreBtn.isVisible();
        if (!isVisible) break;
        await loadMoreBtn.click();
        await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 1000));
      } catch {
        break;
      }
    }

    const baseUrl = new URL(careersUrl).origin;

    // Phase 1: Try section-based extraction
    const sectionJobs = await extractJobsFromProductSections(page, baseUrl);
    if (sectionJobs && sectionJobs.length > 0) {
      console.log(
        `Found ${sectionJobs.length} jobs in product section(s) on first page`
      );

      const allJobs = new Map<string, ScrapedJob>();
      for (const job of sectionJobs) {
        allJobs.set(job.urlPath, job);
      }

      await paginateAndCollect(page, baseUrl, allJobs, true);
      return Array.from(allJobs.values());
    }

    // Phase 2: No product sections found — extract all job links via URL regex
    console.log("No product sections found, extracting all jobs from page");
    const allJobs = new Map<string, ScrapedJob>();

    const pageJobs = await extractAllJobsFromPage(page, baseUrl);
    for (const job of pageJobs) {
      allJobs.set(job.urlPath, job);
    }

    await paginateAndCollect(page, baseUrl, allJobs, false);

    if (allJobs.size > 0) {
      return Array.from(allJobs.values());
    }

    // Phase 3: JSON-LD structured data (Schema.org JobPosting)
    console.log("Generic: Phase 2 found 0 jobs, trying JSON-LD extraction");
    const jsonLdJobs = await extractJobsFromJsonLd(page, baseUrl);
    if (jsonLdJobs.length > 0) {
      console.log(`Generic: Found ${jsonLdJobs.length} jobs from JSON-LD`);
      return jsonLdJobs;
    }

    // Phase 4: Broader URL pattern matching (query params, additional paths)
    console.log("Generic: No JSON-LD, trying broad URL matching");
    const broadJobs = await extractJobsFromBroadUrlMatch(page, baseUrl);
    if (broadJobs.length > 0) {
      console.log(`Generic: Found ${broadJobs.length} jobs from broad URL matching`);
      return broadJobs;
    }

    // Phase 5: DOM structure heuristic (repeated elements with links)
    console.log("Generic: No broad URL matches, trying DOM structure heuristic");
    const structJobs = await extractJobsFromDomStructure(page, baseUrl);
    if (structJobs.length > 0) {
      console.log(`Generic: Found ${structJobs.length} jobs from DOM structure`);
      return structJobs;
    }

    console.log("Generic: All phases returned 0 jobs");
    return [];
    }; // end scrapeWork

    return await Promise.race([scrapeWork(), timeoutPromise]);
  } finally {
    await browser.close();
  }
}

async function paginateAndCollect(
  page: Page,
  baseUrl: string,
  allJobs: Map<string, ScrapedJob>,
  useSections: boolean
): Promise<void> {
  for (let pageNum = 0; pageNum < 20; pageNum++) {
    try {
      const nextBtn = await page.$(
        'button[aria-label="Next"]:not([disabled]), a[aria-label="Next"]:not([disabled]), button[aria-label="next"]:not([disabled]), a[aria-label="next"]:not([disabled]), [class*="pagination"] button[aria-label*="ext"]:not([disabled])'
      );

      if (!nextBtn) break;
      const isVisible = await nextBtn.isVisible();
      if (!isVisible) break;

      const isDisabled = await nextBtn.evaluate(
        (el) =>
          el.hasAttribute("disabled") ||
          el.classList.contains("disabled") ||
          el.getAttribute("aria-disabled") === "true"
      );
      if (isDisabled) break;

      await nextBtn.click();
      await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));

      const pageJobs = useSections
        ? await extractJobsFromProductSections(page, baseUrl)
        : await extractAllJobsFromPage(page, baseUrl);

      let newFound = false;
      for (const job of pageJobs || []) {
        if (!allJobs.has(job.urlPath)) {
          allJobs.set(job.urlPath, job);
          newFound = true;
        }
      }

      if (!newFound) break;
    } catch {
      break;
    }
  }
}
