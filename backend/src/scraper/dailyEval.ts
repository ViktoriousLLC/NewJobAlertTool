import * as Sentry from "@sentry/node";

export interface CompanyQualityData {
  companyName: string;
  prevJobCount: number;
  currentJobCount: number;
  nonUsFiltered: number;
  totalPmJobs: number;
  qualityScore: number;
  subscriberCount: number;
}

export type IssueSeverity = "critical" | "warning" | "info";

export interface QualityIssue {
  company: string;
  checkType: string;
  severity: IssueSeverity;
  message: string;
}

export interface EvalResult {
  companiesChecked: number;
  totalUsJobs: number;
  totalNonUsFiltered: number;
  avgQualityScore: number;
  issues: QualityIssue[];
}

export function evaluateDailyQuality(
  qualityData: Map<string, CompanyQualityData>
): EvalResult {
  const issues: QualityIssue[] = [];
  let totalUsJobs = 0;
  let totalNonUsFiltered = 0;
  let totalScore = 0;

  for (const [, data] of qualityData) {
    totalUsJobs += data.currentJobCount;
    totalNonUsFiltered += data.nonUsFiltered;
    totalScore += data.qualityScore;

    // 1. Absurd job count (>100 US PM jobs for one company)
    if (data.currentJobCount > 100) {
      issues.push({
        company: data.companyName,
        checkType: "Absurd job count",
        severity: "critical",
        message: `${data.currentJobCount} active US PM jobs — likely scraper returning non-PM or duplicate roles`,
      });
    }

    // 2. High non-US filtering (>50% of PM jobs were non-US)
    if (data.totalPmJobs > 5 && data.nonUsFiltered / data.totalPmJobs > 0.5) {
      const pct = Math.round((data.nonUsFiltered / data.totalPmJobs) * 100);
      issues.push({
        company: data.companyName,
        checkType: "High non-US ratio",
        severity: "warning",
        message: `${pct}% of PM jobs were non-US (${data.nonUsFiltered}/${data.totalPmJobs} filtered out)`,
      });
    }

    // 3. Sudden spike (>100% increase AND >10 absolute)
    if (
      data.prevJobCount > 0 &&
      data.currentJobCount > data.prevJobCount * 2 &&
      data.currentJobCount - data.prevJobCount > 10
    ) {
      issues.push({
        company: data.companyName,
        checkType: "Sudden spike",
        severity: "warning",
        message: `Jobs jumped from ${data.prevJobCount} to ${data.currentJobCount} (+${data.currentJobCount - data.prevJobCount})`,
      });
    }

    // 4. Sudden drop (>50% decrease AND >10 absolute)
    if (
      data.prevJobCount > 0 &&
      data.currentJobCount < data.prevJobCount * 0.5 &&
      data.prevJobCount - data.currentJobCount > 10
    ) {
      issues.push({
        company: data.companyName,
        checkType: "Sudden drop",
        severity: "warning",
        message: `Jobs dropped from ${data.prevJobCount} to ${data.currentJobCount} (-${data.prevJobCount - data.currentJobCount})`,
      });
    }

    // 5. Zero jobs for subscribed companies
    if (data.currentJobCount === 0 && data.subscriberCount > 0) {
      issues.push({
        company: data.companyName,
        checkType: "Zero jobs (subscribed)",
        severity: "info",
        message: `0 active US PM jobs but has ${data.subscriberCount} subscriber(s)`,
      });
    }

    // 6. Low quality score
    if (data.qualityScore < 50 && data.qualityScore > 0) {
      issues.push({
        company: data.companyName,
        checkType: "Low quality score",
        severity: "warning",
        message: `Quality score: ${data.qualityScore}/100`,
      });
    }
  }

  // Log critical issues to Sentry
  for (const issue of issues) {
    if (issue.severity === "critical") {
      Sentry.captureMessage(`Daily eval: ${issue.checkType} for ${issue.company} — ${issue.message}`, {
        level: "error",
        tags: { company: issue.company, phase: "daily-eval", issue_type: issue.checkType },
      });
    }
  }

  const companiesChecked = qualityData.size;
  const avgQualityScore = companiesChecked > 0 ? Math.round(totalScore / companiesChecked) : 0;

  return {
    companiesChecked,
    totalUsJobs,
    totalNonUsFiltered,
    avgQualityScore,
    issues,
  };
}
