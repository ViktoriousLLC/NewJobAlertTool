// Weekly "Hot Take" banner: builds the nano banana (Gemini 2.5 Flash Image)
// prompt and, when the API is reachable, generates the image to attach to the
// digest email.
//
// Concept (settled with Vik 2026-05-30): the recognizable part is a FIXED text
// lockup; the art STYLE rotates each week so the series stays fresh. The email
// ALWAYS includes the text prompt (so Vik can regenerate free via his consumer
// nano banana plan) and attaches an API-generated image as a bonus when it works
// -- his Gemini project has hit "prepayment credits depleted" before and the
// image model has no free tier, so generation failing is expected sometimes and
// must never break the digest.

import { GoogleGenAI } from "@google/genai";
import * as Sentry from "@sentry/node";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

// Rotation pool Vik approved (cinematic photo was dropped). Minimalist is the
// default/favorite. Order matters only as a stable rotation sequence.
export const ART_STYLE_KEYS = [
  "minimalist",
  "bold_typographic",
  "retro_print",
  "bold_gradient",
  "movie_poster",
  "comic",
] as const;
export type ArtStyleKey = (typeof ART_STYLE_KEYS)[number];

const ART_STYLES: Record<ArtStyleKey, string> = {
  minimalist:
    "ART STYLE: clean minimalist flat-vector editorial illustration, premium tech-blog header energy (Stripe / a16z). Warm off-white background (#F7F5F0), one accent color used sparingly, confident amber-orange (#F2820C); neutrals only otherwise (deep charcoal #1A1A1A text, muted warm gray #9A958C). At least 60% calm empty background. Two-zone split: text lockup left-aligned in the left ~58%; in the right ~42%, one elegant flat-vector motif of an ascending bar chart whose bars become upward arrows in thin charcoal strokes with exactly one bar filled solid amber-orange. Soft even lighting.",
  bold_typographic:
    "ART STYLE: type-forward Swiss/International design where the typography IS the artwork, no scene or characters. Deep ink-navy background (#0E1726), bright off-white type (#F5F7FA), one accent amber-orange (#FF8A1E) used sparingly, a thin 1px amber hairline rule as a divider. Strict grid, generous negative space, oversized confident type, Helvetica-grade precision. Flat color, no gradients, no textures, no drop shadows.",
  retro_print:
    "ART STYLE: mid-century vintage screen-print / WPA travel-poster look. Limited four-color palette only: warm cream paper (#F2E6CE), deep teal (#155E63), burnt orange (#D9622B), ink navy (#1A2238). Flat textured shapes with visible screen-print grain and slight ink misregistration, gentle halftone/stipple texture. Bold diagonal sunburst rays from the upper-right and a stylized rising-arrow abstract skyline along the lower third. A thin double keyline border inset from the edges. Flat graphic lighting, no photorealism.",
  bold_gradient:
    "ART STYLE: bold modern gradient (Spotify-Wrapped energy), vibrant and scroll-stopping, no people or photos. A rich smooth diagonal gradient from deep purple (#3B1E63) into hot magenta-pink (#E0307E) into warm orange (#FF8A1E), soft grain/noise texture, a couple of large soft-blurred glowing orbs for depth, and oversized semi-transparent abstract shapes (a circle and an upward arrow) in the right portion as background texture. High-contrast white type; the accent word can pop in a bright lime-yellow.",
  movie_poster:
    "ART STYLE: dramatic cinematic movie-poster one-sheet, epic and high-contrast. A lone professional silhouette at a minimalist desk in the lower-right third, small against a vast abstract atrium of glass and steel with sweeping light beams through atmospheric haze. Chiaroscuro lighting, teal-and-amber cinematic grade, inky navy-black shadows, a warm-gold horizon glow, subtle god-rays, faint film grain. Silhouette only, no identifiable face. Keep the left and lower-left as darker negative space for text.",
  comic:
    "ART STYLE: modern graphic-novel / comic-book panel, stylish not childish. Bold black ink linework, halftone Ben-Day dot shading, dynamic diagonal speed lines, high-contrast palette of electric cobalt blue, crimson red, goldenrod yellow on crisp off-white paper with deep ink-black shadows. A thin black inked panel border framing the image. On the right two-thirds, an abstract stylized comic depiction of a busy job market: angular skyline silhouettes and bold inked upward-trending arrows with halftone fill. The kicker can sit in a tilted yellow caption box.",
};

// Deterministic rotation: avoid repeating last week's style; default minimalist.
export function pickArtStyle(recentStyle?: string | null): ArtStyleKey {
  if (!recentStyle) return "minimalist";
  const idx = ART_STYLE_KEYS.indexOf(recentStyle as ArtStyleKey);
  if (idx === -1) return "minimalist";
  return ART_STYLE_KEYS[(idx + 1) % ART_STYLE_KEYS.length];
}

export interface ImagePromptInput {
  dateLabel: string; // e.g. "MAY 29"
  hook: string; // the chosen "My take" hook, e.g. "Amazon is hiring PMs like crazy."
  subline: string; // short stat, e.g. "35 new PM roles this week."
  style: ArtStyleKey;
}

export function buildImagePrompt({ dateLabel, hook, subline, style }: ImagePromptInput): string {
  const upperDate = dateLabel.toUpperCase();
  return `Create a LinkedIn banner image, exactly 1200 x 627 pixels, landscape.

${ART_STYLES[style]}

The image MUST contain this EXACT text lockup, spelled exactly, left-aligned, with a clear hierarchy, and NOTHING else:
1. A small bold uppercase kicker: "HOT TAKE · ${upperDate}"
2. The headline (the dominant element, up to two lines): "${hook}"
3. A smaller support line: "${subline}"
4. A small brand line: "NewPMjobs.com"

CRITICAL: render "NewPMjobs.com" as plain text with NO angle brackets, no < >, no parentheses, and no other characters around it. Do NOT add any byline, any person's name, "By ...", the words "New PM Jobs", a tagline, a logo, or ANY text beyond those four lines. No real company logos, no brand marks, no photographs of real identifiable people, no cartoon mascots, no clip-art. Render every word accurately, correctly spelled, and legible at small sizes.`;
}

export interface GeneratedImage {
  base64: string; // raw base64, no data: prefix
  mimeType: string;
}

export async function generateDigestImage(prompt: string): Promise<GeneratedImage | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: GEMINI_IMAGE_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      const inline = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
      if (inline?.data) {
        return { base64: inline.data, mimeType: inline.mimeType || "image/png" };
      }
    }
    return null;
  } catch (err) {
    // Expected to fail sometimes (depleted credits, no free tier, 429). The email
    // falls back to the text prompt -- Vik regenerates via his consumer plan.
    Sentry.captureException(err);
    console.error("Gemini digest image generation failed (text-prompt fallback in email):", err);
    return null;
  }
}
