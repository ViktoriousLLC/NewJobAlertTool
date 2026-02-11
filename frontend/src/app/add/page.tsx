"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

const EXAMPLE_COMPANIES = [
  { name: "Spotify", url: "https://jobs.lever.co/spotify" },
  { name: "Cloudflare", url: "https://jobs.lever.co/cloudflare" },
  { name: "Cisco", url: "https://careers.cisco.com" },
  { name: "Shopify", url: "https://www.shopify.com/careers" },
  { name: "Databricks", url: "https://jobs.lever.co/databricks" },
  { name: "Coinbase", url: "https://boards.greenhouse.io/coinbase" },
  { name: "Square", url: "https://boards.greenhouse.io/squareup" },
  { name: "Notion", url: "https://jobs.lever.co/notion" },
];

// Step durations control when we advance to the next step
const STEP_DURATIONS = [4000, 25000, 8000, 5000];

export default function AddCompany() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [careersUrl, setCareersUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentStep, setCurrentStep] = useState(-1);
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const counterIntervals = useRef<ReturnType<typeof setInterval>[]>([]);
  const [example] = useState(() =>
    EXAMPLE_COMPANIES[Math.floor(Math.random() * EXAMPLE_COMPANIES.length)]
  );

  // Animated counters
  const [scanCount, setScanCount] = useState(0);
  const [scanTarget] = useState(() => 600 + Math.floor(Math.random() * 800)); // 600-1400
  const [pmCount, setPmCount] = useState(0);
  const [pmTarget] = useState(() => 15 + Math.floor(Math.random() * 25)); // 15-40
  const [validateCount, setValidateCount] = useState(0);

  const clearAllTimers = useCallback(() => {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
    counterIntervals.current.forEach(clearInterval);
    counterIntervals.current = [];
  }, []);

  // Advance through steps + animate counters
  useEffect(() => {
    if (!loading) {
      setCurrentStep(-1);
      setScanCount(0);
      setPmCount(0);
      setValidateCount(0);
      clearAllTimers();
      return;
    }

    setCurrentStep(0);

    let elapsed = 0;
    for (let i = 1; i < STEP_DURATIONS.length; i++) {
      elapsed += STEP_DURATIONS[i - 1];
      const step = i;
      const timer = setTimeout(() => setCurrentStep(step), elapsed);
      stepTimers.current.push(timer);
    }

    return clearAllTimers;
  }, [loading, clearAllTimers]);

  // Counter animations per step
  useEffect(() => {
    counterIntervals.current.forEach(clearInterval);
    counterIntervals.current = [];

    if (currentStep === 1) {
      // Scanning: count up to scanTarget over ~24 seconds
      const increment = Math.max(1, Math.floor(scanTarget / 80));
      const interval = setInterval(() => {
        setScanCount((prev) => {
          const next = prev + increment + Math.floor(Math.random() * increment);
          return next >= scanTarget ? scanTarget : next;
        });
      }, 300);
      counterIntervals.current.push(interval);
    }

    if (currentStep === 2) {
      // Filtering: count PM roles up from 0 to pmTarget over ~6 seconds
      setScanCount(scanTarget); // ensure scan shows final number
      const increment = Math.max(1, Math.floor(pmTarget / 15));
      const interval = setInterval(() => {
        setPmCount((prev) => {
          const next = prev + increment;
          return next >= pmTarget ? pmTarget : next;
        });
      }, 400);
      counterIntervals.current.push(interval);
    }

    if (currentStep === 3) {
      // Validating: count up from 0 to pmTarget over ~4 seconds
      setPmCount(pmTarget); // ensure PM shows final number
      const increment = Math.max(1, Math.floor(pmTarget / 10));
      const interval = setInterval(() => {
        setValidateCount((prev) => {
          const next = prev + increment;
          return next >= pmTarget ? pmTarget : next;
        });
      }, 350);
      counterIntervals.current.push(interval);
    }
  }, [currentStep, scanTarget, pmTarget]);

  function getStepLabel(stepIndex: number, isDone: boolean) {
    switch (stepIndex) {
      case 0:
        return isDone ? "Platform detected" : "Detecting platform...";
      case 1:
        if (isDone) return `Scanned ${scanTarget.toLocaleString()} job listings`;
        return `Scanning job listings... ${scanCount.toLocaleString()} found`;
      case 2:
        if (isDone) return `${pmTarget} PM roles from ${scanTarget.toLocaleString()} listings`;
        return `Filtering PM roles... ${pmCount} of ${scanTarget.toLocaleString()}`;
      case 3:
        if (isDone) return `${pmTarget} of ${pmTarget} validated`;
        return `Validating results... ${validateCount} of ${pmTarget}`;
      default:
        return "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await apiFetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, careers_url: careersUrl }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add company");
      }

      const company = await res.json();

      if (company.total_product_jobs > 200) {
        const proceed = confirm(
          `Warning: ${company.total_product_jobs} product jobs were found. This is a lot — the initial baseline has been saved. Continue?`
        );
        if (!proceed) {
          await apiFetch(`/api/companies/${company.id}`, {
            method: "DELETE",
          });
          setLoading(false);
          return;
        }
      }

      router.push(`/company/${company.id}?added=true`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-700 text-sm mb-6 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to dashboard
      </Link>

      <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[var(--brand)] rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-stone-800">Add Company</h1>
            <p className="text-sm text-stone-500">Track product job postings from a new company</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-stone-700 mb-2"
            >
              Company Name
            </label>
            <input
              id="name"
              type="text"
              required
              disabled={loading}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${example.name}`}
              className="w-full px-4 py-3 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:border-transparent bg-stone-50 text-stone-900 placeholder-stone-400 disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="url"
              className="block text-sm font-medium text-stone-700 mb-2"
            >
              Careers Page URL
            </label>
            <input
              id="url"
              type="url"
              required
              disabled={loading}
              value={careersUrl}
              onChange={(e) => setCareersUrl(e.target.value)}
              placeholder={`e.g. ${example.url}`}
              className="w-full px-4 py-3 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:border-transparent bg-stone-50 text-stone-900 placeholder-stone-400 disabled:opacity-60"
            />
            <p className="mt-2 text-xs text-stone-500">
              Enter the URL of the company&apos;s careers page that lists job openings
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          {!loading && (
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="flex-1 bg-[var(--brand)] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[var(--brand-hover)] transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
              >
                Add Company
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="px-6 py-3 rounded-lg font-medium border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {loading && (
            <div className="border border-stone-200 rounded-lg p-5 space-y-3">
              {[0, 1, 2, 3].map((i) => {
                const isActive = i === currentStep;
                const isDone = i < currentStep;
                const isPending = i > currentStep;

                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 transition-all duration-300 ${
                      isPending ? "opacity-30" : "opacity-100"
                    }`}
                  >
                    {isDone ? (
                      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : isActive ? (
                      <div className="w-6 h-6 flex items-center justify-center shrink-0">
                        <svg className="animate-spin h-5 w-5 text-[var(--brand)]" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-stone-200 shrink-0" />
                    )}
                    <span
                      className={`text-sm tabular-nums ${
                        isActive
                          ? "text-stone-800 font-medium"
                          : isDone
                          ? "text-green-700"
                          : "text-stone-400"
                      }`}
                    >
                      {getStepLabel(i, isDone)}
                    </span>
                  </div>
                );
              })}
              <p className="text-xs text-stone-400 pt-2 border-t border-stone-100 mt-3">
                This usually takes 30–60 seconds
              </p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
