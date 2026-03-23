// US states and common US location patterns
const US_PATTERNS = [
  /\bCA\b/i, /\bNY\b/i, /\bWA\b/i, /\bTX\b/i, /\bIL\b/i, /\bMA\b/i, /\bCO\b/i, /\bGA\b/i, /\bPA\b/i, /\bAZ\b/i,
  /California/i, /New York/i, /Washington/i, /Texas/i, /Illinois/i, /Massachusetts/i,
  /Colorado/i, /Georgia/i, /Pennsylvania/i, /Arizona/i, /Oregon/i, /Virginia/i,
  /San Francisco/i, /Seattle/i, /Austin/i, /Chicago/i, /Boston/i, /Los Angeles/i,
  /New York City/i, /NYC/i, /Sunnyvale/i, /San Mateo/i, /Palo Alto/i, /Mountain View/i,
  /United States/i, /USA/i, /\bUS\b/, /Remote/i,
];

export function isUSLocation(location: string | null): boolean {
  if (!location || !location.trim()) return true; // Show jobs with unknown location

  // Check for standardized "City, Region, CountryCode" format (Eightfold, etc.)
  // US locations end with ", US"; any other 2-letter code is non-US.
  const segments = location.split("|");
  for (const seg of segments) {
    const parts = seg.split(",").map((p) => p.trim());
    if (parts.length >= 3) {
      const lastPart = parts[parts.length - 1];
      if (/^[A-Z]{2}$/.test(lastPart) && lastPart !== "US") {
        return false;
      }
    }
  }

  return US_PATTERNS.some((pattern) => pattern.test(location));
}

export type JobLevel = "early" | "mid" | "director";

export const LEVEL_LABELS: Record<JobLevel, string> = {
  early: "Early",
  mid: "Mid",
  director: "Dir+",
};

export const LEVEL_COLORS: Record<JobLevel, { bg: string; text: string }> = {
  early: { bg: "rgb(219 234 254)", text: "rgb(29 78 216)" },    // blue-100/700
  mid: { bg: "rgb(254 243 199)", text: "rgb(180 83 9)" },       // amber-100/700
  director: { bg: "rgb(237 233 254)", text: "rgb(109 40 217)" }, // violet-100/700
};

export const ALL_LEVELS: JobLevel[] = ["early", "mid", "director"];
