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

interface CheckPreview {
  status: "preview";
  company_name: string;
  platform_type: string | null;
  platform_config: Record<string, string> | null;
  job_count: number;
  sample_jobs: { title: string; location: string }[];
  quality_score: number;
  warnings: string[];
  jobs: { title: string; location: string; urlPath: string }[];
}

interface CheckExists {
  status: "exists";
  existing_company: { id: string; name: string; total_product_jobs: number };
}

interface CheckError {
  status: "error";
  company_name: string;
  error: string;
}

type CheckResult = CheckPreview | CheckExists | CheckError;

interface AddCompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompanyAdded: () => void;
  subscribedIds: Set<string>;
}

// Step durations for the check progress animation
const STEP_DURATIONS = [4000, 25000, 8000, 5000];

type FlowState = "input" | "checking" | "preview" | "retry";

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

  // New company check-then-add state
  const [flowState, setFlowState] = useState<FlowState>("input");
  const [careersUrl, setCareersUrl] = useState("");
  const [addError, setAddError] = useState("");
  const [currentStep, setCurrentStep] = useState(-1);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [editableName, setEditableName] = useState("");
  const [retryFeedback, setRetryFeedback] = useState("");
  const [confirming, setConfirming] = useState(false);
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const clearTimers = useCallback(() => {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
  }, []);

  function resetNewCompanyState() {
    setFlowState("input");
    setCareersUrl("");
    setAddError("");
    setCurrentStep(-1);
    setCheckResult(null);
    setEditableName("");
    setRetryFeedback("");
    setConfirming(false);
    clearTimers();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  // Fetch catalog when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setCatalogLoading(true);
    setSelected(new Set());
    setSearch("");
    setTab("catalog");
    resetNewCompanyState();

    Promise.all([
      apiFetch("/api/catalog").then((r) => r.json()),
      apiFetch("/api/subscriptions").then((r) => r.json()),
    ])
      .then(([catalogData]) => {
        setCatalog(catalogData || []);
      })
      .catch((err) => console.error("Failed to load catalog:", err))
      .finally(() => setCatalogLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Progress animation for checking
  useEffect(() => {
    if (flowState !== "checking") {
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
  }, [flowState, clearTimers]);

  if (!isOpen) return null;

  function handleTabSwitch(newTab: "catalog" | "new") {
    setTab(newTab);
    if (newTab === "catalog") {
      resetNewCompanyState();
    }
  }

  function toggleCompany(id: string) {
    if (subscribedIds.has(id)) return;
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

  async function handleCheck(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setAddError("");

    const url = careersUrl.trim();
    if (!url) return;

    // Client-side LinkedIn block
    if (url.toLowerCase().includes("linkedin.com")) {
      setAddError(
        "LinkedIn blocks automated scraping, so we can't track jobs there. Please use the company's direct careers page instead (e.g. careers.company.com)."
      );
      return;
    }

    setFlowState("checking");
    setCheckResult(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await apiFetch("/api/companies/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careers_url: url }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Check failed");
      }

      const data: CheckResult = await res.json();
      setCheckResult(data);

      if (data.status === "preview") {
        setEditableName(data.company_name);
      }

      setFlowState("preview");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setAddError(err instanceof Error ? err.message : "Something went wrong");
      setFlowState("input");
    } finally {
      abortRef.current = null;
    }
  }

  function handleCancelCheck() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    clearTimers();
    setFlowState("input");
  }

  async function handleConfirmAdd() {
    if (!checkResult || checkResult.status !== "preview") return;
    setConfirming(true);

    try {
      const res = await apiFetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editableName,
          careers_url: careersUrl.trim(),
          jobs: checkResult.jobs,
          platform_type: checkResult.platform_type,
          platform_config: checkResult.platform_config,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add company");
      }

      trackEvent("company_added", { company_name: editableName, careers_url: careersUrl });
      onCompanyAdded();
      onClose();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Something went wrong");
      setConfirming(false);
    }
  }

  async function handleSubscribeExisting() {
    if (!checkResult || checkResult.status !== "exists") return;
    setConfirming(true);

    try {
      const res = await apiFetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_ids: [checkResult.existing_company.id] }),
      });
      if (!res.ok) throw new Error("Failed to subscribe");
      trackEvent("companies_subscribed", { count: 1 });
      onCompanyAdded();
      onClose();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Something went wrong");
      setConfirming(false);
    }
  }

  function handleNoTryAgain() {
    setFlowState("retry");
    setRetryFeedback("");
  }

  async function handleCancelWithFeedback() {
    // Fire-and-forget feedback if provided
    if (retryFeedback.trim()) {
      apiFetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issue_type: "missing_data",
          message: `Check feedback for ${careersUrl}: ${retryFeedback}`,
          page_url: window.location.href,
        }),
      }).catch(() => {});
    }
    onClose();
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

  function renderNewCompanyTab() {
    // State: input
    if (flowState === "input") {
      return (
        <form onSubmit={handleCheck} className="space-y-4">
          <p className="text-sm text-stone-500 mb-2">
            Don&apos;t see a company in the catalog? Enter its careers page URL and we&apos;ll check for PM roles.
          </p>

          <div>
            <label htmlFor="modal-url" className="block text-sm font-medium text-stone-700 mb-1.5">
              Careers Page URL
            </label>
            <input
              id="modal-url"
              type="url"
              required
              value={careersUrl}
              onChange={(e) => setCareersUrl(e.target.value)}
              placeholder="e.g. https://jobs.lever.co/spotify"
              className="w-full px-3 py-2.5 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent bg-[#F8FAFC] text-stone-900 placeholder-stone-400 text-sm"
            />
            <p className="mt-1.5 text-xs text-stone-400">
              Enter the company&apos;s careers page that lists all job openings (not a single role)
            </p>
          </div>

          {addError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
              {addError}
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-[#0EA5E9] text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-[#0284C7] transition-all text-sm"
          >
            Check PM Roles
          </button>
        </form>
      );
    }

    // State: checking
    if (flowState === "checking") {
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-500">
            Checking <span className="font-medium text-stone-700">{careersUrl}</span>
          </p>

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

          <button
            type="button"
            onClick={handleCancelCheck}
            className="w-full border border-stone-300 text-stone-600 px-4 py-2 rounded-lg font-medium hover:bg-stone-50 transition-all text-sm"
          >
            Cancel
          </button>
        </div>
      );
    }

    // State: preview
    if (flowState === "preview" && checkResult) {
      // Sub-case: existing company (dedup match)
      if (checkResult.status === "exists") {
        const { existing_company } = checkResult;
        const alreadySubscribed = subscribedIds.has(existing_company.id);
        return (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800 font-medium">
                This company already exists as &ldquo;{existing_company.name}&rdquo;
              </p>
              <p className="text-sm text-blue-700 mt-1">
                {existing_company.total_product_jobs} open PM role{existing_company.total_product_jobs !== 1 ? "s" : ""} tracked
              </p>
            </div>

            {addError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                {addError}
              </div>
            )}

            {alreadySubscribed ? (
              <div className="bg-stone-50 border border-stone-200 rounded-lg p-3">
                <p className="text-sm text-stone-600">You&apos;re already tracking this company.</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSubscribeExisting}
                disabled={confirming}
                className="w-full bg-[#0EA5E9] text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-[#0284C7] transition-all text-sm disabled:opacity-60"
              >
                {confirming ? "Adding..." : "Add to Dashboard"}
              </button>
            )}

            <button
              type="button"
              onClick={() => { setFlowState("input"); setCheckResult(null); setAddError(""); }}
              className="w-full border border-stone-300 text-stone-600 px-4 py-2 rounded-lg font-medium hover:bg-stone-50 transition-all text-sm"
            >
              Try Different URL
            </button>
          </div>
        );
      }

      // Sub-case: scrape error
      if (checkResult.status === "error") {
        return (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-700 font-medium">
                Couldn&apos;t find jobs at &ldquo;{checkResult.company_name}&rdquo;
              </p>
              <p className="text-sm text-red-600 mt-1">{checkResult.error}</p>
            </div>

            <button
              type="button"
              onClick={() => { setFlowState("input"); setCheckResult(null); setAddError(""); }}
              className="w-full border border-stone-300 text-stone-600 px-4 py-2 rounded-lg font-medium hover:bg-stone-50 transition-all text-sm"
            >
              Try Different URL
            </button>
          </div>
        );
      }

      // Sub-case: preview with results
      return (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-800 font-medium">
              Found {checkResult.job_count} PM role{checkResult.job_count !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-green-700 mt-0.5">Does this look right?</p>
          </div>

          {/* Editable company name */}
          <div>
            <label htmlFor="modal-edit-name" className="block text-sm font-medium text-stone-700 mb-1.5">
              Company Name
            </label>
            <input
              id="modal-edit-name"
              type="text"
              required
              value={editableName}
              onChange={(e) => setEditableName(e.target.value)}
              className="w-full px-3 py-2.5 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent bg-[#F8FAFC] text-stone-900 text-sm"
            />
          </div>

          {/* Sample jobs */}
          {checkResult.sample_jobs.length > 0 && (
            <div className="border border-stone-200 rounded-lg divide-y divide-stone-100">
              {checkResult.sample_jobs.map((job, i) => (
                <div key={i} className="px-3 py-2 flex items-center justify-between">
                  <span className="text-sm text-stone-800 truncate flex-1 mr-3">{job.title}</span>
                  <span className="text-xs text-stone-400 shrink-0">{job.location || "No location"}</span>
                </div>
              ))}
              {checkResult.job_count > checkResult.sample_jobs.length && (
                <div className="px-3 py-2 text-xs text-stone-400 text-center">
                  + {checkResult.job_count - checkResult.sample_jobs.length} more
                </div>
              )}
            </div>
          )}

          {/* Quality warnings */}
          {checkResult.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              {checkResult.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700">{w}</p>
              ))}
            </div>
          )}

          {addError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
              {addError}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleNoTryAgain}
              className="flex-1 border border-stone-300 text-stone-600 px-4 py-2.5 rounded-lg font-medium hover:bg-stone-50 transition-all text-sm"
            >
              No, Try Again
            </button>
            <button
              type="button"
              onClick={handleConfirmAdd}
              disabled={confirming || !editableName.trim()}
              className="flex-1 bg-[#0EA5E9] text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-[#0284C7] transition-all text-sm disabled:opacity-60"
            >
              {confirming ? "Adding..." : "Yes, Add It"}
            </button>
          </div>
        </div>
      );
    }

    // State: retry
    if (flowState === "retry") {
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-500">
            Edit the URL and try again, or let us know what went wrong.
          </p>

          <div>
            <label htmlFor="modal-retry-url" className="block text-sm font-medium text-stone-700 mb-1.5">
              Careers Page URL
            </label>
            <input
              id="modal-retry-url"
              type="url"
              required
              value={careersUrl}
              onChange={(e) => setCareersUrl(e.target.value)}
              className="w-full px-3 py-2.5 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent bg-[#F8FAFC] text-stone-900 text-sm"
            />
          </div>

          <div>
            <label htmlFor="modal-feedback" className="block text-sm font-medium text-stone-700 mb-1.5">
              What went wrong? (optional)
            </label>
            <textarea
              id="modal-feedback"
              rows={3}
              value={retryFeedback}
              onChange={(e) => setRetryFeedback(e.target.value)}
              placeholder="e.g. The page has more PM jobs than what was found, the company name is wrong..."
              className="w-full px-3 py-2.5 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent bg-[#F8FAFC] text-stone-900 placeholder-stone-400 text-sm resize-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCancelWithFeedback}
              className="flex-1 border border-stone-300 text-stone-600 px-4 py-2.5 rounded-lg font-medium hover:bg-stone-50 transition-all text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { setAddError(""); handleCheck(); }}
              className="flex-1 bg-[#0EA5E9] text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-[#0284C7] transition-all text-sm"
            >
              Re-check
            </button>
          </div>
        </div>
      );
    }

    return null;
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
            onClick={() => handleTabSwitch("catalog")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === "catalog"
                ? "text-[#0EA5E9] border-b-2 border-[#0EA5E9]"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            Browse Catalog
          </button>
          <button
            onClick={() => handleTabSwitch("new")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === "new"
                ? "text-[#0EA5E9] border-b-2 border-[#0EA5E9]"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            Add a New Company
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
                        onClick={() => handleTabSwitch("new")}
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
            renderNewCompanyTab()
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
