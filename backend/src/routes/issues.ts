import { Router, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { createUserFeedbackIssue } from "../lib/linear";
import { ADMIN_EMAIL } from "../lib/constants";

const router = Router();

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// POST /api/issues — report a scrape issue. Files a Linear issue in the
// User Feedback team (Inbox) and emails ADMIN_EMAIL. Legacy scrape_issues
// rows in Supabase are preserved for history; no new rows written there.
router.post("/", async (req: Request, res: Response) => {
  try {
    const { company_id, issue_type, description } = req.body;

    if (!company_id || !issue_type) {
      res.status(400).json({ error: "company_id and issue_type are required" });
      return;
    }

    const validTypes = ["wrong_jobs", "missing_jobs", "bad_locations", "other"];
    if (!validTypes.includes(issue_type)) {
      res.status(400).json({ error: `issue_type must be one of: ${validTypes.join(", ")}` });
      return;
    }

    // Length cap so a single user can't dump huge payloads into the admin queue.
    if (typeof description === "string" && description.length > 5000) {
      res.status(400).json({ error: "Description too long (max 5000 characters)" });
      return;
    }

    // Verify the user is subscribed to the company they're reporting on, and
    // pull the company name in the same trip for the Linear issue title.
    // Drive-by spam against arbitrary companies stays blocked.
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("id, companies(name)")
      .eq("user_id", req.userId!)
      .eq("company_id", company_id)
      .maybeSingle();

    if (!sub) {
      res.status(403).json({ error: "Not subscribed to this company" });
      return;
    }

    const companyRel = (sub as { companies?: { name?: string } | { name?: string }[] }).companies;
    const companyName = Array.isArray(companyRel)
      ? companyRel[0]?.name ?? "Unknown company"
      : companyRel?.name ?? "Unknown company";

    const trimmedDescription = typeof description === "string" ? description.slice(0, 5000) : null;
    const submitterIdent = req.userEmail || req.userId || "unknown";

    const issueDescription = `**From:** ${submitterIdent}
**Submitted:** ${new Date().toISOString()} via \`POST /api/issues\`
**Company:** ${companyName} (\`${company_id}\`)
**Original issue_type:** ${issue_type}

---

${trimmedDescription || "*(no description provided)*"}`;

    let linearIssueUrl: string | null = null;
    let linearIssueIdent: string | null = null;
    try {
      const issue = await createUserFeedbackIssue({
        title: `${companyName} — ${issue_type}`,
        description: issueDescription,
        typeLabel: "scraper-issue",
        sourceLabel: "in-app",
      });
      linearIssueUrl = issue?.url ?? null;
      linearIssueIdent = issue?.identifier ?? null;
    } catch (linearErr) {
      Sentry.captureException(linearErr);
      console.error("[/api/issues] Linear createUserFeedbackIssue failed:", linearErr);
    }

    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      const linearLine = linearIssueUrl
        ? `<p><strong>Linear:</strong> <a href="${escapeHtml(linearIssueUrl)}">${escapeHtml(linearIssueUrl)}</a></p>`
        : `<p><em>Linear issue creation failed — see Sentry. This email is the only record.</em></p>`;
      await resend.emails.send({
        from: "NewPMJobs <alerts@newpmjobs.com>",
        to: ADMIN_EMAIL,
        subject: `[NewPMJobs Scrape Issue] ${companyName} — ${issue_type}`,
        html: `<p><strong>From:</strong> ${escapeHtml(submitterIdent)}</p>
               <p><strong>Company:</strong> ${escapeHtml(companyName)} (<code>${escapeHtml(company_id)}</code>)</p>
               <p><strong>Type:</strong> ${escapeHtml(issue_type)}</p>
               ${linearLine}
               <p><strong>Description:</strong></p>
               <p>${trimmedDescription ? escapeHtml(trimmedDescription).replace(/\n/g, "<br>") : "<em>(none)</em>"}</p>`,
      });
    }

    res.json({
      success: true,
      linear_url: linearIssueUrl,
      linear_identifier: linearIssueIdent,
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/issues error:", err);
    res.status(500).json({ error: "Failed to report issue" });
  }
});

export default router;
