"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import {
  getBrandColor,
  softenColor,
  getFaviconUrl,
} from "@/lib/brandColors";

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

type FilterKey = "all" | "new" | "healthy" | "errors";

function sortCompanies(companies: Company[]): Company[] {
  return [...companies].sort((a, b) => {
    if (a.new_jobs_today > 0 && b.new_jobs_today === 0) return -1;
    if (a.new_jobs_today === 0 && b.new_jobs_today > 0) return 1;
    const aLatest = a.latest_new_job_at
      ? new Date(a.latest_new_job_at).getTime()
      : 0;
    const bLatest = b.latest_new_job_at
      ? new Date(b.latest_new_job_at).getTime()
      : 0;
    if (aLatest !== bLatest) return bLatest - aLatest;
    return 0;
  });
}

function filterCompanies(
  companies: Company[],
  filter: FilterKey
): Company[] {
  switch (filter) {
    case "new":
      return companies.filter((c) => c.new_jobs_today > 0);
    case "healthy":
      return companies.filter((c) =>
        c.last_check_status?.startsWith("success")
      );
    case "errors":
      return companies.filter((c) =>
        c.last_check_status?.startsWith("error")
      );
    default:
      return companies;
  }
}

export default function Dashboard() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");

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
      trackEvent("company_deleted", { company_name: name });
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
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
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
          <svg
            className="w-8 h-8 text-stone-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-[#1A1A2E] mb-2">
          No companies tracked yet
        </h2>
        <p className="text-stone-500 mb-6">
          Add a company to start tracking product job postings.
        </p>
        <Link
          href="/add"
          className="inline-flex items-center gap-2 bg-[var(--brand)] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[var(--brand-hover)] transition-all shadow-md hover:shadow-lg"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Add Company
        </Link>
      </div>
    );
  }

  // Stats
  const totalRoles = companies.reduce(
    (sum, c) => sum + c.total_product_jobs,
    0
  );
  const newToday = companies.reduce((sum, c) => sum + c.new_jobs_today, 0);
  const errorCount = companies.filter((c) =>
    c.last_check_status?.startsWith("error")
  ).length;

  const searched = search
    ? companies.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase())
      )
    : companies;
  const sorted = sortCompanies(filterCompanies(searched, filter));

  const filters: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "new", label: "New" },
    { key: "healthy", label: "Healthy" },
    { key: "errors", label: "Errors" },
  ];

  return (
    <div>
      {/* Header row */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-[800] text-[#1A1A2E]">
            Tracked Companies
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">
            {companies.length} companies being monitored
          </p>
        </div>

        {/* Stat boxes */}
        <div className="flex items-center gap-3">
          <div className="bg-[#EFF6FF] rounded-lg px-4 py-2.5 text-center min-w-[90px]">
            <div className="text-[20px] font-bold text-[#1E40AF]">
              {totalRoles}
            </div>
            <div className="text-[11px] text-[#3B82F6] font-medium">
              Total Roles
            </div>
          </div>
          <div className="bg-[#ECFDF5] rounded-lg px-4 py-2.5 text-center min-w-[90px]">
            <div className="text-[20px] font-bold text-[#065F46]">
              {newToday}
            </div>
            <div className="text-[11px] text-[#10B981] font-medium">
              New Today
            </div>
          </div>
          <div className="bg-[#FEF2F2] rounded-lg px-4 py-2.5 text-center min-w-[90px]">
            <div className="text-[20px] font-bold text-[#991B1B]">
              {errorCount}
            </div>
            <div className="text-[11px] text-[#EF4444] font-medium">
              Errors
            </div>
          </div>
        </div>
      </div>

      {/* Search + Filter bar */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-[280px]">
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
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-[#E5E7EB] bg-white text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#0EA5E9] focus:ring-1 focus:ring-[#0EA5E9]/30 transition-all"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); trackEvent("dashboard_filter", { filter: f.key }); }}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                filter === f.key
                  ? "bg-[#0C1E3A] text-white"
                  : "bg-white border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F3F4F6]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Card grid — 5 columns */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[14px]">
        {sorted.map((company, index) => {
          const brand = getBrandColor(company.name);
          const cardBg = softenColor(brand, 0.94);
          const headerFrom = softenColor(brand, 0.40);
          const headerTo = softenColor(brand, 0.15);

          return (
            <div
              key={company.id}
              onClick={() => router.push(`/company/${company.id}`)}
              className="group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-[3px] flex flex-col"
              style={{
                height: 190,
                backgroundColor: cardBg,
                border: `1px solid ${softenColor(brand, 0.85)}`,
                animation: "card-enter 0.4s ease-out both",
                animationDelay: `${index * 0.03}s`,
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget;
                el.style.border = `1px solid ${softenColor(brand, 0.55)}`;
                el.style.boxShadow = `0 8px 24px ${softenColor(brand, 0.80)}`;
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget;
                el.style.border = `1px solid ${softenColor(brand, 0.85)}`;
                el.style.boxShadow = "none";
              }}
            >
              {/* Brand header band */}
              <div
                className="flex items-center gap-2.5 px-3.5 py-2.5"
                style={{
                  background: `linear-gradient(135deg, ${headerFrom}, ${headerTo})`,
                }}
              >
                <img
                  src={getFaviconUrl(company.name, company.careers_url)}
                  alt=""
                  width={28}
                  height={28}
                  className="object-contain shrink-0 rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <span className="text-[15px] font-bold text-white truncate drop-shadow-sm">
                  {company.name}
                </span>
              </div>

              {/* Card body — Layout G: 3 rows spread vertically */}
              <div className="flex flex-col items-center justify-between flex-1 py-3 px-3.5">
                {/* Top row: badge (fixed height, empty spacer if none) */}
                <div className="h-[24px] flex items-center justify-center">
                  {company.new_jobs_today > 0 && (
                    <span
                      className="px-3 py-0.5 rounded-full text-[13px] font-bold"
                      style={{
                        backgroundColor: "var(--badge-bg)",
                        color: "var(--badge-text)",
                      }}
                    >
                      {company.new_jobs_today} new
                    </span>
                  )}
                </div>

                {/* Middle row: role count */}
                <div className="text-center">
                  <span className="text-[20px] font-bold text-[#1A1A2E]">
                    {company.total_product_jobs}
                  </span>
                  <span className="text-[13px] text-[#6B7280] ml-1">
                    roles
                  </span>
                </div>

                {/* Bottom row: timestamp */}
                <div className="flex items-center justify-center gap-1.5">
                  {company.last_check_status?.startsWith("success") ? (
                    <span
                      className="w-[6px] h-[6px] rounded-full inline-block shrink-0"
                      style={{ backgroundColor: "var(--status-ok)" }}
                      title="Status: OK"
                    />
                  ) : company.last_check_status?.startsWith("error") ? (
                    <span
                      className="w-[6px] h-[6px] rounded-full inline-block shrink-0"
                      style={{ backgroundColor: "var(--status-error)" }}
                      title={company.last_check_status}
                    />
                  ) : (
                    <span
                      className="w-[6px] h-[6px] rounded-full inline-block shrink-0"
                      style={{ backgroundColor: "var(--status-neutral)" }}
                      title="Pending"
                    />
                  )}
                  <span className="text-[10px] text-[#9CA3AF]">
                    Last checked: {formatDate(company.last_checked_at)}
                  </span>
                </div>
              </div>

              {/* Delete button — absolute, hover-only */}
              <div
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => deleteCompany(company.id, company.name)}
                  className="p-1.5 rounded-md text-white/60 hover:text-red-300 hover:bg-black/20 backdrop-blur-sm transition-all"
                  title="Delete company"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dashboard footer */}
      <div className="text-center mt-8 mb-2">
        <span className="text-[12px] text-[#9CA3AF]">
          Checked daily &middot; {companies.length} companies tracked
        </span>
      </div>
    </div>
  );
}
