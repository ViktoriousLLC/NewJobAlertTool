"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { isUSLocation, JobLevel, LEVEL_LABELS, LEVEL_COLORS, ALL_LEVELS } from "@/lib/jobFilters";
import { useToast } from "@/components/Toast";

interface ApiJob {
  id: string;
  company_id: string;
  company_name: string;
  careers_url: string;
  job_title: string;
  job_location: string | null;
  job_url_path: string;
  first_seen_at: string;
  is_baseline: boolean;
  job_level?: string;
  status?: string;
}

interface CompTier {
  min: number;
  max: number;
}

interface CompDataMap {
  [companyName: string]: {
    tiers: { early?: CompTier; mid?: CompTier; director?: CompTier };
    levelsFyiUrl: string;
  };
}

interface FlatJob {
  id: string;
  companyName: string;
  careersUrl: string;
  jobTitle: string;
  jobLocation: string | null;
  jobUrlPath: string;
  firstSeenAt: string;
  jobLevel: JobLevel;
}

type SortKey = "company" | "title" | "location" | "level" | "salary" | "date";
type SortDir = "asc" | "desc";

const LEVEL_ORDER: Record<JobLevel, number> = { early: 0, mid: 1, director: 2 };

export default function AllJobsPageWrapper() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse flex items-center gap-2 text-stone-500">Loading...</div>
      </div>
    }>
      <AllJobsPage />
    </Suspense>
  );
}

function AllJobsPage() {
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<FlatJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [usOnly, setUsOnly] = useState(true);
  const [levelFilter, setLevelFilter] = useState<Set<JobLevel>>(new Set(ALL_LEVELS));
  const starredOnly = searchParams.get("filter") === "starred";
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [justStarred, setJustStarred] = useState<Set<string>>(new Set());
  const [showSalary, setShowSalary] = useState(true);
  const [compData, setCompData] = useState<CompDataMap>({});
  const [sortKey, setSortKey] = useState<SortKey>("company");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function fetchAllJobs() {
      try {
        // Single /api/jobs call replaces N+1 company detail fetches
        const fetches: Promise<Response>[] = [
          apiFetch("/api/jobs"),
          apiFetch("/api/favorites"),
        ];

        // Fetch comp data in parallel if starred mode
        const isStarred = searchParams.get("filter") === "starred";
        if (isStarred) {
          fetches.push(apiFetch("/api/compensation"));
        }

        const responses = await Promise.all(fetches);

        const apiJobs: ApiJob[] = await responses[0].json();

        try {
          const favIds: string[] = await responses[1].json();
          setFavorites(new Set(favIds));
        } catch {
          // ignore
        }

        if (isStarred && responses[2]) {
          try {
            const data = await responses[2].json();
            setCompData(data || {});
          } catch {
            // No comp data — that's fine
          }
        }

        // Map API response to FlatJob format
        const flat: FlatJob[] = apiJobs.map((j) => ({
          id: j.id,
          companyName: j.company_name,
          careersUrl: j.careers_url,
          jobTitle: j.job_title,
          jobLocation: j.job_location,
          jobUrlPath: j.job_url_path,
          firstSeenAt: j.first_seen_at,
          jobLevel: (j.job_level || "early") as JobLevel,
        }));

        // Default sort by company name, then newest first
        flat.sort((a, b) => {
          const cmp = a.companyName.localeCompare(b.companyName);
          if (cmp !== 0) return cmp;
          return new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime();
        });

        setJobs(flat);
      } catch (err) {
        console.error("Failed to fetch jobs:", err);
        showToast("Failed to load jobs. Please refresh.");
      } finally {
        setLoading(false);
      }
    }
    fetchAllJobs();
  }, [searchParams]);

  function toggleLevel(level: JobLevel) {
    setLevelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  async function toggleFavorite(jobId: string) {
    const isFav = favorites.has(jobId);
    trackEvent(isFav ? "job_unstarred" : "job_starred", { job_id: jobId });
    setFavorites((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(jobId);
      else next.add(jobId);
      return next;
    });

    // Trigger pop animation on star (not unstar)
    if (!isFav) {
      setJustStarred((prev) => new Set(prev).add(jobId));
      setTimeout(() => setJustStarred((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      }), 350);
    }

    try {
      if (isFav) {
        await apiFetch(`/api/favorites/${jobId}`, { method: "DELETE" });
      } else {
        await apiFetch(`/api/favorites/${jobId}`, { method: "POST" });
      }
    } catch {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (isFav) next.add(jobId);
        else next.delete(jobId);
        return next;
      });
    }
  }

  function buildJobUrl(urlPath: string, careersUrl: string) {
    if (urlPath.startsWith("http")) return urlPath;
    try {
      return new URL(urlPath, careersUrl).href;
    } catch {
      return urlPath;
    }
  }

  function getSalaryRange(job: FlatJob): { min: number; max: number } | null {
    const cd = compData[job.companyName];
    if (!cd?.tiers) return null;
    const tier = cd.tiers[job.jobLevel];
    if (!tier) return null;
    return tier;
  }

  function formatComp(amount: number): string {
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
    return `$${Math.round(amount / 1000)}K`;
  }

  function salaryMidpoint(job: FlatJob): number {
    const range = getSalaryRange(job);
    if (!range) return 0;
    return (range.min + range.max) / 2;
  }

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  // Filter
  const searchLower = search.toLowerCase();
  let filteredJobs = jobs.filter((job) => {
    if (search && !job.jobTitle.toLowerCase().includes(searchLower) && !(job.jobLocation || "").toLowerCase().includes(searchLower)) return false;
    if (usOnly && !isUSLocation(job.jobLocation)) return false;
    if (!levelFilter.has(job.jobLevel)) return false;
    return true;
  });

  if (starredOnly) {
    filteredJobs = filteredJobs.filter((job) => favorites.has(job.id));
  }

  // Sort (starred mode only uses custom sort, browse mode uses default)
  if (starredOnly) {
    const dir = sortDir === "asc" ? 1 : -1;
    filteredJobs = [...filteredJobs].sort((a, b) => {
      switch (sortKey) {
        case "company":
          return dir * a.companyName.localeCompare(b.companyName);
        case "title":
          return dir * a.jobTitle.localeCompare(b.jobTitle);
        case "location":
          return dir * (a.jobLocation || "").localeCompare(b.jobLocation || "");
        case "level":
          return dir * (LEVEL_ORDER[a.jobLevel] - LEVEL_ORDER[b.jobLevel]);
        case "salary":
          return dir * (salaryMidpoint(a) - salaryMidpoint(b));
        case "date":
          return dir * (new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime());
        default:
          return 0;
      }
    });
  }

  function SortHeader({ label, sortKeyName, className }: { label: string; sortKeyName: SortKey; className?: string }) {
    if (!starredOnly) {
      return <th className={`text-left px-5 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider ${className || ""}`}>{label}</th>;
    }
    const isActive = sortKey === sortKeyName;
    return (
      <th
        className={`text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:text-stone-700 select-none ${isActive ? "text-stone-800" : "text-stone-500"} ${className || ""}`}
        onClick={() => handleSort(sortKeyName)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {isActive && (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 12 12">
              {sortDir === "asc" ? (
                <path d="M6 2l4 5H2l4-5z" />
              ) : (
                <path d="M6 10L2 5h8l-4 5z" />
              )}
            </svg>
          )}
        </span>
      </th>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse flex items-center gap-2 text-stone-500">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading all jobs...
        </div>
      </div>
    );
  }

  const showSalaryCol = starredOnly && showSalary;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[24px] font-[800] text-[#1A1A2E]">
          {starredOnly ? "Starred Jobs" : "All Jobs"}
          <span className="text-[13px] font-normal text-[#6B7280] ml-3">
            {filteredJobs.length} jobs{starredOnly ? " in your shortlist" : " across all companies"}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative max-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search jobs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-[#E5E7EB] bg-white text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#0EA5E9] focus:ring-1 focus:ring-[#0EA5E9]/30 transition-all"
            />
          </div>
          {ALL_LEVELS.map((level) => (
            <label
              key={level}
              className="flex items-center gap-1.5 text-sm cursor-pointer select-none bg-white border border-stone-200 px-3 py-2 rounded-lg hover:bg-[#F8FAFC] transition-colors"
            >
              <input
                type="checkbox"
                checked={levelFilter.has(level)}
                onChange={() => toggleLevel(level)}
                className="rounded border-stone-300 text-[var(--brand)] focus:ring-[var(--brand)]"
              />
              <span
                className="px-1.5 py-0.5 rounded text-xs font-semibold"
                style={{ backgroundColor: LEVEL_COLORS[level].bg, color: LEVEL_COLORS[level].text }}
              >
                {LEVEL_LABELS[level]}
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer select-none bg-white border border-stone-200 px-3 py-2 rounded-lg hover:bg-[#F8FAFC] transition-colors">
            <input
              type="checkbox"
              checked={usOnly}
              onChange={(e) => setUsOnly(e.target.checked)}
              className="rounded border-stone-300 text-[var(--brand)] focus:ring-[var(--brand)]"
            />
            US only
          </label>
          {starredOnly && (
            <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer select-none bg-white border border-stone-200 px-3 py-2 rounded-lg hover:bg-[#F8FAFC] transition-colors">
              <input
                type="checkbox"
                checked={showSalary}
                onChange={(e) => setShowSalary(e.target.checked)}
                className="rounded border-stone-300 text-[var(--brand)] focus:ring-[var(--brand)]"
              />
              Show Salary
            </label>
          )}
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
          <p className="text-stone-600">
            {starredOnly
              ? "No starred jobs yet. Click the star icon on any job to add it to your shortlist."
              : usOnly
              ? "No jobs found in the US."
              : "No jobs found."}
          </p>
          {starredOnly && (
            <a
              href="/jobs"
              className="mt-2 text-[var(--brand)] hover:underline text-sm inline-block"
            >
              View all jobs
            </a>
          )}
          {!starredOnly && usOnly && (
            <button
              onClick={() => setUsOnly(false)}
              className="mt-2 text-[var(--brand)] hover:underline text-sm"
            >
              Show all locations
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[5%]" />
                <col className="w-[11%]" />
                <col className={showSalaryCol ? "w-[26%]" : "w-[30%]"} />
                <col className={showSalaryCol ? "w-[20%]" : "w-[24%]"} />
                <col className="w-[8%]" />
                {showSalaryCol && <col className="w-[12%]" />}
                <col className="w-[12%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-stone-200 bg-[#F8FAFC]">
                  <th className="px-3 py-3"></th>
                  <SortHeader label="Company" sortKeyName="company" />
                  <SortHeader label="Job Title" sortKeyName="title" />
                  <SortHeader label="Location" sortKeyName="location" />
                  <SortHeader label="Level" sortKeyName="level" />
                  {showSalaryCol && <SortHeader label="Salary Est." sortKeyName="salary" />}
                  <SortHeader label="Date Added" sortKeyName="date" />
                  <th className="text-right px-5 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredJobs.map((job, idx) => {
                  const isFirstInGroup = idx === 0 || filteredJobs[idx - 1].companyName !== job.companyName;
                  const isFav = favorites.has(job.id);
                  const salaryRange = showSalaryCol ? getSalaryRange(job) : null;
                  return (<>
                  {isFirstInGroup && idx !== 0 && (
                    <tr key={`divider-${job.id}`} className="border-t-4 border-stone-300"><td colSpan={showSalaryCol ? 8 : 7} className="h-0 p-0"></td></tr>
                  )}
                  <tr key={job.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-3 py-3.5 text-center">
                      <button
                        onClick={() => toggleFavorite(job.id)}
                        className="hover:scale-110 transition-transform"
                        title={isFav ? "Remove from starred" : "Add to starred"}
                      >
                        {isFav ? (
                          <svg className={`w-5 h-5 text-amber-400${justStarred.has(job.id) ? " animate-star-pop" : ""}`} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-stone-300 hover:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                        )}
                      </button>
                    </td>
                    <td className="px-5 py-3.5 text-sm font-bold text-[#1A1A2E] truncate" title={job.companyName}>
                      {job.companyName}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-stone-700 truncate" title={job.jobTitle}>
                      {job.jobTitle}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-stone-500">
                      {job.jobLocation ? (
                        <span className="flex items-center gap-1 truncate" title={job.jobLocation}>
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span className="truncate">{job.jobLocation}</span>
                        </span>
                      ) : (
                        <span className="text-stone-300">&mdash;</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-semibold"
                        style={{ backgroundColor: LEVEL_COLORS[job.jobLevel].bg, color: LEVEL_COLORS[job.jobLevel].text }}
                      >
                        {LEVEL_LABELS[job.jobLevel]}
                      </span>
                    </td>
                    {showSalaryCol && (
                      <td className="px-5 py-3.5 text-sm text-stone-600 whitespace-nowrap">
                        {salaryRange ? (
                          <span className="font-medium">{formatComp(salaryRange.min)}&ndash;{formatComp(salaryRange.max)}</span>
                        ) : (
                          <span className="text-stone-300">&mdash;</span>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3.5 text-sm text-stone-500 whitespace-nowrap">
                      {new Date(job.firstSeenAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <a
                        href={buildJobUrl(job.jobUrlPath, job.careersUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--brand)] hover:text-[var(--brand-hover)] text-sm font-medium inline-flex items-center gap-1 hover:underline"
                      >
                        View
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </td>
                  </tr>
                  </>);
                })}
              </tbody>
            </table>
          </div>
          {showSalaryCol && (
            <div className="mt-3 text-right">
              <span className="text-xs text-stone-400">Salary data source: Levels.fyi</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
