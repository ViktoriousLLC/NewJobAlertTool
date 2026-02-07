"use client";

import { useEffect, useState } from "react";

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

interface CompanySummary {
  id: string;
  name: string;
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
  if (!location || !location.trim()) return true;
  return US_PATTERNS.some((pattern) => pattern.test(location));
}

interface FlatJob {
  id: string;
  companyName: string;
  careersUrl: string;
  jobTitle: string;
  jobLocation: string | null;
  jobUrlPath: string;
  lastCheckedAt: string | null;
  firstSeenAt: string;
}

export default function AllJobsPage() {
  const [jobs, setJobs] = useState<FlatJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [usOnly, setUsOnly] = useState(true);

  useEffect(() => {
    async function fetchAllJobs() {
      try {
        // Step 1: Get all companies
        const res = await fetch(`${API_URL}/api/companies`);
        const companies: CompanySummary[] = await res.json();

        // Step 2: Fetch each company's detail in parallel
        const details = await Promise.all(
          companies.map(async (c) => {
            try {
              const r = await fetch(`${API_URL}/api/companies/${c.id}`);
              if (!r.ok) return null;
              return (await r.json()) as CompanyDetail;
            } catch {
              return null;
            }
          })
        );

        // Step 3: Flatten into a single list
        const flat: FlatJob[] = [];
        for (const detail of details) {
          if (!detail) continue;
          for (const job of detail.jobs) {
            flat.push({
              id: job.id,
              companyName: detail.name,
              careersUrl: detail.careers_url,
              jobTitle: job.job_title,
              jobLocation: job.job_location,
              jobUrlPath: job.job_url_path,
              lastCheckedAt: detail.last_checked_at,
              firstSeenAt: job.first_seen_at,
            });
          }
        }

        // Step 4: Sort by company name (alpha), then newest first within each company
        flat.sort((a, b) => {
          const cmp = a.companyName.localeCompare(b.companyName);
          if (cmp !== 0) return cmp;
          return new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime();
        });

        setJobs(flat);
      } catch (err) {
        console.error("Failed to fetch jobs:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchAllJobs();
  }, []);

  function buildJobUrl(urlPath: string, careersUrl: string) {
    if (urlPath.startsWith("http")) return urlPath;
    try {
      return new URL(urlPath, careersUrl).href;
    } catch {
      return urlPath;
    }
  }

  const filteredJobs = usOnly
    ? jobs.filter((job) => isUSLocation(job.jobLocation))
    : jobs;

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-stone-800">
          All Jobs
          <span className="text-base font-normal text-stone-500 ml-3">
            {filteredJobs.length} jobs across all companies
          </span>
        </h1>
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
          <p className="text-stone-600">No jobs found{usOnly ? " in the US." : "."}</p>
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
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[35%]" />
              <col className="w-[28%]" />
              <col className="w-[15%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Company</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Job Title</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Location</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Last Checked</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredJobs.map((job) => (
                <tr key={job.id} className="hover:bg-stone-50 transition-colors">
                  <td className="px-5 py-3.5 text-sm font-bold text-stone-800 truncate" title={job.companyName}>
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
                  <td className="px-5 py-3.5 text-sm text-stone-500 whitespace-nowrap">
                    {job.lastCheckedAt
                      ? new Date(job.lastCheckedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "Never"}
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
