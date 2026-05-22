// Branded HTML template for the admin-side feedback emails (/api/help,
// /api/issues). Visual style matches backend/src/jobs/weeklyDigest.ts:
// centered 640px card on light-gray page, system font stack, sky-blue
// accent on the message callout, dim uppercase section labels.
//
// This is a deliberately small helper. The full email-design pass is
// tracked in Linear (DEV: "Email design pass — all transactional emails").

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface FeedbackEmailMetadataRow {
  label: string;
  value: string;
  mono?: boolean; // render value in monospace (for IDs)
}

export interface FeedbackEmailOptions {
  category: string; // header eyebrow, e.g. "User Feedback" or "Scrape Issue"
  headline: string; // h1, e.g. "[bug] Add European jobs" or "Stripe — wrong_jobs"
  metadata: FeedbackEmailMetadataRow[]; // From / Type / Page / Company etc.
  linearUrl: string | null;
  linearIdentifier: string | null;
  message: string; // user's verbatim message, pre-trimmed
  adminEmail: string; // shown in footer
}

export function renderFeedbackEmail(opts: FeedbackEmailOptions): string {
  const metadataRows = opts.metadata
    .map(
      (row) => `
      <tr>
        <td style="padding:8px 16px 8px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(row.label)}</td>
        <td style="padding:8px 0;color:#111827;font-size:14px;${row.mono ? "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;" : ""}">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join("");

  const linearBlock = opts.linearUrl
    ? `
    <div style="margin:0 0 28px 0;">
      <a href="${escapeHtml(opts.linearUrl)}"
         style="display:inline-block;background:#0EA5E9;color:#ffffff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
        View ${escapeHtml(opts.linearIdentifier || "in Linear")} →
      </a>
    </div>`
    : `
    <div style="margin:0 0 28px 0;background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:6px;color:#991b1b;font-size:13px;line-height:1.5;">
      <strong>Linear issue creation failed.</strong> This email is the only record. Check Sentry for the error.
    </div>`;

  const messageHtml = escapeHtml(opts.message).replace(/\n/g, "<br/>");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<div style="max-width:640px;margin:0 auto;padding:32px 24px;background:#ffffff;">

  <div style="border-bottom:1px solid #e5e7eb;padding-bottom:20px;margin-bottom:24px;">
    <p style="margin:0 0 6px 0;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">
      NewPMJobs · ${escapeHtml(opts.category)}
    </p>
    <h1 style="margin:0;font-size:20px;font-weight:600;color:#111827;line-height:1.35;">
      ${escapeHtml(opts.headline)}
    </h1>
  </div>

  <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">${metadataRows}
  </table>

  ${linearBlock}

  <p style="margin:0 0 10px 0;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">
    Message
  </p>
  <div style="background:#f9fafb;border-left:4px solid #0EA5E9;padding:16px 20px;border-radius:6px;color:#111827;font-size:15px;line-height:1.6;white-space:pre-wrap;">
    ${messageHtml}
  </div>

  <p style="margin:36px 0 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.5;">
    Sent to ${escapeHtml(opts.adminEmail)} from alerts@newpmjobs.com
    <br/>Reply to this email or reply directly in Linear.
  </p>

</div>
</body></html>`;
}
