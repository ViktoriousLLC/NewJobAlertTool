import { supabase } from "../lib/supabase";
import { scrapeCompanyCareers } from "../scraper/scraper";
import { validateScrapeResults } from "../scraper/validateScrape";
import { sendAlert } from "../email/sendAlert";
import { classifyJobLevel } from "../lib/classifyLevel";
import { getCompData } from "../lib/levelsFyi";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDailyCheck(): Promise<void> {
  console.log("Starting daily job check...");

  const { data: companies, error } = await supabase
    .from("companies")
    .select("*");

  if (error || !companies) {
    console.error("Failed to fetch companies:", error);
    return;
  }

  console.log(`Checking ${companies.length} companies...`);

  const alerts: {
    companyName: string;
    careersUrl: string;
    newJobs: { title: string; urlPath: string }[];
  }[] = [];

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

      // Get existing seen jobs for this company
      const { data: existingJobs } = await supabase
        .from("seen_jobs")
        .select("job_url_path")
        .eq("company_id", company.id);

      const existingPaths = new Set(
        (existingJobs || []).map((j: { job_url_path: string }) => j.job_url_path)
      );

      // Find new jobs (not previously seen)
      const newJobs = jobs.filter((j) => !existingPaths.has(j.urlPath));

      // Insert new jobs
      if (newJobs.length > 0) {
        const { error: insertError } = await supabase.from("seen_jobs").insert(
          newJobs.map((j) => ({
            company_id: company.id,
            job_url_path: j.urlPath,
            job_title: j.title,
            job_location: j.location,
            is_baseline: false,
            job_level: classifyJobLevel(j.title),
          }))
        );
        if (insertError) {
          console.error(
            `Failed to insert jobs for ${company.name}:`,
            insertError
          );
        }
      }

      // Update company status
      const checkStatus = validation.warnings.length > 0
        ? `success (quality: ${validation.qualityScore}/100)`
        : "success";
      await supabase
        .from("companies")
        .update({
          last_checked_at: new Date().toISOString(),
          last_check_status: checkStatus,
          total_product_jobs: jobs.length,
        })
        .eq("id", company.id);

      alerts.push({
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

      alerts.push({
        companyName: company.name,
        careersUrl: company.careers_url,
        newJobs: [],
      });
    }

    // Delay between companies to avoid rate limiting
    await delay(5000);
  }

  // Send email alert
  try {
    await sendAlert(alerts);
  } catch (err) {
    console.error("Failed to send email alert:", err);
  }

  // Refresh compensation data for all companies (warms cache for detail pages)
  console.log("Refreshing compensation data...");
  const companyNames = companies.map((c) => c.name);
  const COMP_BATCH = 3;
  for (let i = 0; i < companyNames.length; i += COMP_BATCH) {
    const batch = companyNames.slice(i, i + COMP_BATCH);
    await Promise.allSettled(batch.map((name) => getCompData(name)));
    if (i + COMP_BATCH < companyNames.length) await delay(2000);
  }
  console.log(`Compensation data refreshed for ${companyNames.length} companies.`);

  // Clean up: delete non-baseline seen_jobs older than 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  await supabase
    .from("seen_jobs")
    .delete()
    .eq("is_baseline", false)
    .lt("first_seen_at", thirtyDaysAgo.toISOString());

  console.log("Daily check complete.");
}
