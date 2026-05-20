"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabase } from "@/lib/supabase";

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
    <div className="min-h-screen flex items-center justify-center bg-stone-50 py-10">
      <div className="bg-white rounded-xl border border-stone-200 p-5 sm:p-8 shadow-sm max-w-md w-full mx-4 sm:mx-0">
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
