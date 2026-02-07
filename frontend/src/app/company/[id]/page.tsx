"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface Job {
  id: string;
  job_title: string;
  job_location: string | null;
  job_url_path: string;
  first_seen_at: string;
  is_baseline: boolean;
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

// US states and common US location patterns
const US_PATTERNS = [
  /\bCA\b/i, /\bNY\b/i, /\bWA\b/i, /\bTX\b/i, /\bIL\b/i, /\bMA\b/i, /\bCO\b/i, /\bGA\b/i, /\bPA\b/i, /\bAZ\b/i,
  /California/i, /New York/i, /Washington/i, /Texas/i, /Illinois/i, /Massachusetts/i,
  /Colorado/i, /Georgia/i, /Pennsylvania/i, /Arizona/i, /Oregon/i, /Virginia/i,
  /San Francisco/i, /Seattle/i, /Austin/i, /Chicago/i, /Boston/i, /Los Angeles/i,
  /New York City/i, /NYC/i, /Sunnyvale/i, /San Mateo/i, /Palo Alto/i, /Mountain View/i,
  /United States/i, /USA/i, /\bUS\b/, /Remote/i,
];

function isUSLocation(location: string | null): boolean {
  if (!location) return false;
  return US_PATTERNS.some((pattern) => pattern.test(location));
}

export default function CompanyDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [usOnly, setUsOnly] = useState(true);

  useEffect(() => {
    async function fetchCompany() {
      try {
        const res = await fetch(`${API_URL}/api/companies/${id}`);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        setCompany(data);
      } catch (err) {
        console.error("Failed to fetch company:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchCompany();
  }, [id]);

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
        <h2 className="text-xl font-semibold text-stone-800 mb-4">
          Company not found
        </h2>
        <Link href="/" className="text-[var(--brand)] hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  // Filter jobs based on US-only toggle
  const filteredJobs = usOnly
    ? company.jobs.filter((job) => isUSLocation(job.job_location))
    : company.jobs;

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

  return (
    <div>
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-700 text-sm mb-6 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to dashboard
      </Link>

      <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-stone-800 mb-2">
              {company.name}
            </h1>
            <a
              href={company.careers_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--brand)] hover:underline text-sm inline-flex items-center gap-1"
            >
              {company.careers_url}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
          <div className="flex items-center gap-2">
            {company.last_check_status === "success" ? (
              <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: "var(--badge-bg)", color: "var(--badge-text)" }}>
                OK
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
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="bg-stone-50 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-stone-800">{company.total_product_jobs}</div>
            <div className="text-stone-500 text-sm">Total Jobs</div>
          </div>
          <div className="bg-stone-50 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-[var(--brand)]">{filteredJobs.length}</div>
            <div className="text-stone-500 text-sm">{usOnly ? "US Jobs" : "Showing All"}</div>
          </div>
          <div className="bg-stone-50 rounded-lg p-4 text-center">
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

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-stone-800">
          Product Jobs
        </h2>
        <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer select-none bg-white border border-stone-200 px-3 py-2 rounded-lg hover:bg-stone-50 transition-colors">
          <input
            type="checkbox"
            checked={usOnly}
            onChange={(e) => setUsOnly(e.target.checked)}
            className="rounded border-stone-300 text-[var(--brand)] focus:ring-[var(--brand)]"
          />
          US only
        </label>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
          <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-stone-600">
            No jobs found{usOnly ? " in the US." : "."}
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
                {jobs.map((job) => (
                  <div key={job.id} className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-stone-50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {!job.is_baseline && (
                        <span
                          className="px-2 py-0.5 rounded text-xs font-semibold shrink-0"
                          style={{ backgroundColor: "var(--badge-bg)", color: "var(--badge-text)" }}
                        >
                          NEW
                        </span>
                      )}
                      <span className="text-stone-800 font-medium truncate">{job.job_title}</span>
                    </div>
                    {job.job_location && (
                      <span className="text-stone-500 text-sm shrink-0 max-w-[250px] truncate flex items-center gap-1">
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
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
