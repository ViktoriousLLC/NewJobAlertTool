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
    urlPath = new URL(href, baseUrl).pathname;
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

  // Clean up location: remove trailing department labels
  location = location
    .replace(/\b(Product|Engineering|Design|Marketing|Sales|Finance|Legal|Operations|Security)\s*$/i, "")
    .replace(/\bProduct Management\s*$/i, "")
    .trim();

  // Clean up title: remove "Apply" / department labels that got concatenated
  title = title
    .replace(/Apply(?:\s+now)?$/i, "")
    .replace(/Product Management$/i, "")
    .trim();

  // If location is still stuck in the title (no children case like Anthropic),
  // try to split on a known city pattern
  if (!location && children.length < 2) {
    const cityMatch = title.match(
      /(.*?)(?:San Francisco|San Mateo|New York|London|Seattle|Washington|Remote|Tokyo|Dublin|Sydney|Munich|Boston|Singapore|Paris|Berlin|Zurich|Toronto|Austin|Chicago|Los Angeles)/
    );
    if (cityMatch && cityMatch[1].length > 5) {
      const splitIdx = cityMatch[1].length;
      location = title.substring(splitIdx).replace(/Apply(?:\s+now)?$/i, "").trim();
      title = title.substring(0, splitIdx).trim();
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
