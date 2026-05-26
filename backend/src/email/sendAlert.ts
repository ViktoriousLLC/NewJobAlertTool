import { Resend } from "resend";

export interface NewJobAlert {
  companyName: string;
  careersUrl: string;
  newJobs: { title: string; urlPath: string }[];
}

/**
 * Discovery hook surfaced at the bottom of each alert email. Picks 3
 * companies the user does NOT subscribe to, drawn from industries the user
 * has shown interest in via their existing subscriptions. Built in
 * dailyCheck.ts:pickRecommendations.
 */
export interface RecommendedCompany {
  companyName: string;
  careersUrl: string;
  industry: string;
  totalNewThisWeek: number;
  topRoles: { title: string; urlPath: string }[];
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

function buildRecommendationsSection(recommendations: RecommendedCompany[], font: string): string {
  if (recommendations.length === 0) return "";

  let cards = "";
  for (const rec of recommendations) {
    const logoUrl = getCompanyLogoUrl(rec.companyName, rec.careersUrl);
    const remaining = rec.totalNewThisWeek - rec.topRoles.length;

    let roleRows = "";
    for (const role of rec.topRoles) {
      const roleUrl = role.urlPath.startsWith("http")
        ? role.urlPath
        : new URL(role.urlPath, rec.careersUrl).href;
      roleRows += `
                              <tr>
                                <td style="padding:6px 0;font-size:14px;line-height:1.4;font-family:${font};">
                                  <a href="${escapeHtml(roleUrl)}" target="_blank" style="color:#0EA5E9;text-decoration:none;">${escapeHtml(role.title)}</a>
                                </td>
                              </tr>`;
    }

    const moreLine = remaining > 0
      ? `<tr><td style="padding:4px 0 0 0;font-size:12px;color:#a8a29e;font-family:${font};">+ ${remaining} more new role${remaining === 1 ? "" : "s"} this week</td></tr>`
      : "";

    cards += `
                          <tr>
                            <td style="padding:0 0 12px 0;">
                              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFCF7;border:1px solid #F3E8D2;border-radius:8px;">
                                <tr>
                                  <td style="padding:14px 18px 4px 18px;">
                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                      <tr>
                                        <td style="font-size:15px;font-weight:700;color:#1A1A2E;font-family:${font};">
                                          <img src="${escapeHtml(logoUrl)}" alt="" width="18" height="18" style="vertical-align:middle;margin-right:8px;border-radius:4px;" />
                                          ${escapeHtml(rec.companyName)}
                                          <span style="font-weight:400;color:#a8a29e;font-size:12px;margin-left:6px;">· ${escapeHtml(rec.industry)}</span>
                                        </td>
                                        <td align="right" style="font-size:12px;color:#78716c;font-family:${font};">
                                          ${rec.totalNewThisWeek} new this week
                                        </td>
                                      </tr>
                                    </table>
                                  </td>
                                </tr>
                                <tr>
                                  <td style="padding:6px 18px 14px 18px;">
                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${roleRows}${moreLine}</table>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>`;
  }

  const totalRecJobs = recommendations.reduce((sum, r) => sum + r.totalNewThisWeek, 0);
  const totalRecCompanies = recommendations.length;

  return `
                          <tr>
                            <td style="padding:24px 0 12px 0;border-top:1px solid #e7e5e4;">
                              <h3 style="margin:0 0 4px 0;font-size:15px;font-weight:700;color:#1A1A2E;font-family:${font};">Companies you may find interesting</h3>
                              <p style="margin:0 0 12px 0;font-size:13px;color:#78716c;font-family:${font};">Based on the industries you already track.</p>
                            </td>
                          </tr>
                          ${cards}
                          <tr>
                            <td style="padding:4px 0 0 0;font-size:12px;color:#a8a29e;font-family:${font};">
                              ${totalRecCompanies} compan${totalRecCompanies === 1 ? "y" : "ies"} · ${totalRecJobs} new role${totalRecJobs === 1 ? "" : "s"} this week
                            </td>
                          </tr>`;
}

function buildAlertHtml(alerts: NewJobAlert[], now: string, period: "daily" | "weekly" = "daily", recommendations: RecommendedCompany[] = []): string {
  // Firehose-sort: companies with >=10 new jobs (Microsoft/Amazon style)
  // drowned out single-job companies the admin actually wanted to see.
  // Now: small batches first (DESC by count so 8 > 5 > 3 > 1), then the
  // firehoses pinned to the bottom (still DESC among themselves). Keeps
  // the "I just got an Anthropic role" jolt at the top of the email.
  const FIREHOSE_THRESHOLD = 10;
  const small: NewJobAlert[] = [];
  const big: NewJobAlert[] = [];
  for (const a of alerts) {
    if (a.newJobs.length >= FIREHOSE_THRESHOLD) big.push(a);
    else small.push(a);
  }
  small.sort((a, b) => b.newJobs.length - a.newJobs.length);
  big.sort((a, b) => b.newJobs.length - a.newJobs.length);
  const sorted = [...small, ...big];
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

  // Recommendations (PR #1b): 3 companies the user does NOT subscribe to,
  // drawn from industries they already track. Renders only when the per-user
  // builder in dailyCheck.ts provides any. Always sits after the alert cards
  // and before the no-new-jobs tail so it's the email's discovery hook.
  const recsSection = buildRecommendationsSection(recommendations, font);

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
                ${recsSection}
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
  period: "daily" | "weekly" = "daily",
  recommendations: RecommendedCompany[] = []
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

  const html = buildAlertHtml(alerts, now, period, recommendations);

  const subject = period === "weekly"
    ? `Weekly PM Digest: ${totalNewJobs} new job${totalNewJobs === 1 ? "" : "s"} this week`
    : `Job Alert: ${totalNewJobs} new PM job${totalNewJobs === 1 ? "" : "s"} (${now})`;

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
  unverifiedZeros: { name: string; subscribers: number; lastCheckedAt: string | null }[];
  autoRemediated: { name: string; from: string; to: string }[];
  stealthRecovered: { name: string; jobCount: number }[];
  // DEV-19: proactive auto-fix layer. Rule-based DB fixes applied during this
  // cron run. Falls under self-healing in the green-section rollup.
  autoFixed?: { name: string; ruleId: string; description: string; message: string }[];
  reEnabled: { name: string; jobCount: number }[];
  emailBatchResult: BatchSendResult;
  isMondayDigest: boolean;
  weeklyHealth?: { healthy: number; disabled: number; watchListCount: number };
  weeklyEvents?: { event_type: string; company_name: string; created_at: string; details: Record<string, unknown> | null }[];
  securityFindings?: {
    totalVulns: number;
    bySeverity: { info: number; low: number; moderate: number; high: number; critical: number };
    current: { package: string; severity: string; fixAvailable: boolean; via: string }[];
    newSinceLastWeek: { package: string; severity: string; fixAvailable: boolean; via: string }[];
    resolvedSinceLastWeek: { package: string; severity: string; fixAvailable: boolean; via: string }[];
    isFirstSnapshot: boolean;
  } | null;
  // ---- Analysis layer (PR #19) ----
  // Optional. When provided, the digest renders per-company trend annotations
  // inline and a cross-cutting pattern callout near the top. Built in
  // dailyCheck.ts:buildDigestAnalysis. Old callers without these fields still
  // render correctly — annotations and patterns just don't appear.
  perCompanyTrends?: Map<string, string>;
  crossCuttingPatterns?: { kind: string; description: string; companies: string[] }[];
}

function trendAnnotation(trends: Map<string, string> | undefined, name: string): string {
  const t = trends?.get(name);
  if (!t) return "";
  return `<div style="margin-top:2px;font-size:11px;color:#6b7280;font-style:italic;">${escapeHtml(t)}</div>`;
}

export async function sendAdminDigest(input: AdminDigestInput): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  // Kill switch for the admin digest. Set SUPPRESS_ADMIN_DIGEST=true on
  // Railway to silence this email entirely — useful when a noisy migration
  // is in progress, or when transitioning to a different reporting layer
  // (e.g., a future LLM-driven curated push). Default off so legacy
  // behavior is preserved.
  if (process.env.SUPPRESS_ADMIN_DIGEST === "true") {
    console.log("Admin digest: suppressed by SUPPRESS_ADMIN_DIGEST env var");
    return;
  }

  const hasActionItems =
    input.failedCompanies.length > 0 ||
    input.watchList.length > 0 ||
    input.autoDisabled.length > 0 ||
    input.subscribedZeroDrops.length > 0 ||
    input.unverifiedZeros.length > 0 ||
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
  if (input.unverifiedZeros.length > 0) subjectParts.push(`${input.unverifiedZeros.length} unverified zeros`);
  if (input.emailBatchResult.failed > 0) subjectParts.push(`${input.emailBatchResult.failed} email send failures`);

  let subject: string;
  if (subjectParts.length > 0) {
    subject = `NewPMJobs admin: ${subjectParts.join(", ")}`;
  } else {
    // Monday-only with no action items — pure weekly digest
    const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
    subject = `NewPMJobs weekly digest: ${date}`;
  }

  let html = `<div style="font-family:${font};max-width:700px;color:#1A1A2E;">`;

  // -------- Top-of-email TL;DR (PR #19) --------
  // Severity rollup so the admin can triage from the subject line + this
  // single block without scrolling.
  if (hasActionItems || input.isMondayDigest) {
    const rollupParts: string[] = [];
    if (input.failedCompanies.length > 0) {
      const withDoctorHint = input.failedCompanies.filter((f) => f.consecutiveFailures >= 3).length;
      const hint = withDoctorHint > 0 ? ` (${withDoctorHint} ≥3 streak, consider scraper-doctor)` : "";
      rollupParts.push(`<span style="color:#dc2626;font-weight:bold;">🔴 ${input.failedCompanies.length} broken${hint}</span>`);
    }
    if (input.autoDisabled.length > 0) {
      rollupParts.push(`<span style="color:#dc2626;font-weight:bold;">⛔ ${input.autoDisabled.length} auto-disabled</span>`);
    }
    if (input.subscribedZeroDrops.length > 0) {
      rollupParts.push(`<span style="color:#dc2626;font-weight:bold;">📉 ${input.subscribedZeroDrops.length} dropped to 0 (subscribed)</span>`);
    }
    if (input.watchList.length > 0) {
      rollupParts.push(`<span style="color:#ea580c;font-weight:bold;">🟡 ${input.watchList.length} on watch</span>`);
    }
    if (input.unverifiedZeros.length > 0) {
      const withSubs = input.unverifiedZeros.filter((z) => z.subscribers > 0).length;
      const subsNote = withSubs > 0 ? ` (${withSubs} with subscribers)` : "";
      rollupParts.push(`<span style="color:#a16207;">⚪ ${input.unverifiedZeros.length} unverified zeros${subsNote}</span>`);
    }
    if (input.emailBatchResult.failed > 0) {
      rollupParts.push(`<span style="color:#dc2626;font-weight:bold;">📨 ${input.emailBatchResult.failed} email send failures</span>`);
    }
    if (input.reEnabled.length > 0) {
      rollupParts.push(`<span style="color:#16a34a;">✅ ${input.reEnabled.length} re-enabled today</span>`);
    }
    const autoFixedCount = input.autoFixed?.length ?? 0;
    if (input.autoRemediated.length > 0 || input.stealthRecovered.length > 0 || autoFixedCount > 0) {
      const selfHealCount = input.autoRemediated.length + input.stealthRecovered.length + autoFixedCount;
      rollupParts.push(`<span style="color:#16a34a;">🛠 ${selfHealCount} self-healed today</span>`);
    }
    if (autoFixedCount > 0) {
      rollupParts.push(`<span style="color:#16a34a;">🤖 ${autoFixedCount} auto-fixed by rule</span>`);
    }
    const healthyCount = input.weeklyHealth ? input.weeklyHealth.healthy : input.totalCompanies - input.failedCompanies.length - input.autoDisabled.length - input.watchList.length;
    rollupParts.push(`<span style="color:#16a34a;">💚 ${healthyCount} / ${input.totalCompanies} healthy</span>`);

    html += `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;margin-bottom:20px;font-size:14px;line-height:1.8;">${rollupParts.join(" · ")}</div>`;
  }

  // -------- Cross-cutting patterns (PR #19) --------
  // Surface clusters before the per-company tables so the admin sees the
  // forest, not just the trees. Example: 3 Ashby failures today → maybe
  // Ashby's GraphQL is down, don't chase each company.
  if (input.crossCuttingPatterns && input.crossCuttingPatterns.length > 0) {
    html += `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin-bottom:20px;font-size:13px;">`;
    html += `<div style="font-weight:bold;color:#92400e;margin-bottom:6px;">🔍 Patterns detected</div>`;
    html += `<ul style="margin:0;padding-left:20px;color:#78350f;">`;
    for (const p of input.crossCuttingPatterns) {
      html += `<li style="margin:4px 0;">${escapeHtml(p.description)} <span style="color:#a16207;font-style:italic;">(${p.companies.slice(0, 5).map(escapeHtml).join(", ")}${p.companies.length > 5 ? `, +${p.companies.length - 5} more` : ""})</span></li>`;
    }
    html += `</ul></div>`;
  }

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
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;">${escapeHtml(f.name)}${trendAnnotation(input.perCompanyTrends, f.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:${streakColor};font-weight:bold;">${streak}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:#6b7280;font-size:12px;">${escapeHtml(f.error.slice(0, 180))}</td>
      </tr>`;
    }
    html += `</table>`;
  }

  if (input.watchList.length > 0) {
    html += `<h3 style="margin:16px 0 6px 0;color:#ea580c;">Watch list: heading toward auto-disable (${input.watchList.length})</h3>`;
    html += `<p style="font-size:13px;color:#6b7280;margin:4px 0 8px 0;">These companies have failed multiple days in a row. Auto-disables at 7 strikes.</p>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="background:#fff7ed;">
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fed7aa;">Company</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fed7aa;">Streak</th>
      </tr>`;
    for (const w of input.watchList) {
      html += `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;">${escapeHtml(w.name)}${trendAnnotation(input.perCompanyTrends, w.name)}</td>
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
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;">${escapeHtml(z.name)}${trendAnnotation(input.perCompanyTrends, z.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:#dc2626;font-weight:bold;">${z.prevCount} → 0</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;">${z.subscribers}</td>
      </tr>`;
    }
    html += `</table>`;
  }

  if (input.unverifiedZeros.length > 0) {
    const UNVERIFIED_ZERO_DISPLAY_CAP = 25;
    const shown = input.unverifiedZeros.slice(0, UNVERIFIED_ZERO_DISPLAY_CAP);
    const overflow = input.unverifiedZeros.length - shown.length;

    html += `<h3 style="margin:16px 0 6px 0;color:#dc2626;">Unverified zeros: confirm legitimate (${input.unverifiedZeros.length})</h3>`;
    html += `<p style="font-size:13px;color:#6b7280;margin:4px 0 8px 0;">These companies returned 0 PM jobs. Either the scraper is silently broken, or the company genuinely has no open PM roles. Mark each as <code>is_verified_zero = true</code> in the <code>companies</code> table once you've confirmed it. Sorted by subscriber count.</p>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="background:#fef2f2;">
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fecaca;">Company</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fecaca;">Subscribers</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #fecaca;">Last checked</th>
      </tr>`;
    for (const z of shown) {
      const checked = z.lastCheckedAt ? new Date(z.lastCheckedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "n/a";
      const subColor = z.subscribers > 0 ? "#dc2626" : "#78716c";
      html += `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;">${escapeHtml(z.name)}${trendAnnotation(input.perCompanyTrends, z.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:${subColor};font-weight:bold;">${z.subscribers}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:#6b7280;font-size:12px;">${checked}</td>
      </tr>`;
    }
    html += `</table>`;
    if (overflow > 0) {
      html += `<p style="font-size:12px;color:#6b7280;margin:6px 0 0 0;font-style:italic;">…and ${overflow} more. Query <code>companies WHERE total_product_jobs = 0 AND is_verified_zero = FALSE</code> for the full list.</p>`;
    }
  }

  // DEV-19: rule-based auto-fixes applied during this run. Show them on every
  // day they fire (not just Monday) so the admin sees the system fixed
  // something without needing to dig through scraper_events.
  if (input.autoFixed && input.autoFixed.length > 0) {
    html += `<h3 style="margin:16px 0 6px 0;color:#16a34a;">🤖 Auto-fixed today (${input.autoFixed.length})</h3>`;
    html += `<p style="font-size:13px;color:#374151;margin:4px 0 8px 0;">Rule-based fixes applied to broken company configs. No human intervention needed.</p>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="background:#f0fdf4;">
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #bbf7d0;color:#166534;">Company</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #bbf7d0;color:#166534;">Rule</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #bbf7d0;color:#166534;">What changed</th>
      </tr>`;
    for (const f of input.autoFixed) {
      html += `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;font-weight:600;">${escapeHtml(f.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;"><code style="font-size:11px;color:#6b7280;">${escapeHtml(f.ruleId)}</code></td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e5e4;color:#374151;">${escapeHtml(f.message)}</td>
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
        auto_fix_applied: { label: "Rule-based auto-fix applied", color: "#16a34a" },
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
          const detailsStr = e.details ? `: ${escapeHtml(JSON.stringify(e.details).slice(0, 120))}` : "";
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
      for (const r of input.reEnabled) html += `<li>${escapeHtml(r.name)}: ${r.jobCount} jobs</li>`;
      html += `</ul>`;
    }

    // --- Security check ---
    if (input.securityFindings) {
      const s = input.securityFindings;
      const sevColors: Record<string, string> = {
        critical: "#dc2626",
        high: "#dc2626",
        moderate: "#ea580c",
        low: "#6b7280",
        info: "#9ca3af",
      };

      html += `<h3 style="margin:24px 0 6px 0;color:#1A1A2E;">Security check (npm audit)</h3>`;

      if (s.totalVulns === 0) {
        html += `<p style="font-size:13px;color:#16a34a;margin:4px 0;">✓ 0 known vulnerabilities in production dependencies.</p>`;
      } else {
        // Summary line: counts by severity
        const sevSummary = (["critical", "high", "moderate", "low", "info"] as const)
          .filter((sev) => s.bySeverity[sev] > 0)
          .map((sev) => `<span style="color:${sevColors[sev]};font-weight:bold;">${s.bySeverity[sev]} ${sev}</span>`)
          .join(", ");
        html += `<p style="font-size:13px;margin:4px 0;">${s.totalVulns} known vulnerabilit${s.totalVulns === 1 ? "y" : "ies"}: ${sevSummary}</p>`;

        // New vulns this week (the most actionable signal)
        if (s.newSinceLastWeek.length > 0) {
          html += `<p style="margin:8px 0 4px 0;font-weight:bold;color:#dc2626;">New this week (${s.newSinceLastWeek.length})</p>`;
          html += `<ul style="margin:4px 0 0 0;padding-left:20px;font-size:13px;">`;
          for (const v of s.newSinceLastWeek) {
            const fixBadge = v.fixAvailable
              ? ` <span style="color:#16a34a;font-size:11px;">(npm audit fix available)</span>`
              : ` <span style="color:#ea580c;font-size:11px;">(no automatic fix)</span>`;
            html += `<li style="margin:2px 0;"><strong>${escapeHtml(v.package)}</strong> <span style="color:${sevColors[v.severity] || "#6b7280"};">[${escapeHtml(v.severity)}]</span>: ${escapeHtml(v.via.slice(0, 120))}${fixBadge}</li>`;
          }
          html += `</ul>`;
        }

        if (s.resolvedSinceLastWeek.length > 0) {
          html += `<p style="margin:8px 0 4px 0;color:#16a34a;font-size:13px;">Resolved since last week: ${s.resolvedSinceLastWeek.map((v) => escapeHtml(v.package)).join(", ")}</p>`;
        }

        // Ongoing vulns (only show if there are any new ones or it's the first snapshot,
        // otherwise repeat-week noise — the new/resolved diff is the actionable signal)
        if ((s.newSinceLastWeek.length > 0 || s.isFirstSnapshot) && s.current.length > s.newSinceLastWeek.length) {
          const ongoing = s.current.filter((v) => !s.newSinceLastWeek.some((n) => n.package === v.package));
          if (ongoing.length > 0) {
            html += `<p style="margin:8px 0 4px 0;color:#6b7280;font-size:13px;">Ongoing (carried from previous weeks): ${ongoing.slice(0, 10).map((v) => `${escapeHtml(v.package)} [${v.severity}]`).join(", ")}${ongoing.length > 10 ? `, +${ongoing.length - 10} more` : ""}</p>`;
          }
        }

        if (s.isFirstSnapshot) {
          html += `<p style="font-size:11px;color:#9ca3af;font-style:italic;margin:8px 0 0 0;">First snapshot. Next Monday will show what changed.</p>`;
        }
      }

      html += `<p style="font-size:11px;color:#9ca3af;margin:4px 0 0 0;">Backend production dependencies only. Frontend audit runs at Vercel build time.</p>`;
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
