const BACKEND_URL = process.env.BACKEND_URL;
const CRON_SECRET = process.env.CRON_SECRET;

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

  try {
    const url = `${BACKEND_URL}/api/cron/trigger`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const data = await response.json();

    if (response.ok) {
      console.log("Success:", data.message);
    } else {
      console.error("Failed:", data.error || response.statusText);
      process.exit(1);
    }
  } catch (error) {
    console.error("Error triggering daily check:", error.message);
    process.exit(1);
  }
}

triggerDailyCheck();
