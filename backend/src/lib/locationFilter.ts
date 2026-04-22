// US states, cities, and location patterns — ported from frontend/src/lib/jobFilters.ts
const US_PATTERNS = [
  /\bCA\b/i, /\bNY\b/i, /\bWA\b/i, /\bTX\b/i, /\bIL\b/i, /\bMA\b/i, /\bCO\b/i, /\bGA\b/i, /\bPA\b/i, /\bAZ\b/i,
  /\bOR\b/, /\bVA\b/i, /\bMD\b/i, /\bNC\b/i, /\bNJ\b/i, /\bOH\b/i, /\bMN\b/i, /\bMI\b/i, /\bFL\b/i, /\bUT\b/i,
  /\bCT\b/i, /\bMO\b/i, /\bTN\b/i, /\bWI\b/i, /\bIN\b/i, /\bDC\b/i,
  /California/i, /New York/i, /Washington/i, /Texas/i, /Illinois/i, /Massachusetts/i,
  /Colorado/i, /Georgia/i, /Pennsylvania/i, /Arizona/i, /Oregon/i, /Virginia/i,
  /Maryland/i, /North Carolina/i, /New Jersey/i, /Ohio/i, /Minnesota/i, /Michigan/i,
  /Florida/i, /Utah/i, /Connecticut/i, /Missouri/i, /Tennessee/i, /Wisconsin/i, /Indiana/i,
  /San Francisco/i, /Seattle/i, /Austin/i, /Chicago/i, /Boston/i, /Los Angeles/i,
  /New York City/i, /NYC/i, /Sunnyvale/i, /San Mateo/i, /Palo Alto/i, /Mountain View/i,
  /San Jose/i, /Menlo Park/i, /Cupertino/i, /Redmond/i, /Bellevue/i, /Kirkland/i,
  /Portland/i, /Denver/i, /Atlanta/i, /Miami/i, /Dallas/i, /Houston/i, /Phoenix/i,
  /San Diego/i, /Pittsburgh/i, /Raleigh/i, /Durham/i, /Nashville/i, /Minneapolis/i,
  /United States/i, /USA/i, /\bUS\b/, /Remote/i,
];

// Non-US location patterns — if ANY match, the job is definitely not US
const NON_US_PATTERNS = [
  /\bIndia\b/i, /\bBangalore\b/i, /\bBengaluru\b/i, /\bHyderabad\b/i, /\bMumbai\b/i, /\bDelhi\b/i, /\bPune\b/i, /\bGurgaon\b/i, /\bGurugram\b/i, /\bNoida\b/i, /\bChennai\b/i, /\bKolkata\b/i, /\bKarnataka\b/i, /\bTelangana\b/i,
  /\bUnited Kingdom\b/i, /\bUK\b/, /\bLondon\b/i, /\bManchester\b/i, /\bEdinburgh\b/i,
  /\bGermany\b/i, /\bBerlin\b/i, /\bMunich\b/i, /\bFrankfurt\b/i,
  /\bFrance\b/i, /\bParis\b/i,
  /\bCanada\b/i, /\bToronto\b/i, /\bVancouver\b/i, /\bMontreal\b/i,
  /\bAustralia\b/i, /\bSydney\b/i, /\bMelbourne\b/i,
  /\bSingapore\b/i,
  /\bJapan\b/i, /\bTokyo\b/i,
  /\bChina\b/i, /\bBeijing\b/i, /\bShanghai\b/i, /\bShenzhen\b/i,
  /\bIreland\b/i, /\bDublin\b/i,
  /\bNetherlands\b/i, /\bAmsterdam\b/i,
  /\bIsrael\b/i, /\bTel Aviv\b/i,
  /\bBrazil\b/i, /\bSão Paulo\b/i,
  /\bMexico\b/i, /\bMexico City\b/i,
  /\bSweden\b/i, /\bStockholm\b/i,
  /\bSwitzerland\b/i, /\bZurich\b/i,
  /\bSpain\b/i, /\bMadrid\b/i, /\bBarcelona\b/i,
  /\bItaly\b/i, /\bMilan\b/i,
  /\bPoland\b/i, /\bWarsaw\b/i, /\bKrakow\b/i,
  /\bSouth Korea\b/i, /\bSeoul\b/i,
  /\bTaiwan\b/i, /\bTaipei\b/i,
  /\bPhilippines\b/i, /\bManila\b/i,
  /\bVietnam\b/i, /\bHo Chi Minh\b/i,
  /\bThailand\b/i, /\bBangkok\b/i,
  /\bMalaysia\b/i, /\bKuala Lumpur\b/i,
  /\bIndonesia\b/i, /\bJakarta\b/i,
  /\bNigeria\b/i, /\bLagos\b/i,
  /\bKenya\b/i, /\bNairobi\b/i,
  /\bEMEA\b/i, /\bAPAC\b/i, /\bLATAM\b/i,
];

export function isUSLocation(location: string | null): boolean {
  if (!location || !location.trim()) return false; // Unknown/empty location — exclude by default (safer)

  // Check for standardized "City, Region, CountryCode" format (Eightfold, etc.)
  // US locations end with ", US"; any other 2-letter code is non-US.
  // Split on pipe for multi-location strings (e.g., "Bengaluru, KA, IN | Hyderabad, TS, IN")
  const segments = location.split("|");
  for (const seg of segments) {
    const parts = seg.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1];
      // "City, State, US" (3 parts) or "State,US" / "Province,CA" (2 parts)
      // If the last part is a 2-letter country code that isn't US, reject
      if (/^[A-Z]{2}$/.test(lastPart) && lastPart !== "US") {
        return false;
      }
    }
  }

  // Second check: if it explicitly matches a non-US pattern, reject it
  // e.g., "Bangalore, India" or "Remote - London" → non-US
  if (NON_US_PATTERNS.some((pattern) => pattern.test(location))) {
    return false;
  }

  // Third check: matches a known US pattern
  // e.g., "San Francisco, CA" or "Remote" or "United States"
  if (US_PATTERNS.some((pattern) => pattern.test(location))) {
    return true;
  }

  // No match either way — exclude by default (safer than including unknown international locations)
  return false;
}
