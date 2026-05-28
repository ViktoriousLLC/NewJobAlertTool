import { Router, Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { ADMIN_EMAIL } from "../lib/constants";
import { INTERVIEW_PROMPTS, type InterviewType } from "../lib/interviewPrompts";
import { VIK_VOICE_EVAL_SYSTEM_PROMPT } from "../lib/vikVoiceEvalPrompt";

const router = Router();

// Test page is admin-only. ElevenLabs minutes are real money; gate hard.
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.userEmail !== ADMIN_EMAIL) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  next();
}

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

router.use(requireAdmin);

// Diagnostics handler is exported separately so it can be mounted in index.ts
// BEFORE the auth chain. Returns booleans only; never values.
export function interviewsDiagnosticsHandler(_req: Request, res: Response): void {
  res.json({
    elevenlabs_api_key: !!ELEVENLABS_API_KEY,
    elevenlabs_agent_id: !!ELEVENLABS_AGENT_ID,
    anthropic_api_key: !!ANTHROPIC_API_KEY,
    gemini_api_key: !!GEMINI_API_KEY,
    openai_api_key: !!OPENAI_API_KEY,
    openai_model: OPENAI_MODEL,
    ready: !!(ELEVENLABS_API_KEY && ELEVENLABS_AGENT_ID && (ANTHROPIC_API_KEY || GEMINI_API_KEY || OPENAI_API_KEY)),
  });
}

function isValidInterviewType(t: string): t is InterviewType {
  return t === "behavioral" || t === "product_sense" || t === "analytics";
}

// POST /api/interviews/token — mints an ElevenLabs signed URL for the agent
// with system prompt + first message overridden based on interview type.
// The signed URL is short-lived (~15 min); the browser uses it to connect
// directly to ElevenLabs over WebSocket.
router.post("/token", async (req: Request, res: Response) => {
  try {
    if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
      res.status(503).json({
        error:
          "ElevenLabs not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in Railway env.",
      });
      return;
    }

    const { interview_type } = req.body as { interview_type?: string };
    if (!interview_type || !isValidInterviewType(interview_type)) {
      res.status(400).json({ error: "interview_type must be behavioral, product_sense, or analytics" });
      return;
    }

    const prompt = INTERVIEW_PROMPTS[interview_type];

    // Mint a signed URL from ElevenLabs. Their endpoint:
    // GET /v1/convai/conversation/get-signed-url?agent_id=...
    // Auth via xi-api-key header.
    const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(
      ELEVENLABS_AGENT_ID
    )}`;
    const elResp = await fetch(url, {
      method: "GET",
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
    });

    if (!elResp.ok) {
      const detail = await elResp.text().catch(() => "");
      Sentry.captureMessage(`ElevenLabs signed-url mint failed: ${elResp.status} ${detail}`);
      res.status(502).json({ error: "Failed to mint ElevenLabs signed URL", status: elResp.status });
      return;
    }

    const data = (await elResp.json()) as { signed_url?: string };
    if (!data.signed_url) {
      res.status(502).json({ error: "ElevenLabs response missing signed_url" });
      return;
    }

    // Return the signed URL + the prompt overrides; the browser sends the
    // overrides to ElevenLabs in the first "conversation_initiation_client_data"
    // WebSocket frame. (Per ElevenLabs Agents API: overrides go from the client,
    // not the URL minter, so the agent can be reused across interview types.)
    // SDK expects camelCase `firstMessage`; snake_case is silently dropped.
    res.json({
      signed_url: data.signed_url,
      overrides: {
        agent: {
          prompt: { prompt: prompt.systemPrompt },
          firstMessage: prompt.firstMessage,
        },
      },
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/interviews/token error:", err);
    res.status(500).json({ error: "Failed to mint token" });
  }
});

async function evaluateWithClaude(userMsg: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const completion = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: VIK_VOICE_EVAL_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });
  const textBlock = completion.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}

async function evaluateWithGemini(userMsg: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    config: {
      systemInstruction: VIK_VOICE_EVAL_SYSTEM_PROMPT,
      maxOutputTokens: 1500,
    },
  });
  return response.text || "";
}

async function evaluateWithOpenAI(userMsg: string): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 1500,
    messages: [
      { role: "system", content: VIK_VOICE_EVAL_SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
  });
  return response.choices[0]?.message?.content || "";
}

// POST /api/interviews/evaluate — runs BOTH Claude and Gemini in parallel
// over the same transcript for side-by-side A/B comparison.
// Body: { interview_type, transcript: [{role, text}], duration_sec }
router.post("/evaluate", async (req: Request, res: Response) => {
  try {
    if (!ANTHROPIC_API_KEY && !GEMINI_API_KEY && !OPENAI_API_KEY) {
      res.status(503).json({
        error:
          "No LLM configured. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY in Railway env.",
      });
      return;
    }

    const { interview_type, transcript, duration_sec } = req.body as {
      interview_type?: string;
      transcript?: { role: string; text: string }[];
      duration_sec?: number;
    };

    if (!interview_type || !isValidInterviewType(interview_type)) {
      res.status(400).json({ error: "Invalid interview_type" });
      return;
    }
    if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
      res.status(400).json({ error: "transcript must be a non-empty array" });
      return;
    }

    const prompt = INTERVIEW_PROMPTS[interview_type];

    const rendered = transcript
      .map((t) => `${t.role === "agent" ? "Interviewer" : "Candidate"}: ${t.text}`)
      .join("\n\n");

    const userMsg = `Interview type: ${interview_type.replace("_", " ")}
Duration: ~${Math.round((duration_sec || 0) / 60)} minutes
Rubric: ${prompt.evaluationRubric}

Transcript:

${rendered}

Write the evaluation now.`;

    // Run all three models in parallel. If one key is missing, skip that
    // model gracefully; we still surface whichever worked.
    const [claudeResult, geminiResult, openaiResult] = await Promise.allSettled([
      ANTHROPIC_API_KEY ? evaluateWithClaude(userMsg) : Promise.reject(new Error("no key")),
      GEMINI_API_KEY ? evaluateWithGemini(userMsg) : Promise.reject(new Error("no key")),
      OPENAI_API_KEY ? evaluateWithOpenAI(userMsg) : Promise.reject(new Error("no key")),
    ]);

    const claude =
      claudeResult.status === "fulfilled"
        ? { ok: true as const, text: claudeResult.value, model: "claude-sonnet-4-6" }
        : { ok: false as const, error: String((claudeResult.reason as Error)?.message || claudeResult.reason) };

    const gemini =
      geminiResult.status === "fulfilled"
        ? { ok: true as const, text: geminiResult.value, model: GEMINI_MODEL }
        : { ok: false as const, error: String((geminiResult.reason as Error)?.message || geminiResult.reason) };

    const openai =
      openaiResult.status === "fulfilled"
        ? { ok: true as const, text: openaiResult.value, model: OPENAI_MODEL }
        : { ok: false as const, error: String((openaiResult.reason as Error)?.message || openaiResult.reason) };

    // If all failed, log + 502. Otherwise 200 with whichever panels worked.
    if (!claude.ok && !gemini.ok && !openai.ok) {
      Sentry.captureMessage(
        `All evaluators failed. Claude: ${claude.error}; Gemini: ${gemini.error}; OpenAI: ${openai.error}`
      );
      res.status(502).json({ error: "All LLMs failed", claude, gemini, openai });
      return;
    }

    res.json({ claude, gemini, openai });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/interviews/evaluate error:", err);
    res.status(500).json({ error: "Failed to evaluate interview" });
  }
});

export default router;
