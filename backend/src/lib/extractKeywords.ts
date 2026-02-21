/**
 * Extract meaningful job-title keywords from free-form user feedback.
 *
 * Examples:
 *   "the role is called partner growth"      → ["partner growth"]
 *   "hey it's business development and strategy" → ["business development", "strategy"]
 *   "look for partner growth or biz dev"     → ["partner growth", "biz dev"]
 *   "partner growth, strategy ops"           → ["partner growth", "strategy ops"]
 *   "They call it Growth PM not Product Manager" → ["growth pm", "product manager"]
 */

const STOP_WORDS = new Set([
  // articles / pronouns / prepositions
  "a", "an", "the", "i", "me", "my", "we", "you", "your", "it", "its",
  "this", "that", "these", "those", "he", "she", "they", "them",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "up",
  "as", "into", "about", "out", "off", "over",
  // verbs / auxiliaries
  "is", "are", "was", "were", "be", "been", "being", "am",
  "has", "have", "had", "do", "does", "did", "will", "would",
  "shall", "should", "can", "could", "may", "might", "must",
  // common fillers in feedback
  "hey", "hi", "hello", "please", "thanks", "thank",
  "yeah", "yes", "no", "ok", "okay", "so", "well", "just",
  "actually", "really", "very", "also", "too", "here", "there",
  // verbs people use when describing roles
  "called", "named", "titled", "listed", "find", "found",
  "look", "looking", "search", "searching", "try", "check",
  "see", "want", "need", "think", "know", "like",
  "include", "including", "add", "adding", "give", "show", "get",
  "error", "wrong", "broken", "fail", "failed", "again", "still",
  "same", "keep", "keeps", "getting", "got", "why",
  // meta words about the tool
  "role", "roles", "job", "jobs", "title", "titles", "position", "positions",
  "company", "page", "website", "site", "listing", "listings",
  // conjunctions / negation context
  "but", "not", "instead", "rather", "than", "versus", "vs",
  "however", "though", "because", "since", "if", "when",
]);

// Phrases that bridge into the actual keyword (strip entirely)
const FILLER_PHRASES = [
  /\b(?:the|a)\s+role\s+is\s+(?:called|named|titled)?\s*/gi,
  /\b(?:it'?s|its)\s+(?:called|named|titled)\s*/gi,
  /\bjob\s+title\s+is\s*/gi,
  /\bthey\s+call\s+it\s*/gi,
  /\blook(?:ing)?\s+for\s*/gi,
  /\bsearch(?:ing)?\s+for\s*/gi,
  /\bi\s+(?:want|need)\s+(?:to\s+(?:find|see|add))?\s*/gi,
  /\bshould\s+(?:be|include)\s*/gi,
  /\bcan\s+you\s+(?:also\s+)?(?:find|look|search|add|include)\s*/gi,
  /\bplease\s+(?:also\s+)?(?:find|look|search|add|include)\s*/gi,
];

// Delimiters that separate distinct keyword phrases
const DELIMITER = /[,;\n]|\band\b|\bor\b|\bnot\b|\bversus\b|\bvs\.?\b|\balso\b|\binstead\s+of\b|\brather\s+than\b|\b\+\b/i;

export function extractKeywordsFromFeedback(text: string): string[] {
  if (!text || !text.trim()) return [];

  let cleaned = text.toLowerCase().trim();

  // Strip filler phrases first (they bridge into keywords)
  for (const re of FILLER_PHRASES) {
    cleaned = cleaned.replace(re, " , ");
  }

  // Split by delimiters into candidate chunks
  const chunks = cleaned.split(DELIMITER);

  const keywords: string[] = [];

  for (const chunk of chunks) {
    // Remove punctuation (keep letters, numbers, spaces, hyphens, apostrophes)
    let phrase = chunk.replace(/[^a-z0-9\s'-]/g, " ").trim();

    // Remove leading/trailing stop words iteratively
    let words = phrase.split(/\s+/).filter(Boolean);
    while (words.length > 0 && STOP_WORDS.has(words[0])) words.shift();
    while (words.length > 0 && STOP_WORDS.has(words[words.length - 1])) words.pop();

    // Remove interior stop words only if they're standalone (keep "of" in "head of product")
    // But strip isolated single stop words from middle of phrases > 3 words
    if (words.length > 3) {
      words = words.filter(
        (w, i) => i === 0 || i === words.length - 1 || !STOP_WORDS.has(w) || w === "of"
      );
    }

    phrase = words.join(" ");

    // Keep if at least 3 characters and at least one word remains
    if (phrase.length >= 3 && words.length > 0) {
      keywords.push(phrase);
    }
  }

  // Deduplicate
  return [...new Set(keywords)];
}
