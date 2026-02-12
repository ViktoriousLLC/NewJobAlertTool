import { Resend } from "resend";

interface NewJobAlert {
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

function buildAlertHtml(alerts: NewJobAlert[], now: string): string {
  const sorted = [...alerts].sort(
    (a, b) => b.newJobs.length - a.newJobs.length
  );
  const totalNewJobs = sorted.reduce((sum, a) => sum + a.newJobs.length, 0);
  const companiesWithNew = sorted.filter((a) => a.newJobs.length > 0);
  const noNewJobs = sorted.filter((a) => a.newJobs.length === 0);

  const font =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

  // Summary banner: green if jobs found, muted grey if none
  const summaryText =
    totalNewJobs > 0
      ? `${totalNewJobs} new PM job${totalNewJobs === 1 ? "" : "s"} found today`
      : "No new jobs today";
  const summaryBg = totalNewJobs > 0 ? "#16874D" : "#78716c";

  // Build company sections
  let companySections = "";
  if (totalNewJobs > 0) {
    for (const alert of companiesWithNew) {
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
                      You're receiving this because you have daily alerts enabled.
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

export async function sendAlert(alerts: NewJobAlert[]): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set — skipping email send");
    return;
  }

  if (!process.env.ALERT_RECIPIENT_EMAIL) {
    console.log("ALERT_RECIPIENT_EMAIL not set — skipping email send");
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

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

  const html = buildAlertHtml(alerts, now);

  await resend.emails.send({
    from: "NewPMJobs <alerts@newpmjobs.com>",
    to: process.env.ALERT_RECIPIENT_EMAIL!,
    subject: `Job Alert: ${totalNewJobs} new PM job${totalNewJobs === 1 ? "" : "s"} — ${now}`,
    html,
  });

  console.log(`Email sent: ${totalNewJobs} new jobs reported`);
}
