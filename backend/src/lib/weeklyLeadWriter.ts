// Writes the rotating "My take this week: ..." lead (and the alternates) for the
// weekly LinkedIn digest, in Vik's voice.
//
// Design (settled with Vik over 2026-05-29/30):
// - CODE computes the factual candidate "angles" (this-week snapshots only, so
//   no onboarding-contaminated trend claims) and CODE picks which is the lead
//   (priority + freshness). This module's only job is to PHRASE each angle in
//   Vik's voice. Selection stays deterministic; phrasing is the LLM's job.
// - The model gets Vik's REAL voice guide + calibration samples VERBATIM (bundled
//   in vikVoiceFull.ts). Reading the file, not a paraphrase, is the whole point:
//   a paraphrase produced "AI slop" that Vik rejected repeatedly.
// - Opus by default (Vik's pick; ~14 cents/send). Single call + strong rules;
//   Vik is the human gate before anything is posted. A separate critic pass is a
//   possible future enhancement (the proof run used one) but is omitted in v1 to
//   keep cost/latency/failure-surface down.
// - Fails SOFT: no key, parse failure, or API error -> deterministic fallback
//   hooks, so the email always renders.

import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/node";
import { VIK_VOICE_STYLE_GUIDE, VIK_CALIBRATION_SAMPLES } from "./vikVoiceFull";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Deliberately NOT the shared ANTHROPIC_MODEL (interviews default that to Sonnet).
// Vik chose Opus for the weekly post; override with WEEKLY_DIGEST_MODEL on Railway.
const WEEKLY_DIGEST_MODEL = process.env.WEEKLY_DIGEST_MODEL || "claude-opus-4-8";

export interface LeadCandidate {
  key: string; // angle key, e.g. "top_company"
  fact: string; // the raw TRUE fact; the model phrases from this and nothing else
  fallbackHook: string; // blunt hook used when the LLM is unavailable
  fallbackSupport: string; // support sentence used when the LLM is unavailable
  imageSubline: string; // short stat baked into the banner image
}

export interface PhrasedLead {
  key: string;
  hook: string;
  support: string;
  imageSubline: string;
}

export interface LeadWriterResult {
  leads: PhrasedLead[]; // same order as the input candidates
  model: string | null; // null => deterministic fallback was used
  usage: { input: number; output: number } | null;
}

const SYSTEM_RULES = `You write the lead line of a weekly LinkedIn post by Vik Agarwal about the product-manager job market. Below is Vik's REAL voice style guide and his REAL past posts. Match them exactly. This is his personal brand, so generic "LinkedIn voice" is unacceptable.

=== VIK VOICE STYLE GUIDE ===
${VIK_VOICE_STYLE_GUIDE}

=== VIK CALIBRATION SAMPLES (his real posts) ===
${VIK_CALIBRATION_SAMPLES}

=== YOUR TASK ===
You are given a list of factual "angles" about this week's PM job postings. For EACH angle, write two fields:
- "hook": a BLUNT, plain, confident one-line claim in Vik's voice, in the exact register of his real line "Banking is on a tear." Roughly 3 to 8 words. It is NOT an essay, NOT a "this is not X, it's Y" reframe, NOT a mic-drop, NOT a question. Just state the thing plainly.
- "support": ONE short, plain sentence backing the hook with the number from the fact. No hype.

HARD RULES:
- Use ONLY the facts given. Never invent a number, company, or claim that is not in the fact.
- NO em dashes and NO en dashes anywhere. Use commas, colons, periods (Vik actively fights this).
- Always uppercase AI, ML, LLM, GPT, GenAI.
- Obey the style guide's Anti-Slop list exactly: no banned words (delve, leverage, robust, landscape, unlock, seamless, resonate, impactful, actionable, elevate, etc.), no banned templates, no motivational-poster lines ("this is your moment"), no thought-leader grandiosity, no "isn't even close" taunts.
- Plain and human, like a sharp friend a few years ahead of you, never a LinkedIn influencer. When in doubt, plainer.

Return ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{"leads":[{"key":"<the angle key>","hook":"<blunt hook>","support":"<one sentence>"}]}
Include every angle from the input, keyed by its "key", in the same order.`;

function sanitize(s?: string): string {
  if (!s) return "";
  // Backstop the "no em/en dash" rule even if the model slips.
  return s
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLeads(raw: string): { key: string; hook?: string; support?: string }[] | null {
  if (!raw) return null;
  // Tolerate accidental ```json fences or leading prose.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(body.slice(start, end + 1));
    if (!obj || !Array.isArray(obj.leads)) return null;
    return obj.leads.filter((l: unknown): l is { key: string } => !!l && typeof (l as { key?: unknown }).key === "string");
  } catch {
    return null;
  }
}

export async function writeLeads(candidates: LeadCandidate[]): Promise<LeadWriterResult> {
  const fallback = (): LeadWriterResult => ({
    leads: candidates.map((c) => ({
      key: c.key,
      hook: c.fallbackHook,
      support: c.fallbackSupport,
      imageSubline: c.imageSubline,
    })),
    model: null,
    usage: null,
  });

  if (!ANTHROPIC_API_KEY || candidates.length === 0) return fallback();

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const userMsg = JSON.stringify({
      angles: candidates.map((c) => ({ key: c.key, fact: c.fact })),
    });
    const completion = await anthropic.messages.create({
      model: WEEKLY_DIGEST_MODEL,
      max_tokens: 1200,
      // Cache the big static voice prefix (claude-api best practice). The dynamic
      // angles live in the user message so the prefix stays cache-stable.
      system: [{ type: "text", text: SYSTEM_RULES, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
    });
    const textBlock = completion.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = parseLeads(raw);
    if (!parsed) return fallback();

    const byKey = new Map(parsed.map((p) => [p.key, p]));
    const leads: PhrasedLead[] = candidates.map((c) => {
      const p = byKey.get(c.key);
      return {
        key: c.key,
        hook: sanitize(p?.hook) || c.fallbackHook,
        support: sanitize(p?.support) || c.fallbackSupport,
        imageSubline: c.imageSubline,
      };
    });
    return {
      leads,
      model: WEEKLY_DIGEST_MODEL,
      usage: { input: completion.usage.input_tokens, output: completion.usage.output_tokens },
    };
  } catch (err) {
    Sentry.captureException(err);
    console.error("weeklyLeadWriter failed, using deterministic fallback:", err);
    return fallback();
  }
}
