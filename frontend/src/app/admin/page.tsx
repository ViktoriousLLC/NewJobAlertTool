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
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/admin/stats").then((r) => {
        if (r.status === 403) throw new Error("access_denied");
        return r.json();
      }),
      apiFetch("/api/admin/issues").then((r) => r.json()),
      apiFetch("/api/admin/users").then((r) => r.json()),
    ])
      .then(([statsData, issuesData, usersData]) => {
        setStats(statsData);
        setScrapeIssues(issuesData.scrape_issues || []);
        setHelpSubmissions(issuesData.help_submissions || []);
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
            <table className="w-full text-sm">
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

      {/* Bug reports (combined) */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm mb-6">
        <h2 className="text-sm font-semibold text-stone-700 mb-3">
          Reports ({scrapeIssues.length + helpSubmissions.length})
        </h2>
        {scrapeIssues.length + helpSubmissions.length === 0 ? (
          <p className="text-sm text-stone-400">No reports yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Message</th>
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {helpSubmissions.map((h) => (
                  <tr key={`help-${h.id}`} className="border-b border-stone-100">
                    <td className="py-2">
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Help</span>
                    </td>
                    <td className="py-2 text-stone-600">{h.issue_type}</td>
                    <td className="py-2 text-[#1A1A2E] max-w-xs truncate">{h.message}</td>
                    <td className="py-2 text-stone-500 text-xs">{h.user_email || h.user_id.slice(0, 8)}</td>
                    <td className="py-2 text-stone-500 text-xs whitespace-nowrap">{formatDateTime(h.created_at)}</td>
                  </tr>
                ))}
                {scrapeIssues.map((s) => (
                  <tr key={`scrape-${s.id}`} className="border-b border-stone-100">
                    <td className="py-2">
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Scrape</span>
                    </td>
                    <td className="py-2 text-stone-600">{s.issue_type}</td>
                    <td className="py-2 text-[#1A1A2E] max-w-xs truncate">{s.description}</td>
                    <td className="py-2 text-stone-500 text-xs">{s.user_id.slice(0, 8)}</td>
                    <td className="py-2 text-stone-500 text-xs whitespace-nowrap">{formatDateTime(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Users table */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm mb-6">
        <h2 className="text-sm font-semibold text-stone-700 mb-3">
          Users ({users.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
