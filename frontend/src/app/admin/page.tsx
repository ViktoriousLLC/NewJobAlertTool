"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface Stats {
  total_users: number;
  total_companies: number;
  active_jobs: number;
  total_subscriptions: number;
  recent_signups_7d: number;
  error_companies: { id: string; name: string; last_check_status: string; last_checked_at: string }[];
}

interface ScrapeIssue {
  id: string;
  company_id: string;
  user_id: string;
  issue_type: string;
  description: string;
  created_at: string;
  company_name: string;
  user_email: string | null;
}

interface HelpSubmission {
  id: string;
  user_id: string;
  user_email: string | null;
  issue_type: string;
  message: string;
  page_url: string | null;
  created_at: string;
}

interface CompanyRow {
  id: string;
  name: string;
  careers_url: string;
  total_product_jobs: number;
  subscriber_count: number;
  is_active: boolean;
  last_checked_at: string | null;
  last_check_status: string | null;
}

interface UserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  subscriptions: number;
  email_frequency: string;
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [scrapeIssues, setScrapeIssues] = useState<ScrapeIssue[]>([]);
  const [helpSubmissions, setHelpSubmissions] = useState<HelpSubmission[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/admin/stats").then((r) => {
        if (r.status === 403) throw new Error("access_denied");
        return r.json();
      }),
      apiFetch("/api/admin/issues").then((r) => r.json()),
      apiFetch("/api/admin/companies").then((r) => r.json()),
      apiFetch("/api/admin/users").then((r) => r.json()),
    ])
      .then(([statsData, issuesData, companiesData, usersData]) => {
        setStats(statsData);
        setScrapeIssues(issuesData.scrape_issues || []);
        setHelpSubmissions(issuesData.help_submissions || []);
        setCompanies(companiesData || []);
        setUsers(usersData || []);
      })
      .catch((err) => {
        if (err.message === "access_denied") {
          setAccessDenied(true);
        } else {
          console.error("Admin fetch failed:", err);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-stone-500">Loading admin dashboard...</div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <h1 className="text-xl font-bold text-[#1A1A2E] mb-2">Access Denied</h1>
        <p className="text-stone-500 text-sm">You don&apos;t have permission to view this page.</p>
        <Link href="/" className="text-[#0EA5E9] hover:underline text-sm mt-4 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatDateTime(dateStr: string | null) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  async function handleDeleteCompany(company: CompanyRow) {
    if (!confirm(`Delete "${company.name}" for all users? This removes the company and all its jobs.`)) {
      return;
    }
    setDeletingCompanyId(company.id);
    try {
      const res = await apiFetch(`/api/companies/${company.id}?hard=true`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to delete company");
        return;
      }
      setCompanies((prev) => prev.filter((c) => c.id !== company.id));
    } catch (err) {
      console.error("Delete company failed:", err);
      alert("Failed to delete company");
    } finally {
      setDeletingCompanyId(null);
    }
  }

  const statCards = [
    { label: "Users", value: stats?.total_users ?? 0 },
    { label: "Companies", value: stats?.total_companies ?? 0 },
    { label: "Active Jobs", value: stats?.active_jobs ?? 0 },
    { label: "Subscriptions", value: stats?.total_subscriptions ?? 0 },
    { label: "Signups (7d)", value: stats?.recent_signups_7d ?? 0 },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-700 text-sm mb-6 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to dashboard
      </Link>

      <h1 className="text-xl font-bold text-[#1A1A2E] mb-6">Admin Dashboard</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm">
            <div className="text-2xl font-bold text-[#1A1A2E]">{s.value}</div>
            <div className="text-xs text-stone-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Error companies */}
      {stats?.error_companies && stats.error_companies.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm mb-6">
          <h2 className="text-sm font-semibold text-red-700 mb-3">
            Error Companies ({stats.error_companies.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="pb-2 font-medium">Company</th>
                  <th className="pb-2 font-medium">Last Error</th>
                  <th className="pb-2 font-medium">Last Checked</th>
                </tr>
              </thead>
              <tbody>
                {stats.error_companies.map((c) => (
                  <tr key={c.id} className="border-b border-stone-100">
                    <td className="py-2 text-[#1A1A2E] font-medium">{c.name}</td>
                    <td className="py-2 text-red-600 text-xs max-w-xs truncate">{c.last_check_status}</td>
                    <td className="py-2 text-stone-500 text-xs">{formatDateTime(c.last_checked_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bug reports (combined, sorted by date) */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm mb-6">
        <h2 className="text-sm font-semibold text-stone-700 mb-3">
          Reports ({scrapeIssues.length + helpSubmissions.length})
        </h2>
        {scrapeIssues.length + helpSubmissions.length === 0 ? (
          <p className="text-sm text-stone-400">No reports yet.</p>
        ) : (
          <div className="space-y-2">
            {/* Merge and sort all reports by date */}
            {[
              ...helpSubmissions.map((h) => ({
                key: `help-${h.id}`,
                source: "Help" as const,
                type: h.issue_type,
                preview: h.message,
                detail: h.message,
                user: h.user_email || h.user_id.slice(0, 8),
                company: null as string | null,
                pageUrl: h.page_url,
                date: h.created_at,
              })),
              ...scrapeIssues.map((s) => ({
                key: `scrape-${s.id}`,
                source: "Scrape" as const,
                type: s.issue_type,
                preview: s.description || "(no description)",
                detail: s.description || "(no description)",
                user: s.user_email || s.user_id.slice(0, 8),
                company: s.company_name,
                pageUrl: null as string | null,
                date: s.created_at,
              })),
            ]
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              .map((report) => {
                const isExpanded = expandedReport === report.key;
                return (
                  <div
                    key={report.key}
                    className={`border rounded-lg transition-colors ${isExpanded ? "border-stone-300 bg-stone-50" : "border-stone-200 hover:bg-stone-50"}`}
                  >
                    <button
                      onClick={() => setExpandedReport(isExpanded ? null : report.key)}
                      className="w-full text-left px-3 sm:px-4 py-3 flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-3"
                    >
                      <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                        report.source === "Help" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        {report.source}
                      </span>
                      <span className="text-xs text-stone-500 shrink-0 w-24">{report.type}</span>
                      <span className="text-sm text-[#1A1A2E] flex-1 truncate">{report.preview}</span>
                      <span className="text-xs text-stone-400 shrink-0 whitespace-nowrap">{formatDateTime(report.date)}</span>
                      <svg
                        className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3 border-t border-stone-200 pt-3 space-y-2 text-sm">
                        <div>
                          <span className="text-stone-500 text-xs font-medium">Full message:</span>
                          <p className="text-[#1A1A2E] mt-0.5 whitespace-pre-wrap">{report.detail}</p>
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-500">
                          <span><span className="font-medium">User:</span> {report.user}</span>
                          {report.company && <span><span className="font-medium">Company:</span> {report.company}</span>}
                          {report.pageUrl && <span><span className="font-medium">Page:</span> {report.pageUrl}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Companies table */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm mb-6">
        <h2 className="text-sm font-semibold text-stone-700 mb-3">
          Companies ({companies.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="pb-2 font-medium">Company</th>
                <th className="pb-2 font-medium">PM Roles</th>
                <th className="pb-2 font-medium">Subscribers</th>
                <th className="pb-2 font-medium">Last Checked</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const isError = c.last_check_status?.startsWith("error");
                return (
                  <tr key={c.id} className="border-b border-stone-100">
                    <td className="py-2 text-[#1A1A2E] font-medium">{c.name}</td>
                    <td className="py-2 text-stone-600">{c.total_product_jobs}</td>
                    <td className="py-2 text-stone-600">{c.subscriber_count}</td>
                    <td className="py-2 text-stone-500 text-xs">{formatDateTime(c.last_checked_at)}</td>
                    <td className="py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        isError
                          ? "bg-red-100 text-red-700"
                          : "bg-green-100 text-green-700"
                      }`}>
                        {isError ? "error" : "ok"}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleDeleteCompany(c)}
                        disabled={deletingCompanyId === c.id}
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingCompanyId === c.id ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Users table */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm mb-6">
        <h2 className="text-sm font-semibold text-stone-700 mb-3">
          Users ({users.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="pb-2 font-medium">Email</th>
                <th className="pb-2 font-medium">Signed Up</th>
                <th className="pb-2 font-medium">Last Sign In</th>
                <th className="pb-2 font-medium">Subs</th>
                <th className="pb-2 font-medium">Email Pref</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-stone-100">
                  <td className="py-2 text-[#1A1A2E] font-medium">{u.email}</td>
                  <td className="py-2 text-stone-500 text-xs">{formatDate(u.created_at)}</td>
                  <td className="py-2 text-stone-500 text-xs">{formatDate(u.last_sign_in_at)}</td>
                  <td className="py-2 text-stone-600">{u.subscriptions}</td>
                  <td className="py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      u.email_frequency === "daily"
                        ? "bg-green-100 text-green-700"
                        : u.email_frequency === "weekly"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-stone-100 text-stone-500"
                    }`}>
                      {u.email_frequency}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
