import { supabase } from "../lib/supabase";
import { scrapeCompanyCareers } from "../scraper/scraper";
import { validateScrapeResults } from "../scraper/validateScrape";
import { sendBatchAlerts, buildAlertEmailPayload, notifyAdminOfFailures, NewJobAlert, EmailPayload } from "../email/sendAlert";
import { classifyJobLevel } from "../lib/classifyLevel";
import { getCompData } from "../lib/levelsFyi";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Overlap guard: prevent concurrent daily check runs
let dailyCheckRunning = false;

export async function runDailyCheck(): Promise<void> {
  if (dailyCheckRunning) {
    console.warn("Daily check already running — skipping this trigger to prevent overlap");
    return;
  }
  dailyCheckRunning = true;

  try {
    await runDailyCheckInner();
  } finally {
    dailyCheckRunning = false;
  }
}

async function runDailyCheckInner(): Promise<void> {
  console.log("Starting daily job check...");

  // Scrape all companies so the catalog stays fresh (even with 0 subscribers)
  const { data: companies, error } = await supabase
    .from("companies")
    .select("*");

  if (error || !companies) {
    console.error("Failed to fetch companies:", error);
    return;
  }

  console.log(`Checking ${companies.length} companies...`);

  // Collect alerts per company for later per-user email distribution
  const companyAlerts: Map<
    string,
    { companyName: string; careersUrl: string; newJobs: { title: string; urlPath: string }[] }
  > = new Map();

  for (const company of companies) {
    try {
      console.log(`Scraping: ${company.name} (${company.careers_url})`);
      const rawJobs = await scrapeCompanyCareers(
        company.careers_url,
        company.platform_type || null,
        company.platform_config || null
      );

      // Run quality validation to filter non-PM jobs
      const validation = validateScrapeResults(rawJobs, company.name);
      const jobs = validation.filteredJobs;
      if (validation.warnings.length > 0) {
        console.log(`Quality warnings for ${company.name}:`, validation.warnings);
      }
      console.log(`Found ${jobs.length} product jobs for ${company.name} (${rawJobs.length} raw)`);

      // Get existing active jobs for this company
      const { data: existingJobs } = await supabase
        .from("seen_jobs")
        .select("id, job_url_path, status")
        .eq("company_id", company.id);

      const existingByPath = new Map<string, { id: string; status: string }>();
      for (const j of existingJobs || []) {
        existingByPath.set(j.job_url_path, { id: j.id, status: j.status });
      }

      const scrapedPaths = new Set(jobs.map((j) => j.urlPath));
      const newJobs: { title: string; urlPath: string }[] = [];

      // Safety: if scrape returns 0 for a company with existing active jobs, skip removal marking
      const existingActiveCount = (existingJobs || []).filter((j) => j.status === "active").length;
      const scrapeReturnedZero = jobs.length === 0 && existingActiveCount > 0;
      if (scrapeReturnedZero) {
        console.warn(`SAFETY: ${company.name} scrape returned 0 jobs but has ${existingActiveCount} active. Skipping removal marking.`);
      }

      // 1. New jobs: in scrape, not in DB → INSERT with status='active'
      const toInsert = jobs.filter((j) => !existingByPath.has(j.urlPath));
      if (toInsert.length > 0) {
        const { error: insertError } = await supabase.from("seen_jobs").insert(
          toInsert.map((j) => ({
            company_id: company.id,
            job_url_path: j.urlPath,
            job_title: j.title,
            job_location: j.location,
            is_baseline: false,
            job_level: classifyJobLevel(j.title),
            status: "active",
          }))
        );
        if (insertError) {
          console.error(`Failed to insert jobs for ${company.name}:`, insertError);
        }

        newJobs.push(...toInsert.map((j) => ({ title: j.title, urlPath: j.urlPath })));
      }

      // 2. Returned jobs: in DB as 'removed', back in scrape → UPDATE to 'active', treat as new
      const returnedJobs: { title: string; urlPath: string }[] = [];
      for (const job of jobs) {
        const existing = existingByPath.get(job.urlPath);
        if (existing && existing.status === "removed") {
          await supabase
            .from("seen_jobs")
            .update({ status: "active", status_changed_at: new Date().toISOString() })
            .eq("id", existing.id);
          returnedJobs.push({ title: job.title, urlPath: job.urlPath });
        }
      }
      if (returnedJobs.length > 0) {
        console.log(`${company.name}: ${returnedJobs.length} jobs returned (re-activated)`);
        newJobs.push(...returnedJobs);
      }

      // 3. Missing jobs: in DB as 'active', not in scrape → mark 'removed'
      if (!scrapeReturnedZero) {
        const toRemove = (existingJobs || []).filter(
          (j) => j.status === "active" && !scrapedPaths.has(j.job_url_path)
        );
        if (toRemove.length > 0) {
          const removeIds = toRemove.map((j) => j.id);
          await supabase
            .from("seen_jobs")
            .update({ status: "removed", status_changed_at: new Date().toISOString() })
            .in("id", removeIds);
          console.log(`${company.name}: ${toRemove.length} jobs marked as removed`);
        }
      }

      // Count actual active jobs in DB (after inserts/removals above)
      const { count: activeJobCount } = await supabase
        .from("seen_jobs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .eq("status", "active");

      // Update company status
      const checkStatus = validation.warnings.length > 0
        ? `success (quality: ${validation.qualityScore}/100)`
        : "success";
      await supabase
        .from("companies")
        .update({
          last_checked_at: new Date().toISOString(),
          last_check_status: checkStatus,
          total_product_jobs: activeJobCount ?? 0,
        })
        .eq("id", company.id);

      companyAlerts.set(company.id, {
        companyName: company.name,
        careersUrl: company.careers_url,
        newJobs,
      });
    } catch (err) {
      console.error(`Error scraping ${company.name}:`, err);

      await supabase
        .from("companies")
        .update({
          last_checked_at: new Date().toISOString(),
          last_check_status: `error: ${err instanceof Error ? err.message : "unknown"}`,
        })
        .eq("id", company.id);

      companyAlerts.set(company.id, {
        companyName: company.name,
        careersUrl: company.careers_url,
        newJobs: [],
      });
    }

    // Delay between companies to avoid rate limiting
    await delay(5000);
  }

  // --- Per-user email alerts ---
  try {
    await sendPerUserAlerts(companyAlerts);
  } catch (err) {
    console.error("Failed to send per-user alerts:", err);
  }

  // Refresh compensation data for all active companies
  console.log("Refreshing compensation data...");
  const companyNames = companies.map((c) => c.name);
  const COMP_BATCH = 3;
  for (let i = 0; i < companyNames.length; i += COMP_BATCH) {
    const batch = companyNames.slice(i, i + COMP_BATCH);
    await Promise.allSettled(batch.map((name) => getCompData(name)));
    if (i + COMP_BATCH < companyNames.length) await delay(2000);
  }
  console.log(`Compensation data refreshed for ${companyNames.length} companies.`);

  // Archive: mark jobs older than 60 days as 'archived' (replaces old 30-day DELETE)
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  await supabase
    .from("seen_jobs")
    .update({ status: "archived", status_changed_at: new Date().toISOString() })
    .eq("is_baseline", false)
    .neq("status", "archived")
    .lt("first_seen_at", sixtyDaysAgo.toISOString());

  console.log("Daily check complete.");
}

async function sendPerUserAlerts(
  companyAlerts: Map<string, { companyName: string; careersUrl: string; newJobs: { title: string; urlPath: string }[] }>
): Promise<void> {
  // Get all users
  const { data: usersData } = await supabase.auth.admin.listUsers();
  const users = usersData?.users || [];

  if (users.length === 0) {
    console.log("No users found — skipping email alerts");
    return;
  }

  // Get all user preferences
  const { data: allPrefs } = await supabase
    .from("user_preferences")
    .select("user_id, email_frequency");

  const prefsMap = new Map<string, string>();
  for (const pref of allPrefs || []) {
    prefsMap.set(pref.user_id, pref.email_frequency);
  }

  // Get all subscriptions (batched for all users)
  const { data: allSubs } = await supabase
    .from("user_subscriptions")
    .select("user_id, company_id");

  const userSubsMap = new Map<string, string[]>();
  for (const sub of allSubs || []) {
    const existing = userSubsMap.get(sub.user_id) || [];
    existing.push(sub.company_id);
    userSubsMap.set(sub.user_id, existing);
  }

  const isMonday = new Date().getUTCDay() === 1;

  // Collect all email payloads first, then batch-send via Resend batch API
  const emailPayloads: EmailPayload[] = [];

  for (const user of users) {
    if (!user.email) continue;

    // Check preference: default to 'daily' if not set
    const freq = prefsMap.get(user.id) || "daily";
    if (freq === "off") {
      console.log(`Skipping email for user ${user.id.slice(0, 8)}... (preference: off)`);
      continue;
    }

    // Weekly users only get emails on Mondays
    if (freq === "weekly" && !isMonday) {
      continue;
    }

    // Get this user's subscribed company IDs
    const userCompanyIds = userSubsMap.get(user.id) || [];
    if (userCompanyIds.length === 0) continue;

    if (freq === "weekly") {
      // Weekly digest: fetch jobs from the past 7 days for this user's subscriptions
      const weeklyAlerts = await getWeeklyAlerts(userCompanyIds);
      if (weeklyAlerts.length === 0) continue;

      emailPayloads.push(buildAlertEmailPayload(user.email, weeklyAlerts, "weekly"));
    } else {
      // Daily: use today's scrape results
      const userAlerts: NewJobAlert[] = [];
      for (const companyId of userCompanyIds) {
        const alert = companyAlerts.get(companyId);
        if (alert) {
          userAlerts.push(alert);
        }
      }

      if (userAlerts.length === 0) continue;

      emailPayloads.push(buildAlertEmailPayload(user.email, userAlerts, "daily"));
    }
  }

  // Batch send all emails (100 per API call, 1s delay between batches)
  console.log(`Sending ${emailPayloads.length} alert emails via batch API...`);
  const sendResult = await sendBatchAlerts(emailPayloads);
  console.log(`Per-user alerts: ${sendResult.sent} sent, ${sendResult.failed} failed`);

  // Notify admin if any emails failed
  if (sendResult.failed > 0) {
    await notifyAdminOfFailures(sendResult);
  }
}

/**
 * Fetch new jobs from the past 7 days for a set of companies.
 * Used for weekly digest emails.
 */
async function getWeeklyAlerts(companyIds: string[]): Promise<NewJobAlert[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Parallel: fetch companies + recent jobs
  const [companiesResult, jobsResult] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, careers_url")
      .in("id", companyIds),
    supabase
      .from("seen_jobs")
      .select("company_id, job_title, job_url_path")
      .in("company_id", companyIds)
      .eq("is_baseline", false)
      .eq("status", "active")
      .gte("first_seen_at", sevenDaysAgo.toISOString())
      .order("first_seen_at", { ascending: false }),
  ]);

  const companies = companiesResult.data || [];
  const jobs = jobsResult.data || [];

  const companyMap = new Map(companies.map((c) => [c.id, c]));

  // Group jobs by company
  const jobsByCompany = new Map<string, { title: string; urlPath: string }[]>();
  for (const job of jobs) {
    const list = jobsByCompany.get(job.company_id) || [];
    list.push({ title: job.job_title, urlPath: job.job_url_path });
    jobsByCompany.set(job.company_id, list);
  }

  const alerts: NewJobAlert[] = [];
  for (const companyId of companyIds) {
    const company = companyMap.get(companyId);
    if (!company) continue;
    alerts.push({
      companyName: company.name,
      careersUrl: company.careers_url,
      newJobs: jobsByCompany.get(companyId) || [],
    });
  }

  return alerts;
}
