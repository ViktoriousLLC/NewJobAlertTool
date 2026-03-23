import { Resend } from "resend";

export interface NewJobAlert {
  companyName: string;
  careersUrl: string;
  newJobs: { title: string; urlPath: string }[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Get a favicon/logo URL for a company using Google's favicon service.
 * Mirrors the logic from frontend/src/lib/brandColors.ts:getFaviconUrl()
 */
function getCompanyLogoUrl(companyName: string, careersUrl: string): string {
  try {
    const url = new URL(careersUrl);
    const hostname = url.hostname.replace(/^www\./, "");

    // ATS-hosted URLs: extract the company slug
    if (/greenhouse\.io$/.test(hostname) || /lever\.co$/.test(hostname) || /ashbyhq\.com$/.test(hostname)) {
      const slug = url.pathname.split("/").filter(Boolean)[0];
      if (slug) return `https://www.google.com/s2/favicons?domain=${slug}.com&sz=32`;
    }
    if (/eightfold\.ai$/.test(hostname)) {
      const parts = hostname.split(".");
      if (parts.length > 2) return `https://www.google.com/s2/favicons?domain=${parts[0]}.com&sz=32`;
    }

    // Direct company domain
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return `https://www.google.com/s2/favicons?domain=${companyName.toLowerCase().replace(/\s+/g, "")}.com&sz=32`;
  }
}

function buildAlertHtml(alerts: NewJobAlert[], now: string, period: "daily" | "weekly" = "daily"): string {
  const sorted = [...alerts].sort(
    (a, b) => b.newJobs.length - a.newJobs.length
  );
  const totalNewJobs = sorted.reduce((sum, a) => sum + a.newJobs.length, 0);
  const companiesWithNew = sorted.filter((a) => a.newJobs.length > 0);
  const noNewJobs = sorted.filter((a) => a.newJobs.length === 0);

  const font =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

  // Summary banner: green if jobs found, muted grey if none
  const periodLabel = period === "weekly" ? "this week" : "today";
  const summaryText =
    totalNewJobs > 0
      ? `${totalNewJobs} new PM job${totalNewJobs === 1 ? "" : "s"} found ${periodLabel}`
      : `No new jobs ${periodLabel}`;
  const summaryBg = totalNewJobs > 0 ? "#16874D" : "#78716c";

  // Build company sections
  let companySections = "";
  if (totalNewJobs > 0) {
    for (const alert of companiesWithNew) {
      const logoUrl = getCompanyLogoUrl(alert.companyName, alert.careersUrl);
      let jobRows = "";
      for (const job of alert.newJobs) {
        const jobUrl = job.urlPath.startsWith("http")
          ? job.urlPath
          : new URL(job.urlPath, alert.careersUrl).href;
        jobRows += `
                              <tr>
                                <td style="padding:6px 0;font-size:14px;line-height:1.4;font-family:${font};">
                                  <a href="${escapeHtml(jobUrl)}" target="_blank" style="color:#0EA5E9;text-decoration:none;">${escapeHtml(job.title)}</a>
                                </td>
                              </tr>`;
      }

      companySections += `
                          <!-- Company card -->
                          <tr>
                            <td style="padding:0 0 16px 0;">
                              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #e7e5e4;border-radius:8px;">
                                <tr>
                                  <td style="padding:16px 20px 4px 20px;">
                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                      <tr>
                                        <td style="font-size:16px;font-weight:700;color:#1A1A2E;font-family:${font};">
                                          <img src="${escapeHtml(logoUrl)}" alt="" width="20" height="20" style="vertical-align:middle;margin-right:8px;border-radius:4px;" />
                                          ${escapeHtml(alert.companyName)}
                                        </td>
                                        <td align="right" style="font-size:13px;color:#78716c;font-family:${font};">
                                          ${alert.newJobs.length} new
                                        </td>
                                      </tr>
                                    </table>
                                  </td>
                                </tr>
                                <tr>
                                  <td style="padding:8px 20px 16px 20px;">
                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                      ${jobRows}
                                    </table>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>`;
    }
  } else {
    companySections = `
                          <tr>
                            <td style="padding:16px 0;font-size:15px;color:#78716c;line-height:1.5;font-family:${font};">
                              No new product jobs detected today. All tracked companies were checked successfully.
                            </td>
                          </tr>`;
  }

  // No-new-jobs list
  let noNewSection = "";
  if (noNewJobs.length > 0) {
    const names = noNewJobs.map((a) => escapeHtml(a.companyName)).join(", ");
    noNewSection = `
                          <tr>
                            <td style="padding:12px 0 0 0;border-top:1px solid #e7e5e4;">
                              <p style="margin:12px 0 0 0;font-size:13px;color:#a8a29e;line-height:1.5;font-family:${font};">
                                No new jobs at: ${names}
                              </p>
                            </td>
                          </tr>`;
  }

  return `<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#FBFBFC;font-family:${font};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBFBFC;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#FBFBFC;">
          <!-- Header -->
          <tr>
            <td style="padding:0 0 24px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:40px;height:40px;background-color:#0EA5E9;border-radius:8px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-weight:bold;font-size:14px;font-family:${font};">PM</span>
                  </td>
                  <td style="padding-left:12px;vertical-align:middle;">
                    <a href="https://www.newpmjobs.com" target="_blank" style="font-size:18px;font-weight:700;color:#1A1A2E;text-decoration:none;font-family:${font};">NewPMJobs.com</a>
                    <div style="font-size:13px;color:#a8a29e;font-family:${font};">${escapeHtml(now)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Summary banner -->
          <tr>
            <td style="padding:0 0 20px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${summaryBg};border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px;text-align:center;">
                    <a href="https://www.newpmjobs.com" target="_blank" style="color:#ffffff;font-size:17px;font-weight:700;text-decoration:none;font-family:${font};">${summaryText}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Company sections -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${companySections}
                ${noNewSection}
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 0 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:20px 0;border-top:1px solid #e7e5e4;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#a8a29e;font-family:${font};">
                      NewPMJobs.com &mdash; Product management job tracking
                    </p>
                    <p style="margin:8px 0 0 0;font-size:11px;color:#a8a29e;font-family:${font};">
                      You're receiving this because you have ${period} alerts enabled.
                      <a href="https://www.newpmjobs.com/settings" target="_blank" style="color:#0EA5E9;text-decoration:underline;">Manage preferences</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export interface EmailPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
}

/**
 * Build an alert email payload without sending it.
 * Used by batch sending in dailyCheck.ts.
 */
export function buildAlertEmailPayload(
  userEmail: string,
  alerts: NewJobAlert[],
  period: "daily" | "weekly" = "daily"
): EmailPayload {
  const sorted = [...alerts].sort(
    (a, b) => b.newJobs.length - a.newJobs.length
  );
  const totalNewJobs = sorted.reduce((sum, a) => sum + a.newJobs.length, 0);

  const now = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = buildAlertHtml(alerts, now, period);

  const subject = period === "weekly"
    ? `Weekly PM Digest: ${totalNewJobs} new job${totalNewJobs === 1 ? "" : "s"} this week`
    : `Job Alert: ${totalNewJobs} new PM job${totalNewJobs === 1 ? "" : "s"} — ${now}`;

  return {
    from: "NewPMJobs <alerts@newpmjobs.com>",
    to: userEmail,
    subject,
    html,
  };
}

export interface BatchSendResult {
  sent: number;
  failed: number;
  errors: string[];
}

/**
 * Send multiple alert emails using Resend's batch API (up to 100 per request).
 * Respects the 2 req/s rate limit by adding 1s delay between batches.
 * Returns detailed results so the caller can detect and report failures.
 */
export async function sendBatchAlerts(payloads: EmailPayload[]): Promise<BatchSendResult> {
  const result: BatchSendResult = { sent: 0, failed: 0, errors: [] };

  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set — skipping email send");
    return result;
  }

  if (payloads.length === 0) return result;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const BATCH_SIZE = 100;

  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const batch = payloads.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      await resend.batch.send(batch);
      result.sent += batch.length;
      console.log(`Batch ${batchNum}: sent ${batch.length} emails`);
    } catch (err) {
      result.failed += batch.length;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Batch ${batchNum} (${batch.length} emails): ${msg}`);
      console.error(`Batch ${batchNum} failed:`, err);
    }

    // Delay between batches to stay under 2 req/s rate limit
    if (i + BATCH_SIZE < payloads.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return result;
}

/**
 * Send admin a notification when email delivery has failures.
 * Best-effort: if Resend is completely down, this won't send either.
 */
export async function notifyAdminOfFailures(result: BatchSendResult): Promise<void> {
  if (!process.env.RESEND_API_KEY || result.failed === 0) return;

  const { ADMIN_EMAIL } = await import("../lib/constants");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const errorList = result.errors.map((e) => `<li>${e}</li>`).join("");

  try {
    await resend.emails.send({
      from: "NewPMJobs <alerts@newpmjobs.com>",
      to: ADMIN_EMAIL,
      subject: `Alert: ${result.failed} email${result.failed === 1 ? "" : "s"} failed to send`,
      html: `
        <p><strong>${result.sent}</strong> emails sent successfully, <strong style="color:red">${result.failed}</strong> failed.</p>
        <p>Errors:</p>
        <ul>${errorList}</ul>
        <p style="color:#888;font-size:12px;">Check <a href="https://resend.com/emails">Resend dashboard</a> for details.</p>
      `,
    });
  } catch (err) {
    console.error("Failed to send admin failure notification:", err);
  }
}

/**
 * Send admin a summary of companies that failed during the daily scrape.
 */
export async function notifyAdminOfScrapeFailures(
  totalCompanies: number,
  failures: { name: string; error: string }[],
  remediations?: { name: string; from: string; to: string }[]
): Promise<void> {
  if (!process.env.RESEND_API_KEY || (failures.length === 0 && (!remediations || remediations.length === 0))) return;

  const { ADMIN_EMAIL } = await import("../lib/constants");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const fixedCount = remediations?.length || 0;
  const stillBroken = failures.length;

  // Build remediation rows (green, auto-fixed)
  const remediationRows = (remediations || [])
    .map((r) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #e7e5e4;">${escapeHtml(r.name)}</td><td style="padding:4px 8px;border-bottom:1px solid #e7e5e4;color:#16a34a;font-size:13px;">Auto-fixed: ${escapeHtml(r.from)} → ${escapeHtml(r.to)}</td></tr>`)
    .join("");

  // Build failure rows (red, still broken)
  const failureRows = failures
    .map((f) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #e7e5e4;">${escapeHtml(f.name)}</td><td style="padding:4px 8px;border-bottom:1px solid #e7e5e4;color:#dc2626;font-size:13px;">${escapeHtml(f.error.slice(0, 200))}</td></tr>`)
    .join("");

  // Build subject line
  const parts: string[] = [];
  if (fixedCount > 0) parts.push(`${fixedCount} auto-fixed`);
  if (stillBroken > 0) parts.push(`${stillBroken} still broken`);
  const subject = fixedCount > 0 && stillBroken === 0
    ? `Scrape Report: ${fixedCount} issues auto-fixed ✓`
    : `Scrape Alert: ${parts.join(", ")}`;

  // Build HTML sections
  let html = "";
  if (fixedCount > 0) {
    html += `
      <p style="color:#16a34a;font-weight:bold;">✓ Auto-fixed (${fixedCount})</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
        <tr style="background:#f0fdf4;"><th style="padding:6px 8px;text-align:left;">Company</th><th style="padding:6px 8px;text-align:left;">What happened</th></tr>
        ${remediationRows}
      </table>`;
  }
  if (stillBroken > 0) {
    const pct = Math.round((stillBroken / totalCompanies) * 100);
    html += `
      <p style="color:#dc2626;font-weight:bold;">✗ Still needs attention (${stillBroken} — ${pct}%)</p>
      <table style="border-collapse:collapse;width:100%;margin-top:4px;">
        <tr style="background:#fef2f2;"><th style="padding:6px 8px;text-align:left;">Company</th><th style="padding:6px 8px;text-align:left;">Error</th></tr>
        ${failureRows}
      </table>`;
  }
  html += `<p style="margin-top:16px;color:#888;font-size:12px;">Check <a href="https://newpmjobs.sentry.io">Sentry</a> for full stack traces.</p>`;

  try {
    await resend.emails.send({
      from: "NewPMJobs <alerts@newpmjobs.com>",
      to: ADMIN_EMAIL,
      subject,
      html,
    });
    console.log(`Admin scrape email sent (${fixedCount} fixed, ${stillBroken} still broken)`);
  } catch (err) {
    console.error("Failed to send admin scrape failure notification:", err);
  }
}

/**
 * Send a personalized alert email to a specific user.
 * Use sendBatchAlerts() for bulk sending (daily cron) — this is for one-off sends only.
 */
export async function sendUserAlert(
  userEmail: string,
  alerts: NewJobAlert[],
  period: "daily" | "weekly" = "daily"
): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set — skipping email send");
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const payload = buildAlertEmailPayload(userEmail, alerts, period);

  await resend.emails.send(payload);

  const totalNewJobs = alerts.reduce((sum, a) => sum + a.newJobs.length, 0);
  console.log(`${period} email sent: ${totalNewJobs} new jobs reported`);
}

/**
 * Legacy: send alert to hardcoded recipient (kept for backward compatibility during rollout).
 */
export async function sendAlert(alerts: NewJobAlert[]): Promise<void> {
  if (!process.env.ALERT_RECIPIENT_EMAIL) {
    console.log("ALERT_RECIPIENT_EMAIL not set — skipping legacy email send");
    return;
  }
  await sendUserAlert(process.env.ALERT_RECIPIENT_EMAIL, alerts);
}

/**
 * Send admin the daily quality evaluation report.
 * Shows per-company scorecard: companies with issues at top, clean ones at bottom.
 * Always sends (even when all clear) so the admin knows the eval ran.
 */
export async function notifyAdminOfQualityReport(evalResult: {
  companiesChecked: number;
  totalUsJobs: number;
  totalNonUsFiltered: number;
  avgQualityScore: number;
  issues: { company: string; checkType: string; severity: string; message: string }[];
  companyStatuses: {
    companyName: string;
    usJobs: number;
    nonUsFiltered: number;
    totalPmJobs: number;
    prevJobCount: number;
    qualityScore: number;
    subscriberCount: number;
    issues: { company: string; checkType: string; severity: string; message: string }[];
  }[];
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const { ADMIN_EMAIL } = await import("../lib/constants");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { companiesChecked, totalUsJobs, totalNonUsFiltered, avgQualityScore, issues, companyStatuses } = evalResult;
  const issueCount = issues.length;
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const companiesWithIssues = companyStatuses.filter((c) => c.issues.length > 0).length;

  const subject = issueCount === 0
    ? `Daily Eval: All clear (${companiesChecked} companies, ${totalUsJobs} US jobs)`
    : `Daily Eval: ${issueCount} issue${issueCount === 1 ? "" : "s"} across ${companiesWithIssues} compan${companiesWithIssues === 1 ? "y" : "ies"}${criticalCount > 0 ? ` (${criticalCount} critical)` : ""}`;

  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
  const severityColors: Record<string, string> = { critical: "#dc2626", warning: "#d97706", info: "#6b7280" };

  // Summary stats
  let html = `
    <div style="font-family:${font};max-width:700px;">
      <h2 style="margin:0 0 16px 0;color:#1A1A2E;">Daily Quality Evaluation</h2>
      <table style="border-collapse:collapse;margin-bottom:24px;">
        <tr><td style="padding:4px 16px 4px 0;color:#78716c;font-size:14px;">Companies checked</td><td style="font-weight:bold;font-size:14px;">${companiesChecked}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#78716c;font-size:14px;">Total US PM jobs</td><td style="font-weight:bold;font-size:14px;">${totalUsJobs}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#78716c;font-size:14px;">Non-US jobs filtered out</td><td style="font-weight:bold;font-size:14px;">${totalNonUsFiltered}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#78716c;font-size:14px;">Avg quality score</td><td style="font-weight:bold;font-size:14px;">${avgQualityScore}/100</td></tr>
      </table>`;

  // Per-company scorecard (already sorted: issues first, clean last)
  html += `
      <h3 style="margin:0 0 8px 0;color:#1A1A2E;">Company Scorecard</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr style="background:#f5f5f4;">
          <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #d6d3d1;">Company</th>
          <th style="padding:8px 6px;text-align:center;border-bottom:2px solid #d6d3d1;">US Jobs</th>
          <th style="padding:8px 6px;text-align:center;border-bottom:2px solid #d6d3d1;">Non-US Cut</th>
          <th style="padding:8px 6px;text-align:center;border-bottom:2px solid #d6d3d1;">Prev</th>
          <th style="padding:8px 6px;text-align:center;border-bottom:2px solid #d6d3d1;">Quality</th>
          <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #d6d3d1;">Status</th>
        </tr>`;

  for (const cs of companyStatuses) {
    const hasIssues = cs.issues.length > 0;
    const worstSeverity = cs.issues.length > 0
      ? (cs.issues.some((i) => i.severity === "critical") ? "critical" : cs.issues.some((i) => i.severity === "warning") ? "warning" : "info")
      : "ok";

    const rowBg = worstSeverity === "critical" ? "#fef2f2"
      : worstSeverity === "warning" ? "#fffbeb"
      : worstSeverity === "info" ? "#f0f9ff"
      : "#ffffff";

    // Change indicator
    let changeStr = "";
    if (cs.prevJobCount > 0) {
      const diff = cs.usJobs - cs.prevJobCount;
      if (diff > 0) changeStr = ` <span style="color:#16a34a;font-size:11px;">(+${diff})</span>`;
      else if (diff < 0) changeStr = ` <span style="color:#dc2626;font-size:11px;">(${diff})</span>`;
    }

    // Status column: issues or checkmark
    let statusHtml = "";
    if (hasIssues) {
      statusHtml = cs.issues
        .map((i) => `<span style="color:${severityColors[i.severity] || "#6b7280"};font-size:12px;">${escapeHtml(i.checkType)}: ${escapeHtml(i.message)}</span>`)
        .join("<br/>");
    } else {
      statusHtml = `<span style="color:#16a34a;">All checks passed</span>`;
    }

    html += `
        <tr style="background:${rowBg};">
          <td style="padding:6px;border-bottom:1px solid #e7e5e4;font-weight:${hasIssues ? "bold" : "normal"};">${escapeHtml(cs.companyName)}</td>
          <td style="padding:6px;border-bottom:1px solid #e7e5e4;text-align:center;">${cs.usJobs}${changeStr}</td>
          <td style="padding:6px;border-bottom:1px solid #e7e5e4;text-align:center;">${cs.nonUsFiltered > 0 ? cs.nonUsFiltered : "-"}</td>
          <td style="padding:6px;border-bottom:1px solid #e7e5e4;text-align:center;">${cs.prevJobCount}</td>
          <td style="padding:6px;border-bottom:1px solid #e7e5e4;text-align:center;">${cs.qualityScore}/100</td>
          <td style="padding:6px;border-bottom:1px solid #e7e5e4;">${statusHtml}</td>
        </tr>`;
  }

  html += `</table>`;

  // Checks legend
  html += `
      <div style="margin-top:20px;padding:12px;background:#f5f5f4;border-radius:6px;font-size:12px;color:#78716c;">
        <strong>Checks run per company:</strong> Job count (&gt;100 = critical) | Non-US ratio (&gt;50% = warning) | Spike/drop detection (&gt;100%/50% change) | Zero-job subscribers | Quality score (&lt;50 = warning)
      </div>`;

  html += `<p style="margin-top:16px;color:#a8a29e;font-size:12px;">This report runs automatically after the daily cron scrape.</p></div>`;

  try {
    await resend.emails.send({
      from: "NewPMJobs <alerts@newpmjobs.com>",
      to: ADMIN_EMAIL,
      subject,
      html,
    });
    console.log(`Daily eval report sent: ${issueCount} issues across ${companiesWithIssues} companies`);
  } catch (err) {
    console.error("Failed to send daily eval report:", err);
  }
}
