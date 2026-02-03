import { supabase } from "../lib/supabase";
import { scrapeCompanyCareers } from "../scraper/scraper";
import { sendAlert } from "../email/sendAlert";

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
      const jobs = await scrapeCompanyCareers(company.careers_url);
      console.log(`Found ${jobs.length} product jobs for ${company.name}`);

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
      await supabase
        .from("companies")
        .update({
          last_checked_at: new Date().toISOString(),
          last_check_status: "success",
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
