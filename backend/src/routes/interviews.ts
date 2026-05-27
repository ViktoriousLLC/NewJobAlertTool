import { Router, Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import Anthropic from "@anthropic-ai/sdk";
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

router.use(requireAdmin);

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
    res.json({
      signed_url: data.signed_url,
      overrides: {
        agent: {
          prompt: { prompt: prompt.systemPrompt },
          first_message: prompt.firstMessage,
        },
      },
    });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/interviews/token error:", err);
    res.status(500).json({ error: "Failed to mint token" });
  }
});

// POST /api/interviews/evaluate — runs Claude over the captured transcript
// to produce a Vik-voice evaluation.
// Body: { interview_type, transcript: [{role, text}], duration_sec }
router.post("/evaluate", async (req: Request, res: Response) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      res.status(503).json({
        error:
          "Anthropic not configured. Set ANTHROPIC_API_KEY in Railway env (https://console.anthropic.com).",
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

    // Render transcript as plain text for Claude.
    const rendered = transcript
      .map((t) => `${t.role === "agent" ? "Interviewer" : "Candidate"}: ${t.text}`)
      .join("\n\n");

    const userMsg = `Interview type: ${interview_type.replace("_", " ")}
Duration: ~${Math.round((duration_sec || 0) / 60)} minutes
Rubric: ${prompt.evaluationRubric}

Transcript:

${rendered}

Write the evaluation now.`;

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: VIK_VOICE_EVAL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    });

    const textBlock = completion.content.find((b) => b.type === "text");
    const evaluation = textBlock && textBlock.type === "text" ? textBlock.text : "";

    if (!evaluation) {
      res.status(502).json({ error: "Empty response from Claude" });
      return;
    }

    res.json({ evaluation, model: completion.model });
  } catch (err) {
    Sentry.captureException(err);
    console.error("POST /api/interviews/evaluate error:", err);
    res.status(500).json({ error: "Failed to evaluate interview" });
  }
});

export default router;
