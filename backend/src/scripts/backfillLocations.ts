import dotenv from "dotenv";
dotenv.config();

import { supabase } from "../lib/supabase";
import { scrapeCompanyCareers } from "../scraper/scraper";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backfillLocations() {
  console.log("Starting location backfill...");

  const { data: companies, error } = await supabase
    .from("companies")
    .select("*");

  if (error || !companies) {
    console.error("Failed to fetch companies:", error);
    return;
  }

  console.log(`Found ${companies.length} companies to process.`);

  for (const company of companies) {
    console.log(`\nScraping: ${company.name} (${company.careers_url})`);

    try {
      const jobs = await scrapeCompanyCareers(company.careers_url);
      console.log(`  Found ${jobs.length} jobs`);

      // Get existing seen_jobs for this company
      const { data: existingJobs } = await supabase
        .from("seen_jobs")
        .select("id, job_url_path, job_title, job_location")
        .eq("company_id", company.id);

      if (!existingJobs) {
        console.log("  No existing jobs in DB, skipping.");
        continue;
      }

      // Build a map of scraped jobs by URL path
      const scrapedMap = new Map(jobs.map((j) => [j.urlPath, j]));

      let updated = 0;
      for (const existing of existingJobs) {
        const scraped = scrapedMap.get(existing.job_url_path);
        if (!scraped) continue;

        // Update title and location if they differ
        const needsUpdate =
          existing.job_title !== scraped.title ||
          existing.job_location !== scraped.location;

        if (needsUpdate) {
          const { error: updateError } = await supabase
            .from("seen_jobs")
            .update({
              job_title: scraped.title,
              job_location: scraped.location || null,
            })
            .eq("id", existing.id);

          if (updateError) {
            console.error(`  Failed to update job ${existing.id}:`, updateError);
          } else {
            updated++;
            console.log(`  Updated: "${scraped.title}" | "${scraped.location}"`);
          }
        }
      }

      console.log(`  ${updated} jobs updated for ${company.name}`);
    } catch (err) {
      console.error(`  Error scraping ${company.name}:`, err);
    }

    await delay(5000);
  }

  console.log("\nBackfill complete.");
}

backfillLocations().then(() => process.exit(0));
