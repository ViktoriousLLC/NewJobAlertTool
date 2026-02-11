import { ScrapedJob, PM_KEYWORDS } from "./scraper";

/**
 * Titles containing these words are NOT PM roles, even if they match a PM keyword.
 * Exception: if the title explicitly contains "product manager", exclusions don't apply
 * (e.g., "Engineering Product Manager" is a valid PM role).
 */
const PM_TITLE_EXCLUSIONS = [
  "product design",
  "product designer",
  "product marketing",
  "product analyst",
  "product counsel",
  "product counsel",
  "product support",
  "product operations",
  "product engineer",
  "design manager",
  "ux manager",
  "research manager",
  "marketing manager",
  "data product",
];

function isPMTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const matchesKeyword = PM_KEYWORDS.some((kw) => lower.includes(kw));
  if (!matchesKeyword) return false;

  // If title explicitly contains "product manager" or "product lead", always include
  if (lower.includes("product manager") || lower.includes("product lead")) {
    return true;
  }

  // Otherwise check exclusions (catches "Head of Product Design", "VP Product Marketing", etc.)
  const excluded = PM_TITLE_EXCLUSIONS.some((ex) => lower.includes(ex));
  return !excluded;
}

export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  qualityScore: number;
  filteredJobs: ScrapedJob[];
}

/**
 * Validates scrape results for quality and filters out non-PM jobs.
 *
 * Checks:
 * - Title validation: All jobs have PM keywords in the title
 * - Zero results: Flag if scrape returned 0 jobs
 * - Location quality: Flag if >50% of jobs have empty/vague locations
 * - Duplicate detection: Flag if >20% of jobs share the same title
 * - URL validity: All job URLs are valid HTTPS URLs
 *
 * Returns a quality score (0-100) and warning messages.
 */
export function validateScrapeResults(
  jobs: ScrapedJob[],
  companyName: string
): ValidationResult {
  const warnings: string[] = [];
  let score = 100;

  // Zero results check
  if (jobs.length === 0) {
    return {
      isValid: false,
      warnings: [`${companyName}: Scrape returned 0 jobs — possible scraper failure`],
      qualityScore: 0,
      filteredJobs: [],
    };
  }

  // Filter out non-PM jobs (with exclusion logic for design/marketing roles)
  const pmJobs = jobs.filter((job) => isPMTitle(job.title));

  const nonPmCount = jobs.length - pmJobs.length;
  if (nonPmCount > 0) {
    warnings.push(
      `${companyName}: Filtered out ${nonPmCount} non-PM jobs (${jobs.length} total → ${pmJobs.length} PM)`
    );
    // Deduct proportionally, but not too harshly
    score -= Math.min(20, Math.round((nonPmCount / jobs.length) * 30));
  }

  // Location quality check
  const vagueLocationCount = pmJobs.filter((job) => {
    const loc = (job.location || "").trim();
    return (
      !loc ||
      /^\d+ Locations?$/i.test(loc) ||
      /^Multiple Locations?$/i.test(loc) ||
      /^Hybrid$/i.test(loc) ||
      loc.length < 3
    );
  }).length;

  if (pmJobs.length > 0 && vagueLocationCount / pmJobs.length > 0.5) {
    warnings.push(
      `${companyName}: ${vagueLocationCount}/${pmJobs.length} jobs have vague or missing locations`
    );
    score -= 15;
  }

  // Duplicate detection
  const titleCounts = new Map<string, number>();
  for (const job of pmJobs) {
    const normalizedTitle = job.title.toLowerCase().trim();
    titleCounts.set(normalizedTitle, (titleCounts.get(normalizedTitle) || 0) + 1);
  }
  const duplicateCount = Array.from(titleCounts.values()).reduce(
    (sum, count) => sum + (count > 1 ? count - 1 : 0),
    0
  );
  if (pmJobs.length > 0 && duplicateCount / pmJobs.length > 0.2) {
    warnings.push(
      `${companyName}: ${duplicateCount} duplicate job titles detected`
    );
    score -= 10;
  }

  // URL validity check
  const badUrlCount = pmJobs.filter((job) => {
    try {
      const url = new URL(job.urlPath);
      return url.protocol !== "https:" && url.protocol !== "http:";
    } catch {
      return true;
    }
  }).length;

  if (badUrlCount > 0) {
    warnings.push(
      `${companyName}: ${badUrlCount} jobs have invalid URLs`
    );
    score -= 10;
  }

  score = Math.max(0, Math.min(100, score));

  return {
    isValid: true,
    warnings,
    qualityScore: score,
    filteredJobs: pmJobs,
  };
}
