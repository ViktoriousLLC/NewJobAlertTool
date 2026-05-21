"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { getFaviconUrl, getFaviconFallbackUrl } from "@/lib/brandColors";

// Mix a hex color toward white by `pct` percent. Inlined (not imported from
// LandingPage) to keep the login route bundle small.
function mix(hex: string, pct: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = pct / 100;
  return `rgb(${Math.round(r + (255 - r) * f)},${Math.round(g + (255 - g) * f)},${Math.round(b + (255 - b) * f)})`;
}

// 10 decorative cards: 3 big-tech + 3 famous startups + 1 biotech + 1 banking
// + 1 auto + 1 consumer. Real logos loaded via getFaviconUrl (logo.dev →
// DuckDuckGo); colored brand chip + letter sits behind as the always-visible
// fallback.
type DecoCard = {
  name: string;
  domain: string;
  color: string;
  letter: string;
  roles: number;
  pos: React.CSSProperties;
  dur: number;
  delay: number;
};

const DECORATIVE_CARDS: DecoCard[] = [
  // Top-left cluster (3)
  { name: "Apple",         domain: "apple.com",        color: "#1D1D1F", letter: "A", roles: 37, pos: { top: "9%",  left: "4%"  }, dur: 3.0, delay: 0.0 },
  { name: "Microsoft",     domain: "microsoft.com",    color: "#0078D4", letter: "M", roles: 52, pos: { top: "26%", left: "1%"  }, dur: 3.4, delay: 0.4 },
  { name: "Amazon",        domain: "amazon.com",       color: "#FF9900", letter: "A", roles: 41, pos: { top: "14%", left: "18%" }, dur: 3.6, delay: 0.8 },
  // Top-right cluster (2) — OpenAI replaces Meta per UX feedback
  { name: "OpenAI",        domain: "openai.com",       color: "#10A37F", letter: "O", roles: 24, pos: { top: "10%", right: "5%"  }, dur: 3.2, delay: 0.2 },
  { name: "Anthropic",     domain: "anthropic.com",    color: "#D4A574", letter: "A", roles: 6,  pos: { top: "26%", right: "11%" }, dur: 3.5, delay: 0.6 },
  // Bottom-left cluster (2)
  { name: "Linear",        domain: "linear.app",       color: "#5E6AD2", letter: "L", roles: 4,  pos: { bottom: "30%", left: "1%" }, dur: 3.3, delay: 0.5 },
  { name: "Notion",        domain: "notion.so",        color: "#2D2D2D", letter: "N", roles: 7,  pos: { bottom: "14%", left: "5%" }, dur: 3.7, delay: 1.0 },
  // Bottom-right cluster (3) — Pfizer replaces Moderna (more recognizable)
  { name: "Pfizer",        domain: "pfizer.com",       color: "#0093D0", letter: "P", roles: 11, pos: { bottom: "8%",  right: "5%"  }, dur: 3.4, delay: 0.7 },
  { name: "Goldman Sachs", domain: "goldmansachs.com", color: "#7399C6", letter: "G", roles: 35, pos: { bottom: "23%", right: "11%" }, dur: 3.6, delay: 0.9 },
  { name: "Tesla",         domain: "tesla.com",        color: "#CC0000", letter: "T", roles: 18, pos: { bottom: "14%", right: "21%" }, dur: 3.8, delay: 1.2 },
];

function DecorativeCard({ name, domain, color, letter, roles, pos, dur, delay }: DecoCard) {
  const bg96 = mix(color, 96);
  const grad55 = mix(color, 55);
  const grad30 = mix(color, 30);
  const careersUrl = `https://${domain}`;
  const primaryLogo = getFaviconUrl(name, careersUrl);
  const fallbackLogo = getFaviconFallbackUrl(name, careersUrl);
  return (
    <div
      aria-hidden
      style={{
        ...pos,
        position: "absolute",
        background: bg96,
        borderRadius: 10,
        overflow: "hidden",
        width: 110,
        boxShadow: "0 10px 30px rgba(0,0,0,0.30)",
        border: "1px solid rgba(255,255,255,0.06)",
        animation: `heroFloat ${dur}s ease-in-out infinite alternate`,
        animationDelay: `${delay}s`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          background: `linear-gradient(135deg, ${grad55}, ${grad30})`,
          padding: "5px 8px",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        {/* Colored brand chip is always rendered; logo <img> overlays on top
            and falls back through CDN chain, hiding itself if everything 404s.
            Mirrors the JobFeed CompanyCell pattern. */}
        <div
          style={{
            position: "relative",
            width: 16,
            height: 16,
            borderRadius: 3,
            background: color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 8,
            fontWeight: 700,
            overflow: "hidden",
          }}
        >
          <span>{letter}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={primaryLogo}
            alt=""
            width={16}
            height={16}
            referrerPolicy="no-referrer"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement & { dataset: DOMStringMap };
              if (img.dataset.fallback !== "1") {
                img.dataset.fallback = "1";
                img.src = fallbackLogo;
              } else {
                img.style.display = "none";
              }
            }}
          />
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#1A1A2E" }}>{name}</span>
      </div>
      <div style={{ padding: "8px 6px", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1A2E" }}>{roles}</span>
          <span style={{ fontSize: 8, fontWeight: 500, color: "#6E6E80" }}>roles</span>
        </div>
      </div>
    </div>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Show error from callback redirect (e.g., PKCE failure, expired link)
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) setError(urlError);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Retry up to 2 times on network failures (e.g., "Failed to fetch")
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { error: authError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (!authError) {
          setLoading(false);
          setSent(true);
          return;
        }

        // Auth-level error (not network) — don't retry
        if (!authError.message.toLowerCase().includes("fetch")) {
          setLoading(false);
          setError(authError.message);
          return;
        }

        lastError = authError.message;
      } catch {
        lastError = "Network error";
      }

      // Wait before retrying
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    setLoading(false);
    setError("Unable to reach the authentication server. Please check your internet connection and try again.");
  }

  return (
    <div
      className="relative min-h-screen flex items-center justify-center py-10 overflow-hidden"
      style={{
        background:
          "linear-gradient(165deg, #081226 0%, #0C1E3A 30%, #0F2847 55%, #0A1F3D 75%, #081226 100%)",
      }}
    >
      {/* Decorative orbs (match /new-home hero) */}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{ top: -120, right: -100, width: 480, height: 480, background: "radial-gradient(circle, rgba(14,165,233,0.18), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{ bottom: -100, left: -80, width: 420, height: 420, background: "radial-gradient(circle, rgba(99,91,255,0.10), transparent 65%)" }}
      />

      {/* Grid texture overlay — same pattern as /new-home hero gives the
          dark gradient some visual depth. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Decorative floating company cards — desktop only (lg+ = ≥1024px)
          so they don't crowd the central card on smaller screens. */}
      <div className="hidden lg:block absolute inset-0 pointer-events-none" aria-hidden>
        {DECORATIVE_CARDS.map((c) => (
          <DecorativeCard key={c.name} {...c} />
        ))}
      </div>

      <div
        className="relative bg-white rounded-xl border border-stone-200 p-5 sm:p-8 max-w-md w-full mx-4 sm:mx-0"
        style={{
          boxShadow:
            "0 20px 60px rgba(0,0,0,0.35), 0 4px 16px rgba(14,165,233,0.12)",
        }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-[var(--brand)] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">PM</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-stone-800">Welcome to NewPMJobs</h1>
            <p className="text-sm text-stone-500">Sign in to start tracking</p>
          </div>
        </div>

        {!sent && (
          <div className="mb-6 rounded-lg bg-stone-50 border border-stone-200 p-4">
            <p className="text-[13px] text-stone-600 leading-relaxed mb-3">
              Once you sign in, you can:
            </p>
            <ul className="space-y-1.5 text-[13px] text-stone-700">
              <li className="flex gap-2">
                <span className="text-[var(--brand)] font-bold">✓</span>
                Track companies you care about
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--brand)] font-bold">✓</span>
                Get email alerts when they post new PM roles
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--brand)] font-bold">✓</span>
                Save and revisit jobs you want to apply to
              </li>
            </ul>
            <p className="text-[12px] text-stone-500 mt-3 pt-3 border-t border-stone-200">
              Free. No fees. No credit card. No spam.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-3 text-[10px] uppercase tracking-wider text-stone-400 font-semibold">
              <span>Tracking 240+ companies</span>
              <span className="text-stone-300">·</span>
              <span>Updated daily</span>
              <span className="text-stone-300">·</span>
              <span>Made by a PM</span>
            </div>
          </div>
        )}

        {sent ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-stone-800 mb-2">Check your email!</h2>
            <p className="text-stone-500 text-sm">
              We sent a magic link to <strong>{email}</strong>. Click the link to sign in.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-2">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:border-transparent bg-stone-50 text-stone-900 placeholder-stone-400"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--brand)] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[var(--brand-hover)] transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Sending...
                </>
              ) : (
                "Send Magic Link"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
