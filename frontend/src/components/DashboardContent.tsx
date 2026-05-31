"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import {
  getBrandColor,
  softenColor,
  getFaviconUrl,
} from "@/lib/brandColors";
import AddCompanyModal from "@/components/AddCompanyModal";
import { useToast } from "@/components/Toast";

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
  // True when the employer's career site hard-blocks scraping. We show a
  // neutral "Restricted" badge instead of "0 roles" so it reads as the
  // employer denying access, not our scraper failing.
  scrape_blocked?: boolean | null;
}


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


export default function Dashboard() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(new Set());
  const [catalogCompanies, setCatalogCompanies] = useState<number | null>(null);
  const [catalogRoles, setCatalogRoles] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  // DEV-16: once the user explicitly closes the onboarding modal, don't
  // re-open it for the rest of the session. Without this, a new user with
  // 0 subs gets trapped — the auto-open effect fires every time showModal
  // flips false. Resets on full reload (which is fine; intent is "stop
  // nagging during this visit").
  const [modalDismissed, setModalDismissed] = useState(false);
  const [removeToast, setRemoveToast] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    fetchCompanies();
  }, []);

  // Auto-open modal from ?addCompany=true or if user has 0 subscriptions (onboarding)
  useEffect(() => {
    if (searchParams.get("addCompany") === "true") {
      setShowModal(true);
      setModalDismissed(false);
      window.history.replaceState({}, "", "/");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!loading && companies.length === 0 && !modalDismissed) {
      // Onboarding: auto-open modal for new users with no subscriptions.
      // Guarded by modalDismissed so closing the modal doesn't re-trap them.
      setShowModal(true);
    }
  }, [loading, companies.length, modalDismissed]);

  async function fetchCompanies() {
    try {
      // /api/feed/companies is the public lightweight catalog list — used
      // here for the "Available" and catalog-wide "Total Roles" stats.
      // Parallelizes with the two auth-protected per-user fetches.
      const [compRes, subRes, catalogRes] = await Promise.all([
        apiFetch("/api/companies"),
        apiFetch("/api/subscriptions"),
        apiFetch("/api/feed/companies"),
      ]);
      const data = await compRes.json();
      const subIds: string[] = await subRes.json();
      const catalogList: Array<{ id: string; name: string; total_product_jobs?: number }> = await catalogRes.json();
      setCompanies(data);
      setSubscribedIds(new Set(subIds));
      if (Array.isArray(catalogList)) {
        setCatalogCompanies(catalogList.length);
        setCatalogRoles(
          catalogList.reduce((sum, c) => sum + (c.total_product_jobs ?? 0), 0)
        );
      }
    } catch (err) {
      console.error("Failed to fetch companies:", err);
      showToast("Failed to load companies. Please refresh.");
    } finally {
      setLoading(false);
    }
  }

  async function removeCompany(id: string, name: string) {
    if (!confirm(`Remove "${name}" from your dashboard?\n\nOther users can still track this company.`)) return;
    try {
      await apiFetch(`/api/companies/${id}`, { method: "DELETE" });
      setCompanies((prev) => prev.filter((c) => c.id !== id));
      setSubscribedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      trackEvent("company_deleted", { company_name: name });
      setRemoveToast(`Removed ${name} from your dashboard.`);
      setTimeout(() => setRemoveToast(null), 3000);
    } catch (err) {
      console.error("Failed to remove company:", err);
      showToast("Failed to remove company. Please try again.");
    }
  }

  function formatTime(dateStr: string | null) {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleTimeString("en-US", {
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

  // Stats
  const totalRoles = companies.reduce(
    (sum, c) => sum + c.total_product_jobs,
    0
  );
  const newToday = companies.reduce((sum, c) => sum + c.new_jobs_today, 0);

  const searched = search
    ? companies.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase())
      )
    : companies;
  const sorted = sortCompanies(searched);

  return (
    <div>
      {/* Remove toast */}
      {removeToast && (
        <div className="fixed top-16 sm:top-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in w-[calc(100vw-32px)] sm:w-auto max-w-md">
          <div className="bg-stone-700 text-white px-5 py-3 rounded-lg shadow-lg text-sm font-medium">
            {removeToast}
          </div>
        </div>
      )}

      {/* Header row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-[700] text-[#1A1A2E]">
            You are tracking {companies.length} companies
          </h1>
        </div>

        {/* Stat boxes — catalog-wide stats on the left (Available / Total Roles),
            then user-scoped on the right (Tracked / Roles Tracked / New Today).
            3-col mobile grid → 3+2 layout. Single row on sm+. */}
        <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center sm:gap-3 w-full sm:w-auto">
          <div className="rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 text-center sm:min-w-[88px]" style={{ backgroundColor: "#F0F9FF", border: "1px solid #BAE6FD" }}>
            <div className="text-[16px] sm:text-[20px] font-bold text-[#0C4A6E]">
              {catalogCompanies ?? "—"}
            </div>
            <div className="text-[9px] font-medium uppercase" style={{ letterSpacing: "0.06em", color: "#0369A1", opacity: 0.75 }}>
              Available
            </div>
          </div>
          <div className="rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 text-center sm:min-w-[88px]" style={{ backgroundColor: "#F0F9FF", border: "1px solid #BAE6FD" }}>
            <div className="text-[16px] sm:text-[20px] font-bold text-[#0C4A6E]">
              {catalogRoles ?? "—"}
            </div>
            <div className="text-[9px] font-medium uppercase" style={{ letterSpacing: "0.06em", color: "#0369A1", opacity: 0.75 }}>
              Total Roles
            </div>
          </div>
          <div className="rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 text-center sm:min-w-[88px]" style={{ backgroundColor: "#F3F5FA", border: "1px solid #D9DEEA" }}>
            <div className="text-[16px] sm:text-[20px] font-bold text-[#1A1A2E]">
              {companies.length}
            </div>
            <div className="text-[9px] font-medium uppercase" style={{ letterSpacing: "0.06em", color: "#5F6478", opacity: 0.85 }}>
              Tracked
            </div>
          </div>
          <div className="rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 text-center sm:min-w-[88px]" style={{ backgroundColor: "#F3F5FA", border: "1px solid #D9DEEA" }}>
            <div className="text-[16px] sm:text-[20px] font-bold text-[#1A1A2E]">
              {totalRoles}
            </div>
            <div className="text-[9px] font-medium uppercase" style={{ letterSpacing: "0.06em", color: "#5F6478", opacity: 0.85 }}>
              Roles Tracked
            </div>
          </div>
          <div className="rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 text-center sm:min-w-[88px]" style={{ backgroundColor: "#F0FAF4", border: "1px solid #C8E6D5" }}>
            <div className="text-[16px] sm:text-[20px] font-bold text-[#16874D]">
              {newToday}
            </div>
            <div className="text-[9px] font-medium uppercase" style={{ letterSpacing: "0.06em", color: "#16874D", opacity: 0.7 }}>
              New Today
            </div>
          </div>
        </div>
      </div>

      {/* Search bar (filter pills removed per UX feedback — they exposed
          operator-y categories like Healthy/Errors). */}
      <div className="mb-5">
        <div className="relative w-full sm:max-w-[280px]">
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
      </div>

      {companies.length === 0 && !showModal ? (
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
            Add companies to start tracking product job postings.
          </p>
          <button
            onClick={() => setShowModal(true)}
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
            Add Companies
          </button>
        </div>
      ) : (
        <>
          {/* Card grid — 5 columns */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {sorted.map((company, index) => {
              const brand = getBrandColor(company.name);
              const cardBg = softenColor(brand, 0.96);
              const headerFrom = softenColor(brand, 0.60);
              const headerTo = softenColor(brand, 0.35);

              return (
                <div
                  key={company.id}
                  onClick={() => router.push(`/company/${company.id}`)}
                  className="group relative overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-[3px] flex flex-col"
                  style={{
                    height: 156,
                    borderRadius: 10,
                    backgroundColor: cardBg,
                    border: "1px solid #E0E0E6",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    animation: "card-enter 0.4s ease-out both",
                    animationDelay: `${index * 0.03}s`,
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget;
                    el.style.border = `1px solid ${softenColor(brand, 0.50)}`;
                    el.style.boxShadow = `0 8px 24px ${softenColor(brand, 0.75)}44`;
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget;
                    el.style.border = "1px solid #E0E0E6";
                    el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
                  }}
                >
                  {/* Brand header band */}
                  <div
                    className="flex items-center shrink-0"
                    style={{
                      minHeight: 42,
                      padding: "8px 10px",
                      gap: 8,
                      background: `linear-gradient(135deg, ${headerFrom}, ${headerTo})`,
                    }}
                  >
                    <div className="w-[28px] h-[28px] shrink-0 overflow-hidden" style={{ borderRadius: 6 }}>
                      <img
                        src={getFaviconUrl(company.name, company.careers_url)}
                        alt=""
                        width={28}
                        height={28}
                        className="object-contain w-full h-full"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                    <span className="text-[16px] font-[700] text-[#1A1A2E] truncate">
                      {company.name}
                    </span>
                  </div>

                  {/* Card body — centered content. A "Restricted" employer
                      replaces the role count + status footer entirely: the
                      employer blocks scraping, so "0 roles" would misread as
                      our failure. */}
                  {company.scrape_blocked ? (
                    <div className="flex flex-col items-center justify-center flex-1" style={{ padding: "4px 10px 0" }}>
                      <span
                        className="font-[600] text-[12px]"
                        style={{
                          backgroundColor: "#F1F1F4",
                          color: "#6E6E80",
                          border: "1px solid #E0E0E6",
                          borderRadius: 6,
                          padding: "3px 12px",
                          letterSpacing: "0.02em",
                        }}
                        title="This employer blocks scraping of their careers site, so we can't list their roles here. Apply on their site directly."
                      >
                        Scraping blocked
                      </span>
                    </div>
                  ) : (
                    <div className={`flex flex-col items-center justify-center flex-1 ${company.new_jobs_today > 0 ? "gap-[10px]" : ""}`} style={{ padding: "4px 10px 0" }}>
                      {company.new_jobs_today > 0 && (
                        <span
                          className="font-[700] text-[11px]"
                          style={{
                            backgroundColor: "#E8F5EE",
                            color: "#16874D",
                            borderRadius: 6,
                            padding: "3px 12px",
                            letterSpacing: "0.02em",
                          }}
                        >
                          +{company.new_jobs_today} new
                        </span>
                      )}
                      <div className="text-center">
                        <span className="text-[26px] font-bold text-[#1A1A2E]">
                          {company.total_product_jobs}
                        </span>
                        <span className="text-[13px] text-[#6E6E80] ml-1">
                          {company.total_product_jobs === 1 ? "role" : "roles"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Footer — separated with border-top */}
                  <div className="flex items-center justify-center gap-1.5 shrink-0" style={{ borderTop: "1px solid #E0E0E6", padding: "5px 10px" }}>
                    {company.scrape_blocked ? (
                      <span className="text-[10px] text-[#9494A8]">
                        Scraping blocked by employer
                      </span>
                    ) : (
                      <>
                        {company.last_check_status?.startsWith("success") ? (
                          <span
                            className="w-[5px] h-[5px] rounded-full inline-block shrink-0"
                            style={{ backgroundColor: "var(--status-ok)" }}
                            title="Status: OK"
                          />
                        ) : company.last_check_status?.startsWith("error") ? (
                          <span
                            className="w-[5px] h-[5px] rounded-full inline-block shrink-0"
                            style={{ backgroundColor: "var(--status-error)" }}
                            title={company.last_check_status}
                          />
                        ) : (
                          <span
                            className="w-[5px] h-[5px] rounded-full inline-block shrink-0"
                            style={{ backgroundColor: "var(--status-neutral)" }}
                            title="Pending"
                          />
                        )}
                        <span className="text-[10px] text-[#9494A8]">
                          {company.last_check_status?.startsWith("error")
                            ? "Failed"
                            : formatTime(company.last_checked_at)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Remove button — absolute, hover-only */}
                  <div
                    className="absolute opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ top: 5, right: 5 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => removeCompany(company.id, company.name)}
                      className="flex items-center justify-center text-white transition-all hover:brightness-110"
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        backgroundColor: "rgba(0,0,0,0.3)",
                        fontSize: 13,
                        lineHeight: 1,
                      }}
                      title="Remove from my dashboard"
                    >
                      x
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
        </>
      )}

      {/* Add Company Modal */}
      <AddCompanyModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setModalDismissed(true);
        }}
        onCompanyAdded={fetchCompanies}
        subscribedIds={subscribedIds}
      />
    </div>
  );
}
