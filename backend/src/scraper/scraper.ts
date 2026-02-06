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
    // If the link points to a different domain, keep the full URL
    // Otherwise just keep the pathname
    if (fullUrl.origin !== baseUrl) {
      urlPath = fullUrl.href;
    } else {
      urlPath = fullUrl.pathname;
    }
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

  // Stripe-specific: paginate through all pages and filter for PM roles
  if (new URL(careersUrl).hostname.includes("stripe.com")) {
    console.log("Detected Stripe careers page, using custom scraper");
    await browser.close();
    return scrapeStripeCareers();
  }

  // Uber-specific: use their JSON API directly (no browser needed)
  if (new URL(careersUrl).hostname.includes("uber.com")) {
    console.log("Detected Uber careers page, using API scraper");
    await browser.close();
    return scrapeUberCareers(careersUrl);
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
