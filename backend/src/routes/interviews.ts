import { Router, Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { ADMIN_EMAIL } from "../lib/constants";
import { supabase } from "../lib/supabase";
import { INTERVIEW_PROMPTS, type InterviewType } from "../lib/interviewPrompts";
import { VIK_VOICE_EVAL_SYSTEM_PROMPT } from "../lib/vikVoiceEvalPrompt";
import { INTERVIEW_SUMMARY_SYSTEM_PROMPT } from "../lib/interviewSummaryPrompt";

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
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Default to flash because Pro requires a topped-up billing balance (Vik's
// project hit "prepayment credits depleted" 429 on Pro). Flash has a real
// 250 req/day free tier. Set GEMINI_MODEL=gemini-2.5-pro on Railway to
// upgrade once credits are loaded.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

router.use(requireAdmin);

// POST /api/interviews/test-evaluators — fires a tiny "respond with OK" prompt
// to each LLM. Returns success/fail per model so Vik can verify keys + quota
// without burning a full interview session.
router.post("/test-evaluators", async (_req: Request, res: Response) => {
  const testPrompt = "Respond with exactly one word: OK";

  const [claudeResult, geminiResult, openaiResult] = await Promise.allSettled([
    ANTHROPIC_API_KEY
      ? (async () => {
          const a = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
          const r = await a.messages.create({
            model: ANTHROPIC_MODEL,
            max_tokens: 10,
            messages: [{ role: "user", content: testPrompt }],
          });
          const b = r.content.find((x) => x.type === "text");
          return b && b.type === "text" ? b.text.trim() : "";
        })()
      : Promise.reject(new Error("no key")),
    GEMINI_API_KEY
      ? (async () => {
          const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
          const r = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: [{ role: "user", parts: [{ text: testPrompt }] }],
            config: { maxOutputTokens: 10 },
          });
          return (r.text || "").trim();
        })()
      : Promise.reject(new Error("no key")),
    OPENAI_API_KEY
      ? (async () => {
          const c = new OpenAI({ apiKey: OPENAI_API_KEY });
          const r = await c.chat.completions.create({
            model: OPENAI_MODEL,
            max_tokens: 10,
            messages: [{ role: "user", content: testPrompt }],
          });
          return (r.choices[0]?.message?.content || "").trim();
        })()
      : Promise.reject(new Error("no key")),
  ]);

  const fmt = (r: PromiseSettledResult<string>, model: string) =>
    r.status === "fulfilled"
      ? { ok: true as const, model, response: r.value }
      : { ok: false as const, model, error: String((r.reason as Error)?.message || r.reason) };

  res.json({
    claude: fmt(claudeResult, ANTHROPIC_MODEL),
    gemini: fmt(geminiResult, GEMINI_MODEL),
    openai: fmt(openaiResult, OPENAI_MODEL),
  });
});

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

    // Fetch this user's rolling profile summary (if any) and append to the
    // system prompt so the agent can adapt to past sessions.
    let userMemory = "";
    if (req.userId) {
      const { data: summaryRow, error: summaryErr } = await supabase
        .from("interview_user_summary")
        .select("summary, session_count")
        .eq("user_id", req.userId)
        .single();
      if (summaryErr && summaryErr.code !== "PGRST116") {
        // PGRST116 = no rows, which is fine (first-ever session).
        Sentry.captureMessage(`Failed to fetch user summary: ${summaryErr.message}`);
      }
      if (summaryRow?.summary) {
        userMemory = `\n\n<user_profile_from_past_sessions session_count="${summaryRow.session_count}">\n${summaryRow.summary}\n</user_profile_from_past_sessions>\n\nUse the profile above to tailor your questions, follow-ups, and tone. Probe weaknesses; build on strengths; don't ask questions whose answers are already in the profile.`;
      }
    }

    const augmentedSystemPrompt = prompt.systemPrompt + userMemory;

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
          prompt: { prompt: augmentedSystemPrompt },
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
    model: ANTHROPIC_MODEL,
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
        ? { ok: true as const, text: claudeResult.value, model: ANTHROPIC_MODEL }
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

    // Persist raw session + regenerate user's rolling profile summary.
    // Errors here are logged but do NOT fail the response — Vik still sees
    // the evaluations even if persistence breaks.
    if (req.userId) {
      try {
        const { data: sessionRow, error: insertErr } = await supabase
          .from("interview_sessions")
          .insert({
            user_id: req.userId,
            interview_type,
            transcript,
            duration_sec: duration_sec || null,
            evaluations: { claude, gemini, openai },
          })
          .select("id")
          .single();

        if (insertErr) {
          Sentry.captureMessage(`Failed to insert interview_session: ${insertErr.message}`);
        } else if (sessionRow) {
          // Regenerate the user's rolling profile summary.
          const sessionForSummary = `
INTERVIEW TYPE: ${interview_type}
DURATION: ${Math.round((duration_sec || 0) / 60)} minutes

TRANSCRIPT:
${rendered}

EVALUATIONS:
${claude.ok ? "[Claude] " + claude.text + "\n\n" : ""}${gemini.ok ? "[Gemini] " + gemini.text + "\n\n" : ""}${openai.ok ? "[OpenAI] " + openai.text + "\n\n" : ""}
`.trim();

          // Read existing summary
          const { data: existingSummary } = await supabase
            .from("interview_user_summary")
            .select("summary, session_count")
            .eq("user_id", req.userId)
            .single();

          const existingText = existingSummary?.summary || "";
          const newCount = (existingSummary?.session_count || 0) + 1;

          // Regenerate via Claude
          try {
            if (ANTHROPIC_API_KEY) {
              const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
              const summaryCompletion = await anthropic.messages.create({
                model: ANTHROPIC_MODEL,
                max_tokens: 800,
                system: INTERVIEW_SUMMARY_SYSTEM_PROMPT,
                messages: [
                  {
                    role: "user",
                    content: `EXISTING PROFILE SUMMARY (may be empty if this is the first session):\n${existingText || "(none yet)"}\n\n---\n\nNEW SESSION:\n${sessionForSummary}\n\nReturn the updated profile summary now.`,
                  },
                ],
              });
              const block = summaryCompletion.content.find((b) => b.type === "text");
              const newSummary = block && block.type === "text" ? block.text : existingText;

              await supabase.from("interview_user_summary").upsert(
                {
                  user_id: req.userId,
                  summary: newSummary,
                  session_count: newCount,
                  last_session_id: sessionRow.id,
                  last_session_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "user_id" }
              );
            }
          } catch (summaryErr) {
            Sentry.captureException(summaryErr);
            console.error("Summary regeneration failed:", summaryErr);
          }
        }
      } catch (persistErr) {
        Sentry.captureException(persistErr);
        console.error("Session persistence failed:", persistErr);
      }
    }

    // Include the exact LLM input payload so the UI can show "what the LLMs saw"
    // for transparency / debugging.
    res.json({
      claude,
      gemini,
      openai,
      llm_input: {
        system: VIK_VOICE_EVAL_SYSTEM_PROMPT,
        user: userMsg,
      },
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/interviews/evaluate error:", err);
    res.status(500).json({ error: "Failed to evaluate interview" });
  }
});

export default router;
