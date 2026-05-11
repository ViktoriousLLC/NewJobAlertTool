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

// =============================================================================
// Admin digest: one consolidated email replacing the previous three
// (notifyAdminOfFailures, notifyAdminOfScrapeFailures, notifyAdminOfQualityReport).
//
// Design:
// - Daily: send ONLY if there's an action item (failures, watch list, auto-disabled,
//   subscribed company dropped to 0, email delivery failures). Otherwise silent.
// - Monday: always send a digest with system health + past-7-days self-heal log,
//   even if no action items. Folds in the daily action items if any.
// =============================================================================

export interface AdminDigestInput {
  totalCompanies: number;
  failedCompanies: { name: string; error: string; consecutiveFailures: number }[];
  watchList: { name: string; consecutiveFailures: number }[];
  autoDisabled: { name: string; reason: string }[];
  subscribedZeroDrops: { name: string; prevCount: number; subscribers: number }[];
  autoRemediated: { name: string; from: string; to: string }[];
  stealthRecovered: { name: string; jobCount: number }[];
  reEnabled: { name: string; jobCount: number }[];
  emailBatchResult: BatchSendResult;
  isMondayDigest: boolean;
  weeklyHealth?: { healthy: number; disabled: number; watchListCount: number };
  weeklyEvents?: { event_type: string; company_name: string; created_at: string; details: Record<string, unknown> | null }[];
}

export async function sendAdminDigest(input: AdminDigestInput): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const hasActionItems =
    input.failedCompanies.length > 0 ||
    input.watchList.length > 0 ||
    input.autoDisabled.length > 0 ||
    input.subscribedZeroDrops.length > 0 ||
    input.emailBatchResult.failed > 0;

  // Daily silence: no email when nothing needs attention.
  if (!input.isMondayDigest && !hasActionItems) {
    console.log("Admin digest: silent success day — no email sent");
    return;
  }

  const { ADMIN_EMAIL } = await import("../lib/constants");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

  // Build subject: prioritize action items, fall back to Monday digest framing
  const subjectParts: string[] = [];
  if (input.failedCompanies.length > 0) subjectParts.push(`${input.failedCompanies.length} failed`);
  if (input.autoDisabled.length > 0) subjectParts.push(`${input.autoDisabled.length} auto-disabled`);
  if (input.watchList.length > 0) subjectParts.push(`${input.watchList.length} on watch`);
  if (input.subscribedZeroDrops.length > 0) subjectParts.push(`${input.subscribedZeroDrops.length} dropped to 0`);
  if (input.emailBatchResult.failed > 0) subjectParts.push(`${input.emailBatchResult.failed} email send failures`);

  let subject: string;
  if (subjectParts.length > 0) {
    subject = `NewPMJobs admin: ${subjectParts.join(", ")}`;
  } else {
    // Monday-only with no action items — pure weekly digest
    const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
    subject = `NewPMJobs weekly digest — ${date}`;
  }

  let html = `<div style="font-family:${font};max-width:700px;color:#1A1A2E;">`;

  // -------- Action-required sections (red) --------
  if (hasActionItems) {
    html += `<h2 style="margin:0 0 12px 0;color:#dc2626;">Needs your attention</h2>`;
  }

  if (input.failedCompanies.length > 0) {
    html += `<h3 style="margin:16px 0 6px 0;color:#dc2626;">Failed scrapes today (${input.failedCompanies.length})</h3>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="background:#fef2f2;">
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fecaca;">Company</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fecaca;">Streak</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fecaca;">Error</th>
      </tr>`;
    for (const f of input.failedCompanies) {
      const streak = `${f.consecutiveFailures} of 7`;
      const streakColor = f.consecutiveFailures >= 5 ? "#dc2626" : f.consecutiveFailures >= 3 ? "#ea580c" : "#78716c";
      html += `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;">${escapeHtml(f.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:${streakColor};font-weight:bold;">${streak}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:#6b7280;font-size:12px;">${escapeHtml(f.error.slice(0, 180))}</td>
      </tr>`;
    }
    html += `</table>`;
  }

  if (input.watchList.length > 0) {
    html += `<h3 style="margin:16px 0 6px 0;color:#ea580c;">Watch list — heading toward auto-disable (${input.watchList.length})</h3>`;
    html += `<p style="font-size:13px;color:#6b7280;margin:4px 0 8px 0;">These companies have failed multiple days in a row. Auto-disables at 7 strikes.</p>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="background:#fff7ed;">
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fed7aa;">Company</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fed7aa;">Streak</th>
      </tr>`;
    for (const w of input.watchList) {
      html += `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;">${escapeHtml(w.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:#ea580c;font-weight:bold;">${w.consecutiveFailures} of 7</td>
      </tr>`;
    }
    html += `</table>`;
  }

  if (input.autoDisabled.length > 0) {
    html += `<h3 style="margin:16px 0 6px 0;color:#ea580c;">Auto-disabled today (${input.autoDisabled.length})</h3>`;
    html += `<p style="font-size:13px;color:#6b7280;margin:4px 0 8px 0;">Hit 7 consecutive failures. Skipped from cron until Monday probe checks again.</p>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="background:#fff7ed;">
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fed7aa;">Company</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fed7aa;">Last error</th>
      </tr>`;
    for (const d of input.autoDisabled) {
      html += `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;">${escapeHtml(d.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:#6b7280;font-size:12px;">${escapeHtml(d.reason.slice(0, 180))}</td>
      </tr>`;
    }
    html += `</table>`;
  }

  if (input.subscribedZeroDrops.length > 0) {
    html += `<h3 style="margin:16px 0 6px 0;color:#dc2626;">Subscribed company dropped to 0 jobs (${input.subscribedZeroDrops.length})</h3>`;
    html += `<p style="font-size:13px;color:#6b7280;margin:4px 0 8px 0;">These companies had jobs yesterday but show 0 today. Check if scraper broke.</p>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="background:#fef2f2;">
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fecaca;">Company</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fecaca;">Previous</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fecaca;">Subscribers</th>
      </tr>`;
    for (const z of input.subscribedZeroDrops) {
      html += `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;">${escapeHtml(z.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:#dc2626;font-weight:bold;">${z.prevCount} → 0</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;">${z.subscribers}</td>
      </tr>`;
    }
    html += `</table>`;
  }

  if (input.emailBatchResult.failed > 0) {
    html += `<h3 style="margin:16px 0 6px 0;color:#dc2626;">Email delivery failures (${input.emailBatchResult.failed})</h3>`;
    html += `<p style="font-size:13px;">${input.emailBatchResult.sent} sent, <strong style="color:#dc2626;">${input.emailBatchResult.failed} failed</strong>.</p>`;
    const errors = input.emailBatchResult.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
    html += `<ul style="font-size:12px;color:#6b7280;">${errors}</ul>`;
    html += `<p style="font-size:12px;color:#6b7280;">Check <a href="https://resend.com/emails" style="color:#0EA5E9;">Resend dashboard</a> for details.</p>`;
  }

  // -------- Monday-only weekly digest sections --------
  if (input.isMondayDigest) {
    html += `<h2 style="margin:32px 0 12px 0;color:#1A1A2E;border-top:1px solid #e7e5e4;padding-top:24px;">Weekly digest</h2>`;

    if (input.weeklyHealth) {
      html += `<h3 style="margin:16px 0 6px 0;color:#16a34a;">System health</h3>`;
      html += `<table style="border-collapse:collapse;font-size:14px;margin-bottom:12px;">
        <tr><td style="padding:4px 16px 4px 0;color:#78716c;">Healthy scrapers</td><td style="font-weight:bold;color:#16a34a;">${input.weeklyHealth.healthy} / ${input.totalCompanies}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#78716c;">Watch list</td><td style="font-weight:bold;color:#ea580c;">${input.weeklyHealth.watchListCount}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#78716c;">Currently auto-disabled</td><td style="font-weight:bold;color:#dc2626;">${input.weeklyHealth.disabled}</td></tr>
      </table>`;
    }

    const events = input.weeklyEvents || [];
    if (events.length > 0) {
      const byType: Record<string, typeof events> = {};
      for (const e of events) {
        if (!byType[e.event_type]) byType[e.event_type] = [];
        byType[e.event_type].push(e);
      }

      const eventTypeLabels: Record<string, { label: string; color: string }> = {
        auto_remediation: { label: "Platform auto-fixed", color: "#16a34a" },
        stealth_recovery: { label: "Stealth fallback recovered jobs", color: "#16a34a" },
        auto_re_enabled: { label: "Re-enabled by Monday probe", color: "#16a34a" },
        auto_disabled: { label: "Auto-disabled", color: "#ea580c" },
      };

      html += `<h3 style="margin:16px 0 6px 0;color:#1A1A2E;">Self-heal log (past 7 days)</h3>`;
      for (const [type, list] of Object.entries(byType)) {
        const meta = eventTypeLabels[type] || { label: type, color: "#6b7280" };
        html += `<p style="margin:12px 0 4px 0;font-weight:bold;color:${meta.color};">${meta.label} (${list.length})</p>`;
        html += `<ul style="margin:4px 0 0 0;padding-left:20px;font-size:13px;">`;
        for (const e of list) {
          const when = new Date(e.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const detailsStr = e.details ? ` — ${escapeHtml(JSON.stringify(e.details).slice(0, 120))}` : "";
          html += `<li style="margin:2px 0;color:#374151;">${escapeHtml(e.company_name)} <span style="color:#9ca3af;font-size:12px;">(${when})</span>${detailsStr}</li>`;
        }
        html += `</ul>`;
      }
    } else if (input.isMondayDigest) {
      html += `<p style="font-size:13px;color:#6b7280;">No self-healing actions in the past 7 days. Everything ran clean.</p>`;
    }

    // Show today's just-happened events on Monday for completeness
    if (input.reEnabled.length > 0) {
      html += `<h3 style="margin:16px 0 6px 0;color:#16a34a;">Re-enabled today (${input.reEnabled.length})</h3>`;
      html += `<ul style="font-size:13px;">`;
      for (const r of input.reEnabled) html += `<li>${escapeHtml(r.name)} — ${r.jobCount} jobs</li>`;
      html += `</ul>`;
    }
  }

  html += `<p style="margin-top:24px;padding-top:12px;border-top:1px solid #e7e5e4;font-size:11px;color:#a8a29e;">
    NewPMJobs admin digest. ${input.isMondayDigest ? "Weekly digest sent every Monday." : "Daily digest fires only when something needs attention."}
    Full logs: <a href="https://newpmjobs.sentry.io" style="color:#0EA5E9;">Sentry</a>.
  </p></div>`;

  try {
    await resend.emails.send({
      from: "NewPMJobs <alerts@newpmjobs.com>",
      to: ADMIN_EMAIL,
      subject,
      html,
    });
    console.log(`Admin digest sent: ${subject}`);
  } catch (err) {
    console.error("Failed to send admin digest:", err);
  }
}
