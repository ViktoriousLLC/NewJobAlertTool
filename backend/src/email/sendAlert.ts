import { Resend } from "resend";

interface NewJobAlert {
  companyName: string;
  careersUrl: string;
  newJobs: { title: string; urlPath: string }[];
}

export async function sendAlert(alerts: NewJobAlert[]): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set — skipping email send");
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  // Sort companies by number of new jobs (desc)
  const sorted = [...alerts].sort(
    (a, b) => b.newJobs.length - a.newJobs.length
  );

  const totalNewJobs = sorted.reduce((sum, a) => sum + a.newJobs.length, 0);
  const companiesWithNew = sorted.filter((a) => a.newJobs.length > 0);

  const now = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let html = `<h2>Job Alert Report — ${now}</h2>`;
  html += `<p><strong>${totalNewJobs} new product job(s)</strong> found across ${companiesWithNew.length} company/companies.</p>`;
  html += `<hr/>`;

  if (totalNewJobs === 0) {
    html += `<p>No new product jobs detected today. The system ran successfully and checked all tracked companies.</p>`;
  } else {
    for (const alert of sorted) {
      if (alert.newJobs.length === 0) continue;

      html += `<h3>${alert.companyName} (${alert.newJobs.length} new)</h3>`;
      html += `<ul>`;
      for (const job of alert.newJobs) {
        const jobUrl = job.urlPath.startsWith("http")
          ? job.urlPath
          : new URL(job.urlPath, alert.careersUrl).href;
        html += `<li><a href="${jobUrl}">${job.title}</a></li>`;
      }
      html += `</ul>`;
    }
  }

  // Also list companies with 0 new jobs
  const noNewJobs = sorted.filter((a) => a.newJobs.length === 0);
  if (noNewJobs.length > 0) {
    html += `<hr/><p><em>No new jobs at: ${noNewJobs.map((a) => a.companyName).join(", ")}</em></p>`;
  }

  await resend.emails.send({
    from: "vik@viktoriousllc.com",
    to: "vik@viktoriousllc.com",
    subject: `Job Alert: ${totalNewJobs} new product job(s) — ${now}`,
    html,
  });

  console.log(`Email sent: ${totalNewJobs} new jobs reported`);
}
