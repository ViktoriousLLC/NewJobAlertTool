"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { isUSLocation, JobLevel, LEVEL_LABELS, LEVEL_COLORS, ALL_LEVELS } from "@/lib/jobFilters";
import { useToast } from "@/components/Toast";

interface Job {
  id: string;
  job_title: string;
  job_location: string | null;
  job_url_path: string;
  first_seen_at: string;
  is_baseline: boolean;
  job_level?: string;
  status?: string;
}

interface CompanyDetail {
  id: string;
  name: string;
  careers_url: string;
  last_checked_at: string | null;
  last_check_status: string | null;
  total_product_jobs: number;
  jobs: Job[];
}

interface CompanySummary {
  id: string;
  name: string;
}

interface CompTier {
  min: number;
  max: number;
}

interface CompData {
  levels: { level: string; medianTC: number }[];
  overallMedianTC: number;
  tiers: { early?: CompTier; mid?: CompTier; director?: CompTier };
  levelsFyiUrl: string;
  attribution: string;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function CompanyDetailPage() {
  return (
    <Suspense>
      <CompanyDetailContent />
    </Suspense>
  );
}

function CompanyDetailContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const id = params.id as string;
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [usOnly, setUsOnly] = useState(true);
  const [levelFilter, setLevelFilter] = useState<Set<JobLevel>>(new Set(ALL_LEVELS));
  const [nextCompany, setNextCompany] = useState<CompanySummary | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [justStarred, setJustStarred] = useState<Set<string>>(new Set());
  const [showReportMenu, setShowReportMenu] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [showAddedToast, setShowAddedToast] = useState(false);
  const [compData, setCompData] = useState<CompData | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (searchParams.get("added") === "true") {
      setShowAddedToast(true);
      window.history.replaceState({}, "", `/company/${id}`);
      const timer = setTimeout(() => setShowAddedToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, id]);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch company detail + favorites in parallel (fast, renders page)
        const [detailRes, favRes] = await Promise.all([
          apiFetch(`/api/companies/${id}`),
          apiFetch("/api/favorites"),
        ]);

        if (!detailRes.ok) throw new Error("Not found");
        const detail = await detailRes.json();
        setCompany(detail);

        // Next company comes from the detail response (computed server-side)
        if (detail.next_company) {
          setNextCompany(detail.next_company);
        }

        // Load favorites
        try {
          const favIds: string[] = await favRes.json();
          setFavorites(new Set(favIds));
        } catch {
          // Favorites table may not exist yet
        }
      } catch (err) {
        console.error("Failed to fetch company:", err);
        showToast("Failed to load company details. Please refresh.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  // Lazy-load compensation data (non-blocking, loads after page renders)
  useEffect(() => {
    if (!company) return;
    apiFetch(`/api/compensation/${encodeURIComponent(company.name)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.levels?.length > 0) setCompData(data);
      })
      .catch(() => {});
  }, [company]);

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

  async function reportIssue(issueType: string) {
    if (!company) return;
    try {
      await apiFetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: company.id,
          issue_type: issueType,
        }),
      });
      setReportSubmitted(true);
      setShowReportMenu(false);
      setTimeout(() => setReportSubmitted(false), 3000);
    } catch (err) {
      console.error("Failed to report issue:", err);
      showToast("Failed to submit report. Please try again.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse flex items-center gap-2 text-stone-500">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading...
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-[#1A1A2E] mb-4">
          Company not found
        </h2>
        <Link href="/" className="text-[var(--brand)] hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  // Separate active jobs from removed/archived
  const activeJobs = company.jobs.filter((job) => !job.status || job.status === "active");
  const inactiveJobs = company.jobs.filter((job) => job.status === "removed" || job.status === "archived");
  const savedInactiveJobs = inactiveJobs.filter((job) => favorites.has(job.id));

  // Filter active jobs based on search, US-only toggle and level filter
  const searchLower = search.toLowerCase();
  const filteredJobs = activeJobs.filter((job) => {
    if (search && !job.job_title.toLowerCase().includes(searchLower) && !(job.job_location || "").toLowerCase().includes(searchLower)) return false;
    if (usOnly && !isUSLocation(job.job_location)) return false;
    const level = (job.job_level || "early") as JobLevel;
    if (!levelFilter.has(level)) return false;
    return true;
  });

  // Group jobs by date (already sorted newest first from API)
  const jobsByDate = new Map<string, Job[]>();
  for (const job of filteredJobs) {
    const date = new Date(job.first_seen_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (!jobsByDate.has(date)) jobsByDate.set(date, []);
    jobsByDate.get(date)!.push(job);
  }

  function buildJobUrl(urlPath: string) {
    if (urlPath.startsWith("http")) return urlPath;
    try {
      return new URL(urlPath, company!.careers_url).href;
    } catch {
      return urlPath;
    }
  }

  function formatComp(amount: number): string {
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
    return `$${Math.round(amount / 1000)}K`;
  }

  return (
    <div>
      {showAddedToast && (
        <div className="fixed top-16 sm:top-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in w-[calc(100vw-32px)] sm:w-auto max-w-md">
          <div className="bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Company added successfully!
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap mb-4 sm:mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 bg-white border border-stone-200 text-stone-700 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium hover:shadow-md hover:border-stone-300 transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Dashboard
        </Link>
        {nextCompany && (
          <Link
            href={`/company/${nextCompany.id}`}
            className="inline-flex items-center gap-1.5 bg-white border border-stone-200 text-stone-700 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium hover:shadow-md hover:border-stone-300 transition-all"
          >
            {nextCompany.name}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
      </div>

      <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <h1 className="text-[24px] font-[800] text-[#1A1A2E] mb-2">
              {company.name}
            </h1>
            <a
              href={company.careers_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--brand)] hover:underline text-sm inline-flex items-center gap-1 break-all"
            >
              {company.careers_url}
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
          <div className="flex items-center gap-2">
            {company.last_check_status?.startsWith("success") ? (
              <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: "var(--badge-bg)", color: "var(--badge-text)" }}>
                {company.last_check_status.includes("quality:")
                  ? company.last_check_status.replace("success ", "").replace("(", "").replace(")", "")
                  : "OK"}
              </span>
            ) : company.last_check_status?.startsWith("error") ? (
              <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-medium">
                Error
              </span>
            ) : (
              <span className="bg-stone-100 text-stone-600 px-3 py-1 rounded-full text-xs font-medium">
                Pending
              </span>
            )}

            {/* Report Issue button */}
            <div className="relative">
              {reportSubmitted ? (
                <span className="text-xs text-green-600 font-medium">Reported!</span>
              ) : (
                <button
                  onClick={() => setShowReportMenu(!showReportMenu)}
                  className="text-stone-400 hover:text-stone-600 p-2.5 sm:p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                  title="Report issue"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </button>
              )}
              {showReportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-1 w-52 z-10">
                  <div className="px-3 py-1.5 text-xs font-medium text-stone-500 border-b border-stone-100">
                    Report an issue
                  </div>
                  {[
                    { type: "wrong_jobs", label: "Wrong jobs shown" },
                    { type: "missing_jobs", label: "Missing jobs" },
                    { type: "bad_locations", label: "Bad locations" },
                    { type: "other", label: "Other issue" },
                  ].map((item) => (
                    <button
                      key={item.type}
                      onClick={() => reportIssue(item.type)}
                      className="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-[#F8FAFC] transition-colors"
                    >
                      {item.label}
                    </button>
                  ))}
                  <div className="border-t border-stone-100 px-3 py-2">
                    <a
                      href="mailto:feedback@newpmjobs.com"
                      className="text-xs text-[var(--brand)] hover:underline"
                    >
                      Email detailed feedback
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-4">
          <div className="bg-[#F8FAFC] rounded-lg p-4 text-center">
            <div className="text-2xl sm:text-3xl font-bold text-[#1A1A2E]">{activeJobs.length}</div>
            <div className="text-stone-500 text-sm">Total Jobs</div>
          </div>
          <div className="bg-[#F8FAFC] rounded-lg p-4 text-center">
            <div className="text-2xl sm:text-3xl font-bold text-[var(--brand)]">{filteredJobs.length}</div>
            <div className="text-stone-500 text-sm">{usOnly ? "US Jobs" : "Showing All"}</div>
          </div>
          <div className="bg-[#F8FAFC] rounded-lg p-4 text-center">
            <div className="text-lg font-semibold text-stone-700">
              {company.last_checked_at
                ? new Date(company.last_checked_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "Never"}
            </div>
            <div className="text-stone-500 text-sm">Last Checked</div>
          </div>
        </div>
      </div>

      {/* Compensation section */}
      {compData && (
        <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[#1A1A2E] mb-4">
            PM Compensation at {company.name}
          </h2>
          <div className="rounded-lg border border-stone-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[360px]">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-stone-200">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wider">Level</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wider">Median Total Comp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {compData.levels.map((l) => (
                  <tr key={l.level} className="hover:bg-[#F8FAFC]">
                    <td className="px-4 py-2.5 text-sm text-stone-700 font-medium">{l.level}</td>
                    <td className="px-4 py-2.5 text-sm text-stone-800 text-right font-semibold">{formatComp(l.medianTC)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <a
              href={compData.levelsFyiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--brand)] hover:underline text-sm font-medium inline-flex items-center gap-1"
            >
              View on Levels.fyi
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            <span className="text-xs text-stone-400">Data source: Levels.fyi</span>
          </div>
        </div>
      )}

      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[#1A1A2E] mb-3">
          Product Jobs
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:max-w-[200px]">
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
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
          <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-stone-600">
            No jobs found{usOnly ? " matching your filters." : "."}
          </p>
          {usOnly && (
            <button
              onClick={() => setUsOnly(false)}
              className="mt-2 text-[var(--brand)] hover:underline text-sm"
            >
              Show all locations
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(jobsByDate.entries()).map(([date, jobs]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-stone-500 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {date}
              </h3>
              <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100 overflow-hidden">
                {jobs.map((job) => {
                  const isFav = favorites.has(job.id);
                  const level = (job.job_level || "early") as JobLevel;
                  return (
                  <div key={job.id} className="px-3 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 hover:bg-[#F8FAFC] transition-colors">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        onClick={() => toggleFavorite(job.id)}
                        className="shrink-0 hover:scale-110 transition-transform p-1.5 -m-1.5 sm:p-0 sm:m-0"
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
                      {!job.is_baseline && isToday(job.first_seen_at) && (
                        <span
                          className="px-2 py-0.5 rounded text-xs font-semibold shrink-0"
                          style={{ backgroundColor: "var(--badge-bg)", color: "var(--badge-text)" }}
                        >
                          NEW
                        </span>
                      )}
                      <span
                        className="px-2 py-0.5 rounded text-xs font-semibold shrink-0"
                        style={{ backgroundColor: LEVEL_COLORS[level].bg, color: LEVEL_COLORS[level].text }}
                      >
                        {LEVEL_LABELS[level]}
                      </span>
                      <span className="text-[#1A1A2E] font-medium truncate">{job.job_title}</span>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 ml-[28px] sm:ml-0">
                      {job.job_location && (
                        <span className="text-stone-500 text-xs sm:text-sm shrink-0 max-w-[160px] sm:max-w-[250px] truncate flex items-center gap-1">
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {job.job_location}
                        </span>
                      )}
                      <a
                        href={buildJobUrl(job.job_url_path)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--brand)] hover:text-[var(--brand-hover)] text-sm font-medium shrink-0 flex items-center gap-1 hover:underline"
                      >
                        View
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Saved inactive jobs (favorited but removed/archived) */}
      {savedInactiveJobs.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-medium text-stone-400 mb-3">
            Saved Jobs (no longer active)
          </h3>
          <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100 overflow-hidden opacity-60">
            {savedInactiveJobs.map((job) => {
              const isFav = favorites.has(job.id);
              const level = (job.job_level || "early") as JobLevel;
              return (
                <div key={job.id} className="px-3 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      onClick={() => toggleFavorite(job.id)}
                      className="shrink-0 p-1.5 -m-1.5 sm:p-0 sm:m-0"
                      title="Remove from starred"
                    >
                      <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </button>
                    <span className="px-2 py-0.5 rounded text-xs font-semibold shrink-0 bg-stone-100 text-stone-500">
                      {job.status === "removed" ? "Removed" : "Archived"}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-semibold shrink-0"
                      style={{ backgroundColor: LEVEL_COLORS[level].bg, color: LEVEL_COLORS[level].text }}
                    >
                      {LEVEL_LABELS[level]}
                    </span>
                    <span className="text-stone-500 font-medium truncate line-through">{job.job_title}</span>
                  </div>
                  <a
                    href={buildJobUrl(job.job_url_path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-stone-400 hover:text-stone-600 text-sm font-medium shrink-0 ml-[28px] sm:ml-0"
                  >
                    View
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
