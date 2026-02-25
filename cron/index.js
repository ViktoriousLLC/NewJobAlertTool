const BACKEND_URL = process.env.BACKEND_URL;
const CRON_SECRET = process.env.CRON_SECRET;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 15000; // 15 seconds between retries

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function triggerDailyCheck() {
  console.log("Triggering daily job check...");

  if (!CRON_SECRET) {
    console.error("ERROR: CRON_SECRET environment variable not set");
    process.exit(1);
  }

  if (!BACKEND_URL) {
    console.error("ERROR: BACKEND_URL environment variable not set");
    process.exit(1);
  }

  const url = `${BACKEND_URL}/api/cron/trigger`;
  console.log(`Target: ${url}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${MAX_RETRIES}...`);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(300000), // 5 min timeout (scrape takes a while)
      });
      const data = await response.json();

      if (response.ok) {
        console.log("Success:", data.message);
        process.exit(0);
      } else {
        console.error("Failed:", data.error || response.statusText);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt < MAX_RETRIES) {
        console.log(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error("All retries exhausted. Giving up.");
        process.exit(1);
      }
    }
  }
}

triggerDailyCheck();
