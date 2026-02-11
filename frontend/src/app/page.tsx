"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

interface Company {
  id: string;
  name: string;
  careers_url: string;
  created_at: string;
  last_checked_at: string | null;
  last_check_status: string | null;
  total_product_jobs: number;
  new_jobs_today: number;
  latest_new_job_at: string | null;
}

function sortCompanies(companies: Company[]): Company[] {
  return [...companies].sort((a, b) => {
    // 1. Companies with new jobs today first
    if (a.new_jobs_today > 0 && b.new_jobs_today === 0) return -1;
    if (a.new_jobs_today === 0 && b.new_jobs_today > 0) return 1;

    // 2. Then by most recent new job added
    const aLatest = a.latest_new_job_at ? new Date(a.latest_new_job_at).getTime() : 0;
    const bLatest = b.latest_new_job_at ? new Date(b.latest_new_job_at).getTime() : 0;
    if (aLatest !== bLatest) return bLatest - aLatest;

    // 3. Companies with no new jobs ever go last (already handled by 0 above)
    return 0;
  });
}

export default function Dashboard() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCompanies();
  }, []);

  async function fetchCompanies() {
    try {
      const res = await apiFetch("/api/companies");
      const data = await res.json();
      setCompanies(data);
    } catch (err) {
      console.error("Failed to fetch companies:", err);
    } finally {
      setLoading(false);
    }
  }

  async function deleteCompany(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

    try {
      await apiFetch(`/api/companies/${id}`, { method: "DELETE" });
      setCompanies((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error("Failed to delete company:", err);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
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

  if (companies.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-stone-800 mb-2">
          No companies tracked yet
        </h2>
        <p className="text-stone-500 mb-6">
          Add a company to start tracking product job postings.
        </p>
        <Link
          href="/add"
          className="inline-flex items-center gap-2 bg-[var(--brand)] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[var(--brand-hover)] transition-all shadow-md hover:shadow-lg"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Company
        </Link>
      </div>
    );
  }

  const sorted = sortCompanies(companies);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-stone-800">
          Tracked Companies
        </h1>
        <span className="text-sm text-stone-500">{companies.length} companies</span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
        {sorted.map((company) => (
          <div
            key={company.id}
            onClick={() => router.push(`/company/${company.id}`)}
            className="group relative bg-white rounded-xl border border-stone-200 p-5 hover:shadow-md hover:border-[var(--brand)]/30 transition-all cursor-pointer flex flex-col items-center text-center h-[180px] justify-between"
          >
            {/* Action buttons — top right, hover only. The wrapper stops propagation
                so any click in this zone never navigates to the detail page. */}
            <div
              className="flex justify-end w-full gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {company.last_check_status?.startsWith("error") && (
                <a
                  href={`mailto:feedback@newpmjobs.com?subject=Issue with ${encodeURIComponent(company.name)}&body=Company: ${encodeURIComponent(company.name)}%0AURL: ${encodeURIComponent(company.careers_url)}%0A%0ADescribe the issue:%0A`}
                  className="text-amber-400 hover:text-amber-600 transition-all p-2 -m-1 rounded-md hover:bg-amber-50 opacity-0 group-hover:opacity-100"
                  title="Report issue"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </a>
              )}
              <button
                onClick={() => deleteCompany(company.id, company.name)}
                className="text-stone-300 hover:text-red-500 transition-all p-2 -m-1 rounded-md hover:bg-red-50 opacity-0 group-hover:opacity-100"
                title="Delete company"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            {/* Company name — big and prominent */}
            <div className="flex-1 flex flex-col items-center justify-center gap-1.5 min-h-0">
              <span className="text-lg font-bold text-stone-800 leading-tight line-clamp-2">
                {company.name}
              </span>

              {company.new_jobs_today > 0 && (
                <span
                  className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: "var(--badge-bg)", color: "var(--badge-text)" }}
                >
                  {company.new_jobs_today} new
                </span>
              )}

              <div className="text-sm text-stone-400">
                {company.total_product_jobs} jobs
              </div>
            </div>

            {/* Bottom: status dot + timestamp */}
            <div className="flex items-center gap-1.5 w-full justify-center">
              {company.last_check_status?.startsWith("success") ? (
                <span
                  className="w-2 h-2 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: "var(--status-ok)" }}
                  title="Status: OK"
                />
              ) : company.last_check_status?.startsWith("error") ? (
                <span
                  className="w-2 h-2 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: "var(--status-error)" }}
                  title={company.last_check_status}
                />
              ) : (
                <span
                  className="w-2 h-2 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: "var(--status-neutral)" }}
                  title="Pending"
                />
              )}
              <span className="text-[10px] text-stone-400">
                {formatDate(company.last_checked_at)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
