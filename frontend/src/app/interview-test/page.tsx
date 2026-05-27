"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Conversation } from "@elevenlabs/client";

type InterviewType = "behavioral" | "product_sense" | "analytics";
type Mode = "listening" | "speaking";

interface TranscriptTurn {
  role: "agent" | "user";
  text: string;
  ts: number;
}

const TYPE_META: Record<InterviewType, { label: string; blurb: string; tint: string }> = {
  behavioral: {
    label: "Behavioral",
    blurb: "STAR-style past experience questions. ~10 min.",
    tint: "bg-sky-50 hover:bg-sky-100 border-sky-200 text-sky-900",
  },
  product_sense: {
    label: "Product Sense",
    blurb: "One open product question, explored deep. ~15 min.",
    tint: "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-900",
  },
  analytics: {
    label: "Analytics",
    blurb: "Metrics scenario; you diagnose and act. ~15 min.",
    tint: "bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-900",
  },
};

export default function InterviewTestPage() {
  const [status, setStatus] = useState<
    "idle" | "starting" | "connected" | "ending" | "evaluating" | "done" | "error" | "denied"
  >("idle");
  const [selected, setSelected] = useState<InterviewType | null>(null);
  const [mode, setMode] = useState<Mode>("listening");
  const [inputVolume, setInputVolume] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [evaluations, setEvaluations] = useState<{
    claude: { ok: true; text: string; model: string } | { ok: false; error: string } | null;
    gemini: { ok: true; text: string; model: string } | { ok: false; error: string } | null;
    openai: { ok: true; text: string; model: string } | { ok: false; error: string } | null;
  }>({ claude: null, gemini: null, openai: null });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const convoRef = useRef<Awaited<ReturnType<typeof Conversation.startSession>> | null>(null);
  const volumePollRef = useRef<number | null>(null);

  // Poll input volume at ~60fps when connected, so the mic level meter
  // updates smoothly while the user is speaking.
  useEffect(() => {
    if (status !== "connected") {
      if (volumePollRef.current !== null) {
        cancelAnimationFrame(volumePollRef.current);
        volumePollRef.current = null;
      }
      setInputVolume(0);
      return;
    }
    const tick = () => {
      if (convoRef.current) {
        try {
          const v = convoRef.current.getInputVolume();
          setInputVolume(v);
        } catch {
          // SDK may throw if not fully connected; ignore.
        }
      }
      volumePollRef.current = requestAnimationFrame(tick);
    };
    volumePollRef.current = requestAnimationFrame(tick);
    return () => {
      if (volumePollRef.current !== null) cancelAnimationFrame(volumePollRef.current);
    };
  }, [status]);

  const handleStart = useCallback(async (type: InterviewType) => {
    setSelected(type);
    setTranscript([]);
    setEvaluations({ claude: null, gemini: null, openai: null });
    setErrorMsg(null);
    setStatus("starting");

    try {
      const tokenResp = await apiFetch("/api/interviews/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interview_type: type }),
      });

      if (tokenResp.status === 403) {
        setStatus("denied");
        return;
      }

      if (!tokenResp.ok) {
        const body = await tokenResp.json().catch(() => ({}));
        throw new Error(body.error || `Token mint failed (${tokenResp.status})`);
      }

      const { signed_url, overrides } = (await tokenResp.json()) as {
        signed_url: string;
        overrides: object;
      };

      // Get mic permission before startSession; some SDK versions assume the
      // permission has already been granted and fail silently otherwise.
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const convo = await Conversation.startSession({
        signedUrl: signed_url,
        overrides,
        onConnect: ({ conversationId }) => {
          console.log("[interview] connected", conversationId);
          setStatus("connected");
          setStartedAt(Date.now());
        },
        onMessage: ({ source, message }) => {
          console.log("[interview] onMessage", source, message);
          setTranscript((prev) => [
            ...prev,
            { role: source === "ai" ? "agent" : "user", text: message, ts: Date.now() },
          ]);
        },
        onModeChange: ({ mode }) => {
          console.log("[interview] mode", mode);
          setMode(mode);
        },
        onError: (message, context) => {
          console.error("[interview] onError", message, context);
          setErrorMsg(message);
          setStatus("error");
        },
        onDisconnect: (details) => {
          console.log("[interview] disconnected", details);
        },
      });

      convoRef.current = convo;
    } catch (err) {
      console.error("Interview start failed:", err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  const handleEnd = useCallback(async () => {
    if (!convoRef.current || !selected) return;
    setStatus("ending");

    try {
      await convoRef.current.endSession();
      convoRef.current = null;

      if (transcript.length === 0) {
        console.warn("[interview] ended with empty transcript");
        setStatus("done");
        return;
      }

      setStatus("evaluating");
      const duration = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;

      const evalResp = await apiFetch("/api/interviews/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interview_type: selected,
          transcript: transcript.map((t) => ({ role: t.role, text: t.text })),
          duration_sec: duration,
        }),
      });

      if (!evalResp.ok) {
        const body = await evalResp.json().catch(() => ({}));
        throw new Error(body.error || `Evaluation failed (${evalResp.status})`);
      }

      const data = (await evalResp.json()) as typeof evaluations;
      setEvaluations(data);
      setStatus("done");
    } catch (err) {
      console.error("Interview end failed:", err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [selected, startedAt, transcript]);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setSelected(null);
    setTranscript([]);
    setEvaluations({ claude: null, gemini: null, openai: null });
    setErrorMsg(null);
    setStartedAt(null);
    setMode("listening");
    setInputVolume(0);
  }, []);

  if (status === "denied") {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <h1 className="text-xl font-bold text-[#1A1A2E] mb-2">Access Denied</h1>
        <p className="text-stone-500 text-sm">Admin only.</p>
        <Link href="/" className="text-[#0EA5E9] hover:underline text-sm mt-4 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  // Visual feedback: bars rendered from inputVolume (0-1). 12 bars across.
  const meterBars = Array.from({ length: 12 }, (_, i) => {
    const threshold = (i + 1) / 12;
    const active = inputVolume >= threshold * 0.6; // amplify low signals
    return active;
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-[#1A1A2E] mb-1">Interview Test</h1>
        <p className="text-stone-500 text-sm">
          Admin-only test page for the ElevenLabs + Claude/Gemini/GPT mock interview pipeline. Pick a type, talk to the AI, get evaluations from 3 models side-by-side. ElevenLabs minutes are real money; end the session when done.
        </p>
      </header>

      {status === "idle" && (
        <div className="grid sm:grid-cols-3 gap-3">
          {(Object.keys(TYPE_META) as InterviewType[]).map((t) => (
            <button
              key={t}
              onClick={() => handleStart(t)}
              className={`text-left border rounded-lg p-4 transition ${TYPE_META[t].tint}`}
            >
              <div className="font-semibold mb-1">{TYPE_META[t].label}</div>
              <div className="text-xs opacity-80">{TYPE_META[t].blurb}</div>
            </button>
          ))}
        </div>
      )}

      {(status === "starting" || status === "connected" || status === "ending" || status === "evaluating") && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white border border-stone-200 rounded-lg p-4">
            <div className="flex-1">
              <div className="text-xs uppercase text-stone-400 mb-1">Now running</div>
              <div className="font-semibold">{selected && TYPE_META[selected].label}</div>
              <div className="flex items-center gap-3 mt-2">
                {status === "starting" && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                    Connecting to ElevenLabs...
                  </span>
                )}
                {status === "connected" && (
                  <>
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded ${
                        mode === "speaking"
                          ? "bg-sky-100 text-sky-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          mode === "speaking" ? "bg-sky-500" : "bg-emerald-500 animate-pulse"
                        }`}
                      ></span>
                      {mode === "speaking" ? "AI speaking" : "Listening to you"}
                    </span>
                    <div className="flex items-end gap-0.5 h-5">
                      {meterBars.map((active, i) => (
                        <div
                          key={i}
                          className={`w-1 rounded-sm transition-all duration-75 ${
                            active ? "bg-emerald-500" : "bg-stone-200"
                          }`}
                          style={{ height: `${30 + i * 6}%` }}
                        ></div>
                      ))}
                    </div>
                  </>
                )}
                {status === "ending" && <span className="text-xs text-stone-500">Ending session...</span>}
                {status === "evaluating" && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
                    <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse"></span>
                    Running Claude + Gemini + GPT evaluations...
                  </span>
                )}
              </div>
            </div>
            {status === "connected" && (
              <button
                onClick={handleEnd}
                className="bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-4 py-2 rounded-md"
              >
                End interview
              </button>
            )}
          </div>

          {/* Always-visible transcript panel, even when empty, so user knows we're listening */}
          <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 max-h-96 overflow-y-auto">
            <div className="text-xs uppercase text-stone-400 mb-2">Live transcript</div>
            {transcript.length === 0 ? (
              <div className="text-sm text-stone-400 italic">
                Transcript will appear as you and the AI talk...
              </div>
            ) : (
              transcript.map((t, i) => (
                <div key={i} className="mb-2 text-sm">
                  <span
                    className={`font-semibold ${
                      t.role === "agent" ? "text-sky-700" : "text-stone-700"
                    }`}
                  >
                    {t.role === "agent" ? "AI" : "You"}:
                  </span>{" "}
                  {t.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {status === "done" && (
        <div className="space-y-4">
          {(evaluations.claude || evaluations.gemini || evaluations.openai) ? (
            <div>
              <div className="text-xs uppercase text-stone-400 mb-3">Evaluations (A/B/C: Claude vs Gemini vs GPT, in Vik&apos;s voice)</div>
              <div className="grid xl:grid-cols-3 gap-4">
                <div className="bg-white border border-orange-200 rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="text-xs font-semibold uppercase text-orange-700">Claude Sonnet 4.6</div>
                    <div className="text-xs text-stone-400">~$0.02/eval</div>
                  </div>
                  {evaluations.claude && evaluations.claude.ok ? (
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap text-stone-800">{evaluations.claude.text}</div>
                  ) : (
                    <div className="text-sm text-rose-700">
                      Failed: {evaluations.claude && !evaluations.claude.ok ? evaluations.claude.error : "no response"}
                    </div>
                  )}
                </div>
                <div className="bg-white border border-blue-200 rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="text-xs font-semibold uppercase text-blue-700">Gemini 2.5 Pro</div>
                    <div className="text-xs text-stone-400">free tier</div>
                  </div>
                  {evaluations.gemini && evaluations.gemini.ok ? (
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap text-stone-800">{evaluations.gemini.text}</div>
                  ) : (
                    <div className="text-sm text-rose-700">
                      Failed: {evaluations.gemini && !evaluations.gemini.ok ? evaluations.gemini.error : "no response"}
                    </div>
                  )}
                </div>
                <div className="bg-white border border-emerald-200 rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="text-xs font-semibold uppercase text-emerald-700">
                      {evaluations.openai && evaluations.openai.ok ? evaluations.openai.model : "OpenAI"}
                    </div>
                    <div className="text-xs text-stone-400">~$0.02/eval</div>
                  </div>
                  {evaluations.openai && evaluations.openai.ok ? (
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap text-stone-800">{evaluations.openai.text}</div>
                  ) : (
                    <div className="text-sm text-rose-700">
                      Failed: {evaluations.openai && !evaluations.openai.ok ? evaluations.openai.error : "no response"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
              Session ended with no transcript captured. Try again.
            </div>
          )}

          {transcript.length > 0 && (
            <details className="bg-stone-50 border border-stone-200 rounded-lg p-4">
              <summary className="text-xs uppercase text-stone-400 cursor-pointer">Full transcript</summary>
              <div className="mt-3 space-y-2 text-sm">
                {transcript.map((t, i) => (
                  <div key={i}>
                    <span
                      className={`font-semibold ${
                        t.role === "agent" ? "text-sky-700" : "text-stone-700"
                      }`}
                    >
                      {t.role === "agent" ? "AI" : "You"}:
                    </span>{" "}
                    {t.text}
                  </div>
                ))}
              </div>
            </details>
          )}

          <button
            onClick={handleReset}
            className="bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium px-4 py-2 rounded-md"
          >
            Run another
          </button>
        </div>
      )}

      {status === "error" && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
          <div className="font-semibold text-rose-900 mb-1">Something went wrong</div>
          <div className="text-sm text-rose-800 mb-3">{errorMsg}</div>
          <button
            onClick={handleReset}
            className="bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium px-4 py-2 rounded-md"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
