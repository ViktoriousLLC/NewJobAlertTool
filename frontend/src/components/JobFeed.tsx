"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { getBrandColor, getFaviconUrl, softenColor } from "@/lib/brandColors";

// Job-first landing feed. Drives the new `/` page. Public read (no auth
// required) — the Track action is the only gated path, falling back to
// /login when the visitor isn't signed in.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const PAGE_SIZE = 50;

const INDUSTRIES = [
  { id: "tech", label: "Tech" },
  { id: "fintech", label: "Fintech" },
  { id: "biotech", label: "Biotech" },
  { id: "hardware", label: "Hardware" },
  { id: "consumer", label: "Consumer" },
  { id: "gaming", label: "Gaming" },
  { id: "media", label: "Media" },
  { id: "banking", label: "Banking" },
  { id: "consulting", label: "Consulting" },
  { id: "healthcare", label: "Healthcare" },
] as const;

type LevelId = "director" | "mid" | "early";
const LEVELS: { id: LevelId; label: string; color: string }[] = [
  { id: "director", label: "Director+", color: "violet" },
  { id: "mid", label: "Mid", color: "amber" },
  { id: "early", label: "Junior", color: "blue" },
];

const LEVEL_PILL: Record<LevelId, { bg: string; text: string }> = {
  director: { bg: "rgb(237 233 254)", text: "rgb(109 40 217)" },
  mid: { bg: "rgb(254 243 199)", text: "rgb(180 83 9)" },
  early: { bg: "rgb(219 234 254)", text: "rgb(29 78 216)" },
};

interface FeedJob {
  id: string;
  title: string;
  location: string | null;
  urlPath: string;
  firstSeenAt: string;
  level: LevelId | null;
  company: {
    id: string;
    name: string;
    careers_url: string;
    industry: string;
  };
}

interface FeedResponse {
  jobs: FeedJob[];
  total: number;
  limit: number;
  offset: number;
}

function buildJobUrl(urlPath: string, careersUrl: string): string {
  if (urlPath.startsWith("http")) return urlPath;
  try {
    return new URL(urlPath, careersUrl).href;
  } catch {
    return urlPath;
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function JobFeed() {
  const router = useRouter();
  const { showToast } = useToast();

  const [jobs, setJobs] = useState<FeedJob[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [industry, setIndustry] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelId | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [subscribedCompanyIds, setSubscribedCompanyIds] = useState<Set<string>>(new Set());
  const [trackingInFlight, setTrackingInFlight] = useState<Set<string>>(new Set());

  // Debounce the search input — 300ms.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Detect session + load existing subscriptions for the Track button state.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (data.session?.user) {
        setIsAuthed(true);
        try {
          const res = await apiFetch("/api/subscriptions");
          if (res.ok) {
            const ids: string[] = await res.json();
            setSubscribedCompanyIds(new Set(ids));
          }
        } catch {
          // Best-effort; the feed still renders without sub data.
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchFeed = useCallback(
    async (opts: { reset: boolean; offsetOverride?: number }) => {
      if (opts.reset) setLoading(true);
      else setLoadingMore(true);

      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(opts.offsetOverride ?? (opts.reset ? 0 : offset)));
      if (industry) params.set("industry", industry);
      if (level) params.set("level", level);
      if (debouncedSearch) params.set("q", debouncedSearch);

      try {
        const res = await fetch(`${API_URL}/api/feed?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: FeedResponse = await res.json();
        setTotal(data.total);
        if (opts.reset) {
          setJobs(data.jobs);
          setOffset(data.jobs.length);
        } else {
          setJobs((prev) => [...prev, ...data.jobs]);
          setOffset((prev) => prev + data.jobs.length);
        }
      } catch (err) {
        console.error("Feed fetch failed:", err);
        showToast("Couldn't load jobs. Please refresh.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [industry, level, debouncedSearch, offset, showToast]
  );

  // Reset + refetch when filters change.
  useEffect(() => {
    fetchFeed({ reset: true, offsetOverride: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [industry, level, debouncedSearch]);

  const handleTrack = async (companyId: string, companyName: string) => {
    if (!isAuthed) {
      router.push(`/login?next=${encodeURIComponent("/")}`);
      return;
    }
    if (subscribedCompanyIds.has(companyId)) return;
    setTrackingInFlight((prev) => new Set(prev).add(companyId));
    try {
      const res = await apiFetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_ids: [companyId] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubscribedCompanyIds((prev) => new Set(prev).add(companyId));
      showToast(`Tracking ${companyName}. You'll get an email when they post new PM roles.`);
    } catch {
      showToast("Couldn't track this company. Please try again.");
    } finally {
      setTrackingInFlight((prev) => {
        const next = new Set(prev);
        next.delete(companyId);
        return next;
      });
    }
  };

  const hasMore = jobs.length < total;

  // Top-strip stats
  const visibleCount = jobs.length;
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (industry) parts.push(INDUSTRIES.find((i) => i.id === industry)?.label || industry);
    if (level) parts.push(LEVELS.find((l) => l.id === level)?.label || level);
    if (debouncedSearch) parts.push(`"${debouncedSearch}"`);
    return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
  }, [industry, level, debouncedSearch]);

  return (
    <div>
      {/* Hero strip */}
      <div className="mb-4 sm:mb-6">
        <h1 className="text-[24px] sm:text-[28px] font-[800] text-[#1A1A2E] leading-tight">
          Latest PM jobs <span className="text-[#6B7280] font-[500]">across 243 companies</span>
        </h1>
        <p className="text-[13px] text-[#6B7280] mt-1">
          {loading ? "Loading…" : `${total.toLocaleString()} active jobs${filterSummary} · updated daily at 14:00 UTC`}
        </p>
      </div>

      {/* Filter bar */}
      <div className="mb-4 space-y-2">
        {/* Search + level filters on the same row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-[280px]">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search role or company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-[#E5E7EB] bg-white text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#0EA5E9] focus:ring-1 focus:ring-[#0EA5E9]/30 transition-all"
            />
          </div>
          {LEVELS.map((l) => {
            const active = level === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setLevel(active ? null : l.id)}
                className={`px-3 py-1.5 text-[12px] font-semibold rounded-full border transition-colors ${
                  active
                    ? "border-transparent text-white"
                    : "border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F8FAFC]"
                }`}
                style={
                  active
                    ? { backgroundColor: LEVEL_PILL[l.id].text }
                    : undefined
                }
              >
                {l.label}
              </button>
            );
          })}
        </div>

        {/* Industry chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setIndustry(null)}
            className={`px-3 py-1 text-[12px] font-medium rounded-full border transition-colors ${
              industry === null
                ? "bg-[#1A1A2E] border-[#1A1A2E] text-white"
                : "bg-white border-[#E5E7EB] text-[#6B7280] hover:bg-[#F8FAFC]"
            }`}
          >
            All industries
          </button>
          {INDUSTRIES.map((ind) => {
            const active = industry === ind.id;
            return (
              <button
                key={ind.id}
                onClick={() => setIndustry(active ? null : ind.id)}
                className={`px-3 py-1 text-[12px] font-medium rounded-full border transition-colors ${
                  active
                    ? "bg-[#0EA5E9] border-[#0EA5E9] text-white"
                    : "bg-white border-[#E5E7EB] text-[#6B7280] hover:bg-[#F8FAFC]"
                }`}
              >
                {ind.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Job list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-pulse flex items-center gap-2 text-stone-500">
            Loading latest jobs…
          </div>
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
          <p className="text-stone-600">
            No jobs match these filters. Try clearing the industry or level.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <ul className="divide-y divide-stone-100">
            {jobs.map((job) => {
              const isSubscribed = subscribedCompanyIds.has(job.company.id);
              const isTracking = trackingInFlight.has(job.company.id);
              const brandColor = getBrandColor(job.company.name);
              const softBg = softenColor(brandColor, 0.92);
              const favicon = getFaviconUrl(job.company.name, job.company.careers_url);
              return (
                <li
                  key={job.id}
                  className="px-4 sm:px-5 py-3.5 hover:bg-[#F8FAFC] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Logo + company column */}
                    <div className="shrink-0 mt-0.5">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden border"
                        style={{ backgroundColor: softBg, borderColor: softenColor(brandColor, 0.75) }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={favicon}
                          alt=""
                          width={20}
                          height={20}
                          className="rounded"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                    </div>

                    {/* Main content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-[14px] text-[#1A1A2E]">{job.company.name}</span>
                        <span className="text-[11px] text-stone-400 uppercase tracking-wide">
                          {job.company.industry}
                        </span>
                        <span className="text-[12px] text-stone-400 ml-auto">{timeAgo(job.firstSeenAt)}</span>
                      </div>
                      <a
                        href={buildJobUrl(job.urlPath, job.company.careers_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block mt-0.5 text-[15px] text-[#0EA5E9] hover:underline font-medium leading-snug"
                      >
                        {job.title}
                      </a>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[12px] text-stone-500">
                        {job.level && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[11px] font-semibold"
                            style={{
                              backgroundColor: LEVEL_PILL[job.level].bg,
                              color: LEVEL_PILL[job.level].text,
                            }}
                          >
                            {LEVELS.find((l) => l.id === job.level)?.label}
                          </span>
                        )}
                        {job.location && (
                          <span className="inline-flex items-center gap-1">
                            <svg
                              className="w-3 h-3 shrink-0"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                            {job.location}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions column */}
                    <div className="shrink-0 flex items-center gap-2 ml-2">
                      <button
                        onClick={() => handleTrack(job.company.id, job.company.name)}
                        disabled={isTracking || isSubscribed}
                        className={`text-[12px] font-semibold px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${
                          isSubscribed
                            ? "border-green-200 bg-green-50 text-green-700 cursor-default"
                            : isTracking
                            ? "border-stone-200 bg-stone-50 text-stone-400 cursor-wait"
                            : "border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F8FAFC] hover:text-[#1A1A2E]"
                        }`}
                        title={
                          isSubscribed
                            ? `You're tracking ${job.company.name}`
                            : isAuthed
                            ? `Track ${job.company.name}`
                            : "Sign in to track this company"
                        }
                      >
                        {isSubscribed ? "✓ Tracking" : isTracking ? "…" : "+ Track"}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <div className="px-4 py-3 border-t border-stone-100 text-center">
              <button
                onClick={() => fetchFeed({ reset: false })}
                disabled={loadingMore}
                className="text-[13px] font-semibold text-[#0EA5E9] hover:text-[#0284C7] disabled:text-stone-400 transition-colors"
              >
                {loadingMore ? "Loading…" : `Load more (${(total - jobs.length).toLocaleString()} remaining)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
