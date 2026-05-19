"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { getBrandColor, getFaviconUrl, getFaviconFallbackUrl, softenColor } from "@/lib/brandColors";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const PAGE_SIZE = 50;

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

type SortId = "latest" | "oldest" | "company";
const SORTS: { id: SortId; label: string }[] = [
  { id: "latest", label: "Latest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "company", label: "Company A → Z" },
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

interface CompanyOption {
  id: string;
  name: string;
  industry: string;
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
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
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
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelId | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [sort, setSort] = useState<SortId>("latest");

  // Client-side filters
  const [region, setRegion] = useState<RegionId | null>(null);
  const [city, setCity] = useState("");

  // Company list (for the cascading dropdown)
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([]);

  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [subscribedCompanyIds, setSubscribedCompanyIds] = useState<Set<string>>(new Set());
  const [trackingInFlight, setTrackingInFlight] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch the company list once for the dropdown.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/feed/companies`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CompanyOption[]) => {
        if (!cancelled) setAllCompanies(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Session + subscriptions for the Track button state.
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

  // Reset company selection when industry changes (cascading semantics).
  useEffect(() => {
    if (companyId) {
      const c = allCompanies.find((x) => x.id === companyId);
      if (industry && c && c.industry !== industry) setCompanyId(null);
    }
  }, [industry, companyId, allCompanies]);

  const fetchFeed = useCallback(
    async (opts: { reset: boolean; offsetOverride?: number }) => {
      if (opts.reset) setLoading(true);
      else setLoadingMore(true);

      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(opts.offsetOverride ?? (opts.reset ? 0 : offset)));
      params.set("sort", sort);
      if (industry) params.set("industry", industry);
      if (companyId) params.set("company", companyId);
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
    [industry, companyId, level, debouncedSearch, includeClosed, sort, offset, showToast]
  );

  // Reset + refetch on server-side filter change
  useEffect(() => {
    fetchFeed({ reset: true, offsetOverride: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [industry, companyId, level, debouncedSearch, includeClosed, sort]);

  // Client-side: region + city narrow further
  const cityLower = city.trim().toLowerCase();
  const visibleJobs = useMemo(() => {
    if (!region && !cityLower) return jobs;
    return jobs.filter((j) => {
      if (region && detectRegion(j.location) !== region) return false;
      if (cityLower && !(j.location || "").toLowerCase().includes(cityLower)) return false;
      return true;
    });
  }, [jobs, region, cityLower]);

  // Company dropdown options scoped to the current industry
  const companyOptions = useMemo(() => {
    if (!industry) return allCompanies;
    return allCompanies.filter((c) => c.industry === industry);
  }, [industry, allCompanies]);

  const handleTrack = async (cid: string, companyName: string) => {
    if (!isAuthed) {
      router.push(`/login?next=${encodeURIComponent("/new-home")}`);
      return;
    }
    if (subscribedCompanyIds.has(cid)) return;
    setTrackingInFlight((prev) => new Set(prev).add(cid));
    try {
      const res = await apiFetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_ids: [cid] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubscribedCompanyIds((prev) => new Set(prev).add(cid));
      showToast(`Tracking ${companyName}. You'll get emails when they post new PM roles.`);
    } catch {
      showToast("Couldn't track this company. Please try again.");
    } finally {
      setTrackingInFlight((prev) => {
        const next = new Set(prev);
        next.delete(cid);
        return next;
      });
    }
  };

  const hasMore = jobs.length < total;
  const clientFilteredOut = jobs.length - visibleJobs.length;

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
              <span className="font-semibold text-[#1A1A2E]">{total.toLocaleString()}</span> active jobs across <span className="font-semibold text-[#1A1A2E]">{allCompanies.length || 243}</span> companies · updated daily at 14:00 UTC
            </>
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative w-full sm:w-auto sm:max-w-[280px] sm:flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search role title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-[#E5E7EB] bg-white text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#0EA5E9] focus:ring-1 focus:ring-[#0EA5E9]/30 transition-all"
            />
          </div>
          {/* Sort dropdown */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortId)}
            className="px-3 py-2 text-[12px] rounded-lg border border-[#E5E7EB] bg-white text-[#1A1A2E] focus:outline-none focus:border-[#0EA5E9] focus:ring-1 focus:ring-[#0EA5E9]/30 transition-all"
            aria-label="Sort"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>Sort: {s.label}</option>
            ))}
          </select>
        </div>
      </div>

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

      <FilterRow label="Industry">
        <Chip active={industry === null} onClick={() => setIndustry(null)} activeBg="#1A1A2E">All</Chip>
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

      <FilterRow label="Company">
        <select
          value={companyId || ""}
          onChange={(e) => setCompanyId(e.target.value || null)}
          className="px-3 py-1 text-[12px] rounded-full border border-[#E5E7EB] bg-white text-[#1A1A2E] focus:outline-none focus:border-[#0EA5E9] focus:ring-1 focus:ring-[#0EA5E9]/30 transition-all max-w-[240px]"
          aria-label="Company"
        >
          <option value="">
            {industry
              ? `All ${INDUSTRIES.find((i) => i.id === industry)?.label || industry} companies (${companyOptions.length})`
              : `All companies (${allCompanies.length})`}
          </option>
          {companyOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {companyId && (
          <button
            onClick={() => setCompanyId(null)}
            className="text-[11px] text-stone-500 hover:text-stone-700 underline"
          >
            clear
          </button>
        )}
      </FilterRow>

      <FilterRow label="Region">
        <Chip active={region === null} onClick={() => setRegion(null)} activeBg="#1A1A2E">All US</Chip>
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

      <div className="mb-5">
        <label className="inline-flex items-center gap-2 text-[12px] text-[#6B7280] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
            className="rounded border-stone-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
          />
          Include closed jobs (removed in the last 60 days)
        </label>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-pulse flex items-center gap-2 text-stone-500">Loading latest jobs…</div>
        </div>
      ) : visibleJobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
          <p className="text-stone-600">
            {jobs.length === 0
              ? "No jobs match these filters. Try clearing the industry, company, or search."
              : `${clientFilteredOut} jobs hidden by the region/city filter. Clear or change region to see more.`}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed min-w-[800px]">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[36%]" />
                <col className="w-[20%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-stone-200 bg-[#F8FAFC]">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Company</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Title</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Location</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Level</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Posted</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Track</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {visibleJobs.map((job) => {
                  const isSubscribed = subscribedCompanyIds.has(job.company.id);
                  const isTracking = trackingInFlight.has(job.company.id);
                  const isClosed = job.status === "removed";
                  return (
                    <tr
                      key={job.id}
                      className={`hover:bg-[#F8FAFC] transition-colors ${isClosed ? "opacity-60" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <CompanyCell company={job.company} />
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={buildJobUrl(job.urlPath, job.company.careers_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[14px] text-[#0EA5E9] hover:underline font-medium"
                          title={job.title}
                        >
                          {job.title}
                          {isClosed && <span className="ml-2 text-[10px] text-red-500 uppercase tracking-wide font-semibold">closed</span>}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-stone-600 truncate" title={job.location || ""}>
                        {job.location || <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {job.level ? (
                          <span
                            className="px-1.5 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap"
                            style={{
                              backgroundColor: LEVEL_PILL[job.level].bg,
                              color: LEVEL_PILL[job.level].text,
                            }}
                          >
                            {LEVELS.find((l) => l.id === job.level)?.label}
                          </span>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-stone-500 whitespace-nowrap">
                        {timeAgo(job.firstSeenAt)} ago
                      </td>
                      <td className="px-4 py-3 text-right">
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
                        >
                          {isSubscribed ? "✓" : isTracking ? "…" : "+ Track"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

// ------------------------------------------------------------
// Company cell with tiered logo fallback. Background is always the
// brand-colored chip with the first letter, so even when both CDNs fail
// the user sees a visual identifier. Image (DuckDuckGo first, Google
// second) loads on top via two onError swaps.
// ------------------------------------------------------------
function CompanyCell({ company }: { company: { id: string; name: string; careers_url: string; industry: string } }) {
  const brand = getBrandColor(company.name);
  const softBg = softenColor(brand, 0.82);
  const primaryUrl = getFaviconUrl(company.name, company.careers_url);
  const fallbackUrl = getFaviconFallbackUrl(company.name, company.careers_url);
  const initial = company.name.trim().charAt(0).toUpperCase();
  const industryLabel = INDUSTRIES.find((i) => i.id === company.industry)?.label || company.industry;

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div
        className="relative shrink-0 w-7 h-7 rounded-md flex items-center justify-center overflow-hidden border"
        style={{ backgroundColor: softBg, borderColor: softenColor(brand, 0.65) }}
      >
        {/* Always-visible chip background */}
        <span className="text-[11px] font-bold" style={{ color: brand }}>{initial}</span>
        {/* Logo image floats on top; on error swaps source, then disappears */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={primaryUrl}
          alt=""
          width={28}
          height={28}
          className="absolute inset-0 w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement & { dataset: DOMStringMap };
            if (img.dataset.fallback !== "1") {
              img.dataset.fallback = "1";
              img.src = fallbackUrl;
            } else {
              img.style.display = "none";
            }
          }}
        />
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-bold text-[#1A1A2E] truncate" title={company.name}>{company.name}</div>
        <div className="text-[10px] text-stone-400 uppercase tracking-wide truncate">{industryLabel}</div>
      </div>
    </div>
  );
}

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
        active ? "border-transparent text-white" : "bg-white border-[#E5E7EB] text-[#6B7280] hover:bg-[#F8FAFC]"
      }`}
      style={active && activeBg ? { backgroundColor: activeBg } : undefined}
    >
      {children}
    </button>
  );
}
