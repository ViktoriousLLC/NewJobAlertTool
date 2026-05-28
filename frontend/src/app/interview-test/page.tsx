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

interface AudioDevice {
  deviceId: string;
  label: string;
}

export default function InterviewTestPage() {
  const [status, setStatus] = useState<
    "idle" | "starting" | "connected" | "ending" | "evaluating" | "done" | "error" | "denied"
  >("idle");
  const [selected, setSelected] = useState<InterviewType | null>(null);
  const [mode, setMode] = useState<Mode>("listening");
  const [inputVolume, setInputVolume] = useState(0);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
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
  const micTestRef = useRef<{ stream: MediaStream; ctx: AudioContext; analyser: AnalyserNode } | null>(null);
  const [micTesting, setMicTesting] = useState(false);
  const [micTestPeak, setMicTestPeak] = useState(0);
  const [cspViolations, setCspViolations] = useState<
    Array<{ blockedURI: string; violatedDirective: string; ts: number }>
  >([]);

  // Capture any CSP violation that fires during the session and surface it
  // visibly on the page. The SDK rethrows CSP errors with a generic message,
  // so we need the browser's native event to see what URL was actually blocked.
  useEffect(() => {
    const handler = (e: SecurityPolicyViolationEvent) => {
      console.error("[csp violation]", {
        blockedURI: e.blockedURI,
        violatedDirective: e.violatedDirective,
        effectiveDirective: e.effectiveDirective,
        sourceFile: e.sourceFile,
        lineNumber: e.lineNumber,
      });
      setCspViolations((prev) => [
        ...prev,
        { blockedURI: e.blockedURI, violatedDirective: e.violatedDirective, ts: Date.now() },
      ]);
    };
    document.addEventListener("securitypolicyviolation", handler);
    return () => document.removeEventListener("securitypolicyviolation", handler);
  }, []);

  // Enumerate audio input devices on mount. Note: device labels are only
  // populated AFTER the user grants mic permission once. We trigger a no-op
  // getUserMedia to unlock the labels, then enumerate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const audioInputs: AudioDevice[] = all
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "Unnamed device" }));
        console.log("[interview] audio input devices:", audioInputs);
        setDevices(audioInputs);
      } catch (err) {
        console.warn("[interview] device enumeration failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      const constraints: MediaStreamConstraints = selectedDeviceId
        ? { audio: { deviceId: { exact: selectedDeviceId } } }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const tracks = stream.getAudioTracks();
      console.log(
        "[interview] mic track:",
        tracks.map((t) => ({ label: t.label, deviceId: t.getSettings().deviceId, muted: t.muted, enabled: t.enabled }))
      );
      // Stop our exploratory stream; SDK will open its own with the deviceId.
      tracks.forEach((t) => t.stop());

      const convo = await Conversation.startSession({
        signedUrl: signed_url,
        overrides,
        ...(selectedDeviceId ? { inputDeviceId: selectedDeviceId } : {}),
        onConnect: ({ conversationId }) => {
          console.log("[interview] connected", conversationId);
          setStatus("connected");
          setStartedAt(Date.now());
        },
        onMessage: (payload) => {
          // Log the full payload so we can see exactly what shape the SDK emits.
          console.log("[interview] onMessage payload", payload);
          const { source, role, message } = payload as { source?: string; role?: string; message: string };
          const r: "agent" | "user" =
            role === "agent" || source === "ai" ? "agent" : "user";
          setTranscript((prev) => [...prev, { role: r, text: message, ts: Date.now() }]);
        },
        onModeChange: ({ mode }) => {
          console.log("[interview] mode", mode);
          setMode(mode);
        },
        onVadScore: ({ vadScore }) => {
          // Voice activity score: 0 = silence, 1 = strong speech. If this never
          // goes above 0 while the user talks, audio is not reaching the SDK.
          if (vadScore > 0.5) console.log("[interview] vadScore", vadScore.toFixed(2));
        },
        onAgentChatResponsePart: (part) => {
          // Some agent text streams via this callback instead of onMessage.
          console.log("[interview] agentChatResponsePart", part);
        },
        onAudio: () => {
          // Fires for every audio chunk the agent sends back; logging just count.
        },
        onDebug: (info) => {
          console.log("[interview] debug", info);
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

      console.log("[interview] session started, convo:", convo);

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

  // Pre-flight mic test: opens the mic, runs an AnalyserNode for ~10 seconds
  // showing live volume. Pure browser audio path; if bars don't move here, the
  // SDK has no chance. Useful to isolate "is it my mic/OS" from "is it the SDK".
  const handleMicTest = useCallback(async () => {
    if (micTesting) return;
    setMicTesting(true);
    setMicTestPeak(0);
    try {
      const constraints: MediaStreamConstraints = selectedDeviceId
        ? { audio: { deviceId: { exact: selectedDeviceId } } }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      micTestRef.current = { stream, ctx, analyser };
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!micTestRef.current) return;
        analyser.getByteFrequencyData(buf);
        // Average across the human voice band
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const avg = sum / buf.length / 255;
        setMicTestPeak((prev) => Math.max(prev, avg));
        setInputVolume(avg);
        requestAnimationFrame(tick);
      };
      tick();
      // Auto-stop after 10s
      setTimeout(() => {
        if (micTestRef.current) {
          micTestRef.current.stream.getTracks().forEach((t) => t.stop());
          micTestRef.current.ctx.close();
          micTestRef.current = null;
        }
        setMicTesting(false);
        setInputVolume(0);
      }, 10000);
    } catch (err) {
      console.error("[mic-test] failed:", err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setMicTesting(false);
    }
  }, [selectedDeviceId, micTesting]);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setSelected(null);
    setTranscript([]);
    setEvaluations({ claude: null, gemini: null, openai: null });
    setErrorMsg(null);
    setStartedAt(null);
    setMode("listening");
    setInputVolume(0);
    setCspViolations([]);
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
        <>
          {devices.length > 0 && (
            <div className="mb-4 bg-stone-50 border border-stone-200 rounded-lg p-3 space-y-3">
              <div>
                <label className="block text-xs uppercase text-stone-400 mb-1">Microphone</label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="w-full text-sm bg-white border border-stone-200 rounded-md px-3 py-2"
                >
                  <option value="">System default</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-stone-400 mt-1">
                  Pick the mic you&apos;re actually talking into. System default isn&apos;t always right.
                </div>
              </div>
              <div>
                <button
                  onClick={handleMicTest}
                  disabled={micTesting}
                  className="bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 text-white text-sm font-medium px-3 py-2 rounded-md"
                >
                  {micTesting ? "Testing mic... talk now" : "Test mic (10 sec)"}
                </button>
                {micTesting && (
                  <div className="mt-2">
                    <div className="flex items-end gap-0.5 h-8">
                      {Array.from({ length: 20 }).map((_, i) => {
                        const threshold = (i + 1) / 20;
                        const active = inputVolume >= threshold * 0.6;
                        return (
                          <div
                            key={i}
                            className={`w-1.5 rounded-sm transition-all duration-75 ${
                              active ? "bg-emerald-500" : "bg-stone-200"
                            }`}
                            style={{ height: `${20 + i * 4}%` }}
                          ></div>
                        );
                      })}
                    </div>
                    <div className="text-xs text-stone-500 mt-1">
                      Talk into your mic. Bars should jump. Peak so far: {(micTestPeak * 100).toFixed(0)}%
                    </div>
                  </div>
                )}
                {!micTesting && micTestPeak > 0 && (
                  <div className="text-xs mt-1">
                    {micTestPeak > 0.1 ? (
                      <span className="text-emerald-700">✓ Mic working. Peak: {(micTestPeak * 100).toFixed(0)}%</span>
                    ) : (
                      <span className="text-rose-700">
                        ✗ Mic barely registered (peak {(micTestPeak * 100).toFixed(0)}%). Try a different device above, or check OS mic permissions.
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
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
        </>
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
                  <div className="inline-flex flex-col gap-1">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeDashoffset="20" />
                      </svg>
                      Generating your evaluations
                    </span>
                    <span className="text-xs text-stone-500 ml-6">
                      Running Claude, Gemini, and GPT in parallel. Usually 5-15 seconds.
                    </span>
                  </div>
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
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-white border border-orange-200 rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="text-xs font-semibold uppercase text-orange-700">
                      {evaluations.claude && evaluations.claude.ok ? evaluations.claude.model : "Claude"}
                    </div>
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
                    <div className="text-xs font-semibold uppercase text-blue-700">
                      {evaluations.gemini && evaluations.gemini.ok ? evaluations.gemini.model : "Gemini"}
                    </div>
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
          {cspViolations.length > 0 && (
            <div className="mb-3 bg-white border border-rose-300 rounded p-3">
              <div className="text-xs font-semibold uppercase text-rose-700 mb-2">
                CSP violations captured ({cspViolations.length})
              </div>
              <ul className="space-y-1 text-xs font-mono break-all">
                {cspViolations.map((v, i) => (
                  <li key={i} className="text-stone-800">
                    <span className="text-rose-700">{v.violatedDirective}</span> blocked:{" "}
                    <span className="text-stone-900">{v.blockedURI || "(inline)"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
