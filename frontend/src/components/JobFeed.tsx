"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { getBrandColor, getFaviconUrl, softenColor } from "@/lib/brandColors";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const PAGE_SIZE = 50;

// Industries: DB values (left) mapped to display labels (right). Healthcare
// renamed to "Health-tech" in UI to make the consumer-health + medical-devices
// scope clearer ("biotech" is the lab-research bucket).
const INDUSTRIES: { id: string; label: string }[] = [
  { id: "tech", label: "Tech" },
  { id: "fintech", label: "Fintech" },
  { id: "biotech", label: "Biotech" },
  { id: "hardware", label: "Hardware" },
  { id: "consumer", label: "Consumer" },
  { id: "gaming", label: "Gaming" },
  { id: "media", label: "Media" },
  { id: "banking", label: "Banking" },
  { id: "consulting", label: "Consulting" },
  { id: "healthcare", label: "Health-tech" },
];

// Sorted junior → director (per user feedback: low-to-high seniority).
type LevelId = "early" | "mid" | "director";
const LEVELS: { id: LevelId; label: string }[] = [
  { id: "early", label: "Junior" },
  { id: "mid", label: "Mid" },
  { id: "director", label: "Director+" },
];

const LEVEL_PILL: Record<LevelId, { bg: string; text: string }> = {
  early: { bg: "rgb(219 234 254)", text: "rgb(29 78 216)" },
  mid: { bg: "rgb(254 243 199)", text: "rgb(180 83 9)" },
  director: { bg: "rgb(237 233 254)", text: "rgb(109 40 217)" },
};

// US regions for the location filter. Patterns matched in priority order
// (cities first, then state names, then abbreviations) — state abbreviations
// like "WA" are short and need a word-boundary anchor to avoid false matches.
type RegionId = "west" | "northeast" | "midwest" | "south";
const REGIONS: { id: RegionId; label: string; stateAbbrs: string[]; stateNames: string[]; cities: string[] }[] = [
  {
    id: "west",
    label: "West",
    stateAbbrs: ["CA", "OR", "WA", "NV", "AZ", "UT", "CO", "NM", "ID", "MT", "WY", "AK", "HI"],
    stateNames: ["California", "Oregon", "Washington", "Nevada", "Arizona", "Utah", "Colorado", "New Mexico", "Idaho", "Montana", "Wyoming", "Alaska", "Hawaii"],
    cities: ["San Francisco", "Los Angeles", "San Diego", "Seattle", "Portland", "Denver", "Phoenix", "Las Vegas", "Salt Lake City", "Sacramento", "Oakland", "San Jose", "Berkeley", "Palo Alto", "Mountain View", "Menlo Park", "Cupertino", "Sunnyvale", "Santa Clara", "Bellevue", "Redmond", "Albuquerque", "Tucson", "Boise", "Boulder"],
  },
  {
    id: "northeast",
    label: "Northeast",
    stateAbbrs: ["ME", "NH", "VT", "MA", "RI", "CT", "NY", "NJ", "PA"],
    stateNames: ["Maine", "New Hampshire", "Vermont", "Massachusetts", "Rhode Island", "Connecticut", "New York", "New Jersey", "Pennsylvania"],
    cities: ["New York", "NYC", "Boston", "Philadelphia", "Pittsburgh", "Newark", "Jersey City", "Brooklyn", "Manhattan", "Cambridge", "Hartford"],
  },
  {
    id: "midwest",
    label: "Midwest",
    stateAbbrs: ["OH", "IN", "IL", "MI", "WI", "MO", "IA", "KS", "NE", "ND", "SD", "MN"],
    stateNames: ["Ohio", "Indiana", "Illinois", "Michigan", "Wisconsin", "Missouri", "Iowa", "Kansas", "Nebraska", "North Dakota", "South Dakota", "Minnesota"],
    cities: ["Chicago", "Detroit", "Indianapolis", "Columbus", "Milwaukee", "Minneapolis", "St. Paul", "St. Louis", "Kansas City", "Cleveland", "Cincinnati", "Omaha"],
  },
  {
    id: "south",
    label: "South",
    stateAbbrs: ["DE", "MD", "DC", "VA", "WV", "NC", "SC", "GA", "FL", "KY", "TN", "AL", "MS", "AR", "LA", "OK", "TX"],
    stateNames: ["Delaware", "Maryland", "Washington DC", "Virginia", "West Virginia", "North Carolina", "South Carolina", "Georgia", "Florida", "Kentucky", "Tennessee", "Alabama", "Mississippi", "Arkansas", "Louisiana", "Oklahoma", "Texas"],
    cities: ["Atlanta", "Miami", "Orlando", "Tampa", "Jacksonville", "Charlotte", "Raleigh", "Durham", "Nashville", "Memphis", "New Orleans", "Houston", "Dallas", "Austin", "San Antonio", "Plano", "Arlington", "Richmond", "Norfolk", "Louisville", "Birmingham"],
  },
];

function detectRegion(location: string | null | undefined): RegionId | null {
  if (!location) return null;
  const loc = location.toLowerCase();
  for (const region of REGIONS) {
    for (const city of region.cities) {
      if (loc.includes(city.toLowerCase())) return region.id;
    }
    for (const name of region.stateNames) {
      if (loc.includes(name.toLowerCase())) return region.id;
    }
    for (const abbr of region.stateAbbrs) {
      // Word-boundary match for 2-letter abbreviations
      const re = new RegExp(`\\b${abbr}\\b`);
      if (re.test(location)) return region.id;
    }
  }
  return null;
}

interface FeedJob {
  id: string;
  title: string;
  location: string | null;
  urlPath: string;
  firstSeenAt: string;
  level: LevelId | null;
  status: string | null;
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

  // Server-side filters
  const [industry, setIndustry] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelId | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);

  // Client-side filters (location is computed from the location string,
  // can't easily be done in SQL without parsing on the backend)
  const [region, setRegion] = useState<RegionId | null>(null);
  const [city, setCity] = useState("");

  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [subscribedCompanyIds, setSubscribedCompanyIds] = useState<Set<string>>(new Set());
  const [trackingInFlight, setTrackingInFlight] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

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
          // best-effort
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
      if (includeClosed) params.set("include_closed", "true");

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
    [industry, level, debouncedSearch, includeClosed, offset, showToast]
  );

  // Reset + refetch when server-side filters change
  useEffect(() => {
    fetchFeed({ reset: true, offsetOverride: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [industry, level, debouncedSearch, includeClosed]);

  // Apply client-side filters (region + city) on top of server data
  const cityLower = city.trim().toLowerCase();
  const visibleJobs = useMemo(() => {
    if (!region && !cityLower) return jobs;
    return jobs.filter((j) => {
      if (region && detectRegion(j.location) !== region) return false;
      if (cityLower && !(j.location || "").toLowerCase().includes(cityLower)) return false;
      return true;
    });
  }, [jobs, region, cityLower]);

  const handleTrack = async (companyId: string, companyName: string) => {
    if (!isAuthed) {
      router.push(`/login?next=${encodeURIComponent("/new-home")}`);
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
  const clientFilteredOut = jobs.length - visibleJobs.length;

  // -------- Render --------
  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[26px] sm:text-[30px] font-[800] text-[#1A1A2E] leading-tight">
          Latest PM jobs
        </h1>
        <p className="text-[14px] text-[#6B7280] mt-1">
          {loading ? (
            "Loading…"
          ) : (
            <>
              <span className="font-semibold text-[#1A1A2E]">{total.toLocaleString()}</span> active jobs across <span className="font-semibold text-[#1A1A2E]">243 companies</span> · updated daily at 14:00 UTC
            </>
          )}
        </p>
      </div>

      {/* Search — own line */}
      <div className="mb-3">
        <div className="relative max-w-[420px]">
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
            placeholder="Search role title or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-[#E5E7EB] bg-white text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#0EA5E9] focus:ring-1 focus:ring-[#0EA5E9]/30 transition-all"
          />
        </div>
      </div>

      {/* Level row */}
      <FilterRow label="Level">
        {LEVELS.map((l) => (
          <Chip
            key={l.id}
            active={level === l.id}
            onClick={() => setLevel(level === l.id ? null : l.id)}
            activeBg={LEVEL_PILL[l.id].text}
          >
            {l.label}
          </Chip>
        ))}
      </FilterRow>

      {/* Industry row */}
      <FilterRow label="Industry">
        <Chip active={industry === null} onClick={() => setIndustry(null)} activeBg="#1A1A2E">
          All
        </Chip>
        {INDUSTRIES.map((ind) => (
          <Chip
            key={ind.id}
            active={industry === ind.id}
            onClick={() => setIndustry(industry === ind.id ? null : ind.id)}
            activeBg="#0EA5E9"
          >
            {ind.label}
          </Chip>
        ))}
      </FilterRow>

      {/* Location row */}
      <FilterRow label="Region">
        <Chip active={region === null} onClick={() => setRegion(null)} activeBg="#1A1A2E">
          All US
        </Chip>
        {REGIONS.map((r) => (
          <Chip
            key={r.id}
            active={region === r.id}
            onClick={() => setRegion(region === r.id ? null : r.id)}
            activeBg="#0EA5E9"
          >
            {r.label}
          </Chip>
        ))}
        <input
          type="text"
          placeholder="City…"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="ml-2 px-2.5 py-1 text-[12px] rounded-full border border-[#E5E7EB] bg-white text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#0EA5E9] focus:ring-1 focus:ring-[#0EA5E9]/30 transition-all w-[140px]"
        />
      </FilterRow>

      {/* Closed-jobs toggle */}
      <div className="mb-5">
        <label className="inline-flex items-center gap-2 text-[12px] text-[#6B7280] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
            className="rounded border-stone-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
          />
          Include closed jobs (filled or removed in the last 60 days)
        </label>
      </div>

      {/* Job list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-pulse flex items-center gap-2 text-stone-500">Loading latest jobs…</div>
        </div>
      ) : visibleJobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
          <p className="text-stone-600">
            {jobs.length === 0
              ? "No jobs match these filters. Try clearing the industry, level, or search."
              : `${clientFilteredOut} jobs hidden by the region/city filter. Clear or change region to see more.`}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <ul className="divide-y divide-stone-100">
            {visibleJobs.map((job) => {
              const isSubscribed = subscribedCompanyIds.has(job.company.id);
              const isTracking = trackingInFlight.has(job.company.id);
              const brandColor = getBrandColor(job.company.name);
              const softBg = softenColor(brandColor, 0.92);
              const favicon = getFaviconUrl(job.company.name, job.company.careers_url);
              const industryLabel = INDUSTRIES.find((i) => i.id === job.company.industry)?.label || job.company.industry;
              const isClosed = job.status === "removed";

              return (
                <li
                  key={job.id}
                  className={`px-4 sm:px-5 py-3.5 hover:bg-[#F8FAFC] transition-colors ${isClosed ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start gap-3">
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

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-[14px] text-[#1A1A2E]">{job.company.name}</span>
                        <span className="text-[11px] text-stone-400 uppercase tracking-wide">{industryLabel}</span>
                        {isClosed && (
                          <span className="text-[11px] text-red-500 uppercase tracking-wide font-semibold">closed</span>
                        )}
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

// -------- Small helpers (inline rather than a separate file — single use) --------

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold w-[60px] shrink-0">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  activeBg,
  children,
}: {
  active: boolean;
  onClick: () => void;
  activeBg?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-[12px] font-medium rounded-full border transition-colors ${
        active
          ? "border-transparent text-white"
          : "bg-white border-[#E5E7EB] text-[#6B7280] hover:bg-[#F8FAFC]"
      }`}
      style={active && activeBg ? { backgroundColor: activeBg } : undefined}
    >
      {children}
    </button>
  );
}
