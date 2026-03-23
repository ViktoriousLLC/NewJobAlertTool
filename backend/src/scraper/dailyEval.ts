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

export interface CompanyStatus {
  companyName: string;
  usJobs: number;
  nonUsFiltered: number;
  totalPmJobs: number;
  prevJobCount: number;
  qualityScore: number;
  subscriberCount: number;
  issues: QualityIssue[];
}

export interface EvalResult {
  companiesChecked: number;
  totalUsJobs: number;
  totalNonUsFiltered: number;
  avgQualityScore: number;
  issues: QualityIssue[];
  companyStatuses: CompanyStatus[];
}

export function evaluateDailyQuality(
  qualityData: Map<string, CompanyQualityData>
): EvalResult {
  const allIssues: QualityIssue[] = [];
  const companyStatuses: CompanyStatus[] = [];
  let totalUsJobs = 0;
  let totalNonUsFiltered = 0;
  let totalScore = 0;

  for (const [, data] of qualityData) {
    totalUsJobs += data.currentJobCount;
    totalNonUsFiltered += data.nonUsFiltered;
    totalScore += data.qualityScore;

    const companyIssues: QualityIssue[] = [];

    // 1. Absurd job count (>100 US PM jobs for one company)
    if (data.currentJobCount > 100) {
      companyIssues.push({
        company: data.companyName,
        checkType: "Absurd job count",
        severity: "critical",
        message: `${data.currentJobCount} active US PM jobs`,
      });
    }

    // 2. High non-US filtering (>50% of PM jobs were non-US)
    if (data.totalPmJobs > 5 && data.nonUsFiltered / data.totalPmJobs > 0.5) {
      const pct = Math.round((data.nonUsFiltered / data.totalPmJobs) * 100);
      companyIssues.push({
        company: data.companyName,
        checkType: "High non-US ratio",
        severity: "warning",
        message: `${pct}% non-US (${data.nonUsFiltered}/${data.totalPmJobs} filtered)`,
      });
    }

    // 3. Sudden spike (>100% increase AND >10 absolute)
    if (
      data.prevJobCount > 0 &&
      data.currentJobCount > data.prevJobCount * 2 &&
      data.currentJobCount - data.prevJobCount > 10
    ) {
      companyIssues.push({
        company: data.companyName,
        checkType: "Sudden spike",
        severity: "warning",
        message: `${data.prevJobCount} -> ${data.currentJobCount} (+${data.currentJobCount - data.prevJobCount})`,
      });
    }

    // 4. Sudden drop (>50% decrease AND >10 absolute)
    if (
      data.prevJobCount > 0 &&
      data.currentJobCount < data.prevJobCount * 0.5 &&
      data.prevJobCount - data.currentJobCount > 10
    ) {
      companyIssues.push({
        company: data.companyName,
        checkType: "Sudden drop",
        severity: "warning",
        message: `${data.prevJobCount} -> ${data.currentJobCount} (-${data.prevJobCount - data.currentJobCount})`,
      });
    }

    // 5. Zero jobs for subscribed companies
    if (data.currentJobCount === 0 && data.subscriberCount > 0) {
      companyIssues.push({
        company: data.companyName,
        checkType: "Zero jobs (subscribed)",
        severity: "info",
        message: `0 US PM jobs, ${data.subscriberCount} subscriber(s)`,
      });
    }

    // 6. Low quality score
    if (data.qualityScore < 50 && data.qualityScore > 0) {
      companyIssues.push({
        company: data.companyName,
        checkType: "Low quality score",
        severity: "warning",
        message: `Score: ${data.qualityScore}/100`,
      });
    }

    allIssues.push(...companyIssues);

    companyStatuses.push({
      companyName: data.companyName,
      usJobs: data.currentJobCount,
      nonUsFiltered: data.nonUsFiltered,
      totalPmJobs: data.totalPmJobs,
      prevJobCount: data.prevJobCount,
      qualityScore: data.qualityScore,
      subscriberCount: data.subscriberCount,
      issues: companyIssues,
    });
  }

  // Log critical issues to Sentry
  for (const issue of allIssues) {
    if (issue.severity === "critical") {
      Sentry.captureMessage(`Daily eval: ${issue.checkType} for ${issue.company} — ${issue.message}`, {
        level: "error",
        tags: { company: issue.company, phase: "daily-eval", issue_type: issue.checkType },
      });
    }
  }

  // Sort: companies with issues first (critical > warning > info), then clean ones at bottom
  companyStatuses.sort((a, b) => {
    const severityRank = (issues: QualityIssue[]) => {
      if (issues.some((i) => i.severity === "critical")) return 0;
      if (issues.some((i) => i.severity === "warning")) return 1;
      if (issues.some((i) => i.severity === "info")) return 2;
      return 3; // no issues
    };
    return severityRank(a.issues) - severityRank(b.issues);
  });

  const companiesChecked = qualityData.size;
  const avgQualityScore = companiesChecked > 0 ? Math.round(totalScore / companiesChecked) : 0;

  return {
    companiesChecked,
    totalUsJobs,
    totalNonUsFiltered,
    avgQualityScore,
    issues: allIssues,
    companyStatuses,
  };
}
