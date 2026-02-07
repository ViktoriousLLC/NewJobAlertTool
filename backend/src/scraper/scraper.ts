import puppeteer, { Page } from "puppeteer";

export interface ScrapedJob {
  title: string;
  location: string;
  urlPath: string;
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
const PM_KEYWORDS = [
  "product manager",
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
  companyLabel: string
): Promise<ScrapedJob[]> {
  console.log(`${companyLabel}: Fetching jobs from Greenhouse API (board: ${boardName})`);

  const response = await fetch(
    `https://api.greenhouse.io/v1/boards/${boardName}/jobs`
  );

  if (!response.ok) {
    throw new Error(`${companyLabel}: Greenhouse API returned ${response.status}`);
  }

  const data: GreenhouseResponse = await response.json();
  console.log(`${companyLabel}: Found ${data.jobs.length} total jobs`);

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
 * Stripe uses server-side rendered pages with ?skip= pagination.
 * Filters for Product Manager/Lead roles and fetches locations from detail pages.
 */
async function scrapeStripeCareers(): Promise<ScrapedJob[]> {
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

            // Filter for Product Manager/Lead roles
            if (
              lower.includes("product manager") ||
              lower.includes("product lead") ||
              lower.includes("product director") ||
              lower.includes("head of product") ||
              lower.includes("vp of product") ||
              lower.includes("vp, product") ||
              lower.includes("chief product")
            ) {
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
 * Slack uses Salesforce's Workday platform.
 * Fetches all jobs via the Workday API and filters for Product Manager roles.
 */
async function scrapeSlackCareers(): Promise<ScrapedJob[]> {
  console.log("Slack: Fetching jobs from Salesforce Workday API");

  const baseUrl = "https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/Slack/jobs";
  const allJobs: ScrapedJob[] = [];
  let offset = 0;
  const limit = 20;
  let totalJobs = 0;

  // Product Manager keywords to filter by
  const pmKeywords = [
    "product manager",
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
  ];

  interface WorkdayJob {
    title: string;
    locationsText?: string;
    externalPath: string;
  }

  interface WorkdayResponse {
    total: number;
    jobPostings: WorkdayJob[];
  }

  while (true) {
    try {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          limit,
          offset,
        }),
      });

      if (!response.ok) {
        console.log(`Slack: API returned status ${response.status}`);
        break;
      }

      const data: WorkdayResponse = await response.json();

      // Store total from first request
      if (offset === 0) {
        totalJobs = data.total || 0;
        console.log(`Slack: Total jobs available: ${totalJobs}`);
      }

      console.log(`Slack: Fetched offset=${offset}, got ${data.jobPostings?.length || 0} jobs`);

      if (!data.jobPostings || data.jobPostings.length === 0) {
        break;
      }

      // Filter for PM roles and add to results
      for (const job of data.jobPostings) {
        if (!job || !job.title) continue;

        const lowerTitle = job.title.toLowerCase();
        const isPM = pmKeywords.some((kw) => lowerTitle.includes(kw));

        if (isPM) {
          allJobs.push({
            title: job.title,
            location: job.locationsText || "",
            urlPath: `https://salesforce.wd12.myworkdayjobs.com/Slack${job.externalPath}`,
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
      console.log(`Slack: Error at offset=${offset}:`, err);
      break;
    }
  }

  console.log(`Slack: Found ${allJobs.length} Product Manager roles out of ${totalJobs} total jobs`);
  return allJobs;
}

/**
 * OpenAI uses Ashby (jobs.ashbyhq.com/openai).
 * Fetches jobs via GraphQL API and filters for Product Management roles.
 */
async function scrapeOpenAICareers(): Promise<ScrapedJob[]> {
  console.log("OpenAI: Fetching jobs from Ashby GraphQL API");

  const query = {
    operationName: "ApiJobBoardWithTeams",
    variables: {
      organizationHostedJobsPageName: "openai",
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
      };
    };
  }

  const response = await fetch(
    "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: JSON.stringify(query),
    }
  );

  const data: AshbyResponse = await response.json();
  const { teams, jobPostings } = data.data.jobBoard;

  console.log(`OpenAI: Found ${jobPostings.length} total jobs across ${teams.length} teams`);

  // Find Product Management team and related product teams
  const productTeamIds = new Set<string>();
  const productKeywords = ["product management", "product design", "product policy", "product partnerships"];

  for (const team of teams) {
    const lowerName = team.name.toLowerCase();
    if (productKeywords.some((kw) => lowerName.includes(kw))) {
      productTeamIds.add(team.id);
      console.log(`OpenAI: Including team "${team.name}" (${team.id})`);
    }
  }

  // Filter for product team jobs
  const productJobs = jobPostings.filter((job) => productTeamIds.has(job.teamId));

  console.log(`OpenAI: Found ${productJobs.length} product-related jobs`);

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
      urlPath: `https://jobs.ashbyhq.com/openai/${job.id}`,
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
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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

  console.log(`Netflix: Scraped ${allJobs.length} jobs successfully`);
  return allJobs;
}

/**
 * Eightfold.ai platform (used by PayPal, etc.)
 * Uses a direct API with pagination (start=0, start=10, etc.)
 */
async function scrapeEightfoldCareers(careersUrl: string): Promise<ScrapedJob[]> {
  const url = new URL(careersUrl);
  const domain = url.hostname.split(".")[0] + ".com"; // e.g., "paypal.com"
  const baseOrigin = url.origin; // e.g., "https://paypal.eightfold.ai"

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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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

      const result: EightfoldResponse = await res.json();

      if (result.status !== 200 || !result.data?.positions) {
        console.log("Eightfold: API returned non-success status");
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
 * Google Careers uses page-based pagination with ?page= parameter.
 * Extracts job listings from the search results page.
 */
async function scrapeGoogleCareers(careersUrl: string): Promise<ScrapedJob[]> {
  console.log("Google: Starting careers scraper");

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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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


export async function scrapeCompanyCareers(
  careersUrl: string
): Promise<ScrapedJob[]> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const hostname = new URL(careersUrl).hostname;

  // Atlassian-specific: use their JSON API directly
  if (hostname.includes("atlassian.com")) {
    console.log("Detected Atlassian careers page, using API scraper");
    await browser.close();
    return scrapeAtlassianCareers();
  }

  // DoorDash-specific: use Greenhouse API (board: doordashusa)
  if (hostname.includes("doordash.com") || hostname.includes("careersatdoordash.com")) {
    console.log("Detected DoorDash careers page, using Greenhouse API scraper");
    await browser.close();
    return scrapeGreenhouseCareers("doordashusa", "DoorDash");
  }

  // Netflix-specific: use their API
  if (hostname.includes("netflix.net") || hostname.includes("netflix.com")) {
    console.log("Detected Netflix careers page, using API scraper");
    await browser.close();
    return scrapeNetflixCareers(careersUrl);
  }

  // Discord-specific: use Greenhouse API
  if (hostname.includes("discord.com")) {
    console.log("Detected Discord careers page, using Greenhouse API scraper");
    await browser.close();
    return scrapeGreenhouseCareers("discord", "Discord");
  }

  // Reddit-specific: use Greenhouse API with departments filter
  if (hostname.includes("reddit.com") || hostname.includes("redditinc.com") ||
      careersUrl.includes("greenhouse.io/reddit")) {
    console.log("Detected Reddit careers page, using Greenhouse API scraper");
    await browser.close();
    return scrapeRedditCareers();
  }

  // Instacart-specific: use Greenhouse API
  if (hostname.includes("instacart.careers") || hostname.includes("instacart.com")) {
    console.log("Detected Instacart careers page, using Greenhouse API scraper");
    await browser.close();
    return scrapeGreenhouseCareers("instacart", "Instacart");
  }

  // Figma-specific: use Greenhouse API
  if (hostname.includes("figma.com")) {
    console.log("Detected Figma careers page, using Greenhouse API scraper");
    await browser.close();
    return scrapeGreenhouseCareers("figma", "Figma");
  }

  // Airbnb-specific: use Greenhouse API
  if (hostname.includes("airbnb.com")) {
    console.log("Detected Airbnb careers page, using Greenhouse API scraper");
    await browser.close();
    return scrapeGreenhouseCareers("airbnb", "Airbnb");
  }

  // OpenAI-specific: use Ashby GraphQL API
  if (hostname.includes("openai.com") || careersUrl.includes("ashbyhq.com/openai")) {
    console.log("Detected OpenAI careers page, using Ashby API scraper");
    await browser.close();
    return scrapeOpenAICareers();
  }

  // Slack-specific: use Salesforce Workday API and filter for PM roles
  if (hostname.includes("slack.com") || careersUrl.includes("myworkdayjobs.com/Slack")) {
    console.log("Detected Slack careers page, using Workday API scraper");
    await browser.close();
    return scrapeSlackCareers();
  }

  // Stripe-specific: paginate through all pages and filter for PM roles
  if (hostname.includes("stripe.com")) {
    console.log("Detected Stripe careers page, using custom scraper");
    await browser.close();
    return scrapeStripeCareers();
  }

  // Uber-specific: use their JSON API directly (no browser needed)
  if (hostname.includes("uber.com")) {
    console.log("Detected Uber careers page, using API scraper");
    await browser.close();
    return scrapeUberCareers(careersUrl);
  }

  // Google-specific: use page-based pagination
  if (hostname.includes("google.com") && careersUrl.includes("/careers/")) {
    console.log("Detected Google careers page, using custom scraper");
    await browser.close();
    return scrapeGoogleCareers(careersUrl);
  }

  // Eightfold.ai platform (PayPal, etc.): use their JSON API with pagination
  if (hostname.includes("eightfold.ai")) {
    console.log("Detected Eightfold.ai careers page, using API scraper");
    await browser.close();
    return scrapeEightfoldCareers(careersUrl);
  }

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.goto(careersUrl, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Try clicking "Show More" / "Load More" buttons repeatedly
    for (let i = 0; i < 10; i++) {
      try {
        const loadMoreBtn = await page.$(
          '[class*="load-more"], [class*="show-more"]'
        );
        if (!loadMoreBtn) break;
        const isVisible = await loadMoreBtn.isVisible();
        if (!isVisible) break;
        await loadMoreBtn.click();
        await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
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

    // Phase 2: No product sections found — extract all job links
    console.log("No product sections found, extracting all jobs from page");
    const allJobs = new Map<string, ScrapedJob>();

    const pageJobs = await extractAllJobsFromPage(page, baseUrl);
    for (const job of pageJobs) {
      allJobs.set(job.urlPath, job);
    }

    await paginateAndCollect(page, baseUrl, allJobs, false);
    return Array.from(allJobs.values());
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
