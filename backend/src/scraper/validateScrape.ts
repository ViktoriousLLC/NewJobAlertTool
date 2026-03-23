import { ScrapedJob, PM_KEYWORDS } from "./scraper";
import { isUSLocation } from "../lib/locationFilter";

/**
 * If a title contains ANY of these words, it is NOT a PM role — no exceptions.
 * This catches engineering, design, marketing, and other roles that happen
 * to contain PM keywords like "product manager" or "head of product".
 */
const HARD_EXCLUSIONS = [
  "engineering",
  "engineer",
  "design",
  "designer",
  "marketing",
  "analyst",
  "counsel",
  "support",
  "operations",
  "ux ",
  "research",
  "data ",
  "technical program",
];

function isPMTitle(title: string, extraKeywords?: string[]): boolean {
  const lower = title.toLowerCase();

  // Must match at least one PM keyword (or custom keyword)
  const allKeywords = extraKeywords?.length
    ? [...PM_KEYWORDS, ...extraKeywords.map((k) => k.toLowerCase())]
    : PM_KEYWORDS;
  const matchesKeyword = allKeywords.some((kw) => lower.includes(kw));
  if (!matchesKeyword) return false;

  // Hard exclusions — if any of these words appear, reject regardless
  // Skip hard exclusions for custom keyword matches (user explicitly asked for these)
  if (extraKeywords?.length) {
    const matchesCustom = extraKeywords.some((kw) => lower.includes(kw.toLowerCase()));
    if (matchesCustom) return true;
  }

  const excluded = HARD_EXCLUSIONS.some((ex) => lower.includes(ex));
  return !excluded;
}

export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  qualityScore: number;
  filteredJobs: ScrapedJob[];
  totalPmJobs: number;         // PM jobs before location filter
  nonUsFilteredCount: number;  // how many non-US jobs were removed
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
  companyName: string,
  extraKeywords?: string[]
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
      totalPmJobs: 0,
      nonUsFilteredCount: 0,
    };
  }

  // Filter out non-PM jobs (with exclusion logic for design/marketing roles)
  const pmJobs = jobs.filter((job) => isPMTitle(job.title, extraKeywords));

  const nonPmCount = jobs.length - pmJobs.length;
  if (nonPmCount > 0) {
    warnings.push(
      `${companyName}: Filtered out ${nonPmCount} non-PM jobs (${jobs.length} total → ${pmJobs.length} PM)`
    );
    score -= Math.min(20, Math.round((nonPmCount / jobs.length) * 30));
  }

  // US location filter: only keep jobs in US locations
  const usJobs = pmJobs.filter((job) => isUSLocation(job.location));
  const nonUsCount = pmJobs.length - usJobs.length;
  if (nonUsCount > 0) {
    warnings.push(
      `${companyName}: Filtered out ${nonUsCount} non-US jobs (${pmJobs.length} PM total → ${usJobs.length} US)`
    );
  }

  // Location quality check (on US jobs only)
  const vagueLocationCount = usJobs.filter((job) => {
    const loc = (job.location || "").trim();
    return (
      !loc ||
      /^\d+ Locations?$/i.test(loc) ||
      /^Multiple Locations?$/i.test(loc) ||
      /^Hybrid$/i.test(loc) ||
      loc.length < 3
    );
  }).length;

  if (usJobs.length > 0 && vagueLocationCount / usJobs.length > 0.5) {
    warnings.push(
      `${companyName}: ${vagueLocationCount}/${usJobs.length} jobs have vague or missing locations`
    );
    score -= 15;
  }

  // Duplicate detection
  const titleCounts = new Map<string, number>();
  for (const job of usJobs) {
    const normalizedTitle = job.title.toLowerCase().trim();
    titleCounts.set(normalizedTitle, (titleCounts.get(normalizedTitle) || 0) + 1);
  }
  const duplicateCount = Array.from(titleCounts.values()).reduce(
    (sum, count) => sum + (count > 1 ? count - 1 : 0),
    0
  );
  if (usJobs.length > 0 && duplicateCount / usJobs.length > 0.2) {
    warnings.push(
      `${companyName}: ${duplicateCount} duplicate job titles detected`
    );
    score -= 10;
  }

  // URL validity check
  const badUrlCount = usJobs.filter((job) => {
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
    filteredJobs: usJobs,
    totalPmJobs: pmJobs.length,
    nonUsFilteredCount: nonUsCount,
  };
}
