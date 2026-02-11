/**
 * Classify a job title into a seniority tier.
 * Priority: director+ checked first (so "Senior Director" → director), then mid, then early (fallback).
 */

const DIRECTOR_PATTERNS = [
  /\bdirector\b/i,
  /\bvp\b/i,
  /\bvice president\b/i,
  /\bhead of product\b/i,
  /\bchief product\b/i,
  /\bcpo\b/i,
];

const MID_PATTERNS = [
  /\bsenior\b/i,
  /\bsr\.\s/i,
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\blead\b/i,
  /\bgroup product manager\b/i,
  /\bproduct manager\s+ii+\b/i, // PM II, III, IV, etc.
];

export type JobLevel = "early" | "mid" | "director";

export function classifyJobLevel(title: string): JobLevel {
  // Director+ checked first — "Senior Director" should be director, not mid
  if (DIRECTOR_PATTERNS.some((p) => p.test(title))) return "director";
  if (MID_PATTERNS.some((p) => p.test(title))) return "mid";
  return "early";
}
