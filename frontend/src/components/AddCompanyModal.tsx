"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { getFaviconUrl } from "@/lib/brandColors";

interface CatalogCompany {
  id: string;
  name: string;
  careers_url: string;
  total_product_jobs: number;
  last_check_status: string | null;
  subscriber_count: number;
  is_active: boolean;
}

interface AddCompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompanyAdded: () => void;
  subscribedIds: Set<string>;
}

// Step durations for the add-company progress animation
const STEP_DURATIONS = [4000, 25000, 8000, 5000];

export default function AddCompanyModal({
  isOpen,
  onClose,
  onCompanyAdded,
  subscribedIds,
}: AddCompanyModalProps) {
  const [tab, setTab] = useState<"catalog" | "new">("catalog");
  const [catalog, setCatalog] = useState<CatalogCompany[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subscribing, setSubscribing] = useState(false);

  // New company form state
  const [name, setName] = useState("");
  const [careersUrl, setCareersUrl] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  const [currentStep, setCurrentStep] = useState(-1);
  const [submissionCount, setSubmissionCount] = useState<number | null>(null);
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
  }, []);

  // Fetch catalog when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setCatalogLoading(true);
    setSelected(new Set());
    setSearch("");
    setTab("catalog");

    Promise.all([
      apiFetch("/api/catalog").then((r) => r.json()),
      apiFetch("/api/subscriptions").then((r) => r.json()),
    ])
      .then(([catalogData, _subData]) => {
        setCatalog(catalogData || []);
      })
      .catch((err) => console.error("Failed to load catalog:", err))
      .finally(() => setCatalogLoading(false));
  }, [isOpen]);

  // Progress animation for new company add
  useEffect(() => {
    if (!addLoading) {
      setCurrentStep(-1);
      clearTimers();
      return;
    }
    setCurrentStep(0);
    let elapsed = 0;
    for (let i = 1; i < STEP_DURATIONS.length; i++) {
      elapsed += STEP_DURATIONS[i - 1];
      const step = i;
      const timer = setTimeout(() => setCurrentStep(step), elapsed);
      stepTimers.current.push(timer);
    }
    return clearTimers;
  }, [addLoading, clearTimers]);

  if (!isOpen) return null;

  function toggleCompany(id: string) {
    if (subscribedIds.has(id)) return; // Already subscribed
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubscribe() {
    if (selected.size === 0) return;
    setSubscribing(true);
    try {
      const res = await apiFetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error("Failed to subscribe");
      trackEvent("companies_subscribed", { count: selected.size });
      onCompanyAdded();
      onClose();
    } catch (err) {
      console.error("Subscribe failed:", err);
    } finally {
      setSubscribing(false);
    }
  }

  async function handleAddNewCompany(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    setAddLoading(true);

    try {
      const res = await apiFetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, careers_url: careersUrl }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add company");
      }

      trackEvent("company_added", { company_name: name, careers_url: careersUrl });
      setName("");
      setCareersUrl("");
      onCompanyAdded();
      onClose();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAddLoading(false);
    }
  }

  const filteredCatalog = search
    ? catalog.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : catalog;

  function getStepLabel(i: number, isDone: boolean) {
    switch (i) {
      case 0: return isDone ? "Platform detected" : "Detecting platform...";
      case 1: return isDone ? "Jobs scanned" : "Scanning job listings...";
      case 2: return isDone ? "PM roles filtered" : "Filtering PM roles...";
      case 3: return isDone ? "Validated" : "Validating results...";
      default: return "";
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative bg-white rounded-xl shadow-xl border border-stone-200 w-full max-w-2xl mx-4 flex flex-col"
        style={{ maxHeight: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 shrink-0">
          <h2 className="text-lg font-bold text-[#1A1A2E]">Add Companies</h2>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-200 shrink-0">
          <button
            onClick={() => setTab("catalog")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === "catalog"
                ? "text-[#0EA5E9] border-b-2 border-[#0EA5E9]"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            Browse Catalog
          </button>
          <button
            onClick={() => setTab("new")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === "new"
                ? "text-[#0EA5E9] border-b-2 border-[#0EA5E9]"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            Add New Company
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === "catalog" ? (
            <>
              {/* Search */}
              <div className="relative mb-4">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search companies..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-stone-200 bg-white text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#0EA5E9] focus:ring-1 focus:ring-[#0EA5E9]/30"
                />
              </div>

              {catalogLoading ? (
                <div className="flex items-center justify-center py-8 text-stone-500">
                  <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading catalog...
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredCatalog.map((company) => {
                    const isSubscribed = subscribedIds.has(company.id);
                    const isSelected = selected.has(company.id);
                    return (
                      <label
                        key={company.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                          isSubscribed
                            ? "opacity-50 cursor-default"
                            : isSelected
                            ? "bg-blue-50 border border-blue-200"
                            : "hover:bg-stone-50 border border-transparent"
                        }`}
                        onClick={(e) => {
                          if (isSubscribed) e.preventDefault();
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSubscribed || isSelected}
                          disabled={isSubscribed}
                          onChange={() => toggleCompany(company.id)}
                          className="rounded border-stone-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
                        />
                        <img
                          src={getFaviconUrl(company.name, company.careers_url)}
                          alt=""
                          width={20}
                          height={20}
                          className="rounded shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <span className="text-sm font-medium text-[#1A1A2E] flex-1">
                          {company.name}
                        </span>
                        <span className="text-xs text-stone-400">
                          {company.total_product_jobs} roles
                        </span>
                        {isSubscribed && (
                          <span className="text-xs text-stone-400 italic">(added)</span>
                        )}
                      </label>
                    );
                  })}

                  {filteredCatalog.length === 0 && (
                    <p className="text-center text-stone-500 py-4 text-sm">
                      No companies found.{" "}
                      <button
                        onClick={() => setTab("new")}
                        className="text-[#0EA5E9] hover:underline"
                      >
                        Add a new one
                      </button>
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            /* New Company tab */
            <form onSubmit={handleAddNewCompany} className="space-y-4">
              <p className="text-sm text-stone-500 mb-2">
                Don&apos;t see a company in the catalog? Submit its careers page URL and we&apos;ll start tracking it.
                {submissionCount !== null && (
                  <span className="block mt-1 text-xs text-stone-400">
                    {submissionCount}/10 submissions used
                  </span>
                )}
              </p>

              <div>
                <label htmlFor="modal-name" className="block text-sm font-medium text-stone-700 mb-1.5">
                  Company Name
                </label>
                <input
                  id="modal-name"
                  type="text"
                  required
                  disabled={addLoading}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Spotify"
                  className="w-full px-3 py-2.5 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent bg-[#F8FAFC] text-stone-900 placeholder-stone-400 disabled:opacity-60 text-sm"
                />
              </div>

              <div>
                <label htmlFor="modal-url" className="block text-sm font-medium text-stone-700 mb-1.5">
                  Careers Page URL
                </label>
                <input
                  id="modal-url"
                  type="url"
                  required
                  disabled={addLoading}
                  value={careersUrl}
                  onChange={(e) => setCareersUrl(e.target.value)}
                  placeholder="e.g. https://jobs.lever.co/spotify"
                  className="w-full px-3 py-2.5 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent bg-[#F8FAFC] text-stone-900 placeholder-stone-400 disabled:opacity-60 text-sm"
                />
                <p className="mt-1.5 text-xs text-stone-400">
                  Enter the company&apos;s careers page that lists all job openings
                </p>
              </div>

              {addError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                  {addError}
                </div>
              )}

              {!addLoading && (
                <button
                  type="submit"
                  className="w-full bg-[#0EA5E9] text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-[#0284C7] transition-all text-sm"
                >
                  Add Company
                </button>
              )}

              {addLoading && (
                <div className="border border-stone-200 rounded-lg p-4 space-y-2.5">
                  {[0, 1, 2, 3].map((i) => {
                    const isActive = i === currentStep;
                    const isDone = i < currentStep;
                    const isPending = i > currentStep;
                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-2 transition-all ${isPending ? "opacity-30" : ""}`}
                      >
                        {isDone ? (
                          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : isActive ? (
                          <svg className="animate-spin h-5 w-5 text-[#0EA5E9]" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-stone-200" />
                        )}
                        <span className={`text-sm ${isActive ? "text-[#1A1A2E] font-medium" : isDone ? "text-green-700" : "text-stone-400"}`}>
                          {getStepLabel(i, isDone)}
                        </span>
                      </div>
                    );
                  })}
                  <p className="text-xs text-stone-400 pt-1 border-t border-stone-100">
                    This usually takes 30-60 seconds
                  </p>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer (catalog tab only, when items selected) */}
        {tab === "catalog" && selected.size > 0 && (
          <div className="border-t border-stone-200 px-6 py-4 shrink-0 flex items-center justify-between">
            <span className="text-sm text-stone-500">
              {selected.size} compan{selected.size === 1 ? "y" : "ies"} selected
            </span>
            <button
              onClick={handleSubscribe}
              disabled={subscribing}
              className="bg-[#0EA5E9] text-white px-5 py-2 rounded-lg font-semibold hover:bg-[#0284C7] transition-all text-sm disabled:opacity-60"
            >
              {subscribing ? "Adding..." : "Add Selected"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
