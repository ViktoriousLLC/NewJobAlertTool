"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface Company {
  id: string;
  name: string;
  careers_url: string;
  created_at: string;
  last_checked_at: string | null;
  last_check_status: string | null;
  total_product_jobs: number;
  new_jobs_30d: number;
}

export default function Dashboard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCompanies();
  }, []);

  async function fetchCompanies() {
    try {
      const res = await fetch(`${API_URL}/api/companies`);
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
      await fetch(`${API_URL}/api/companies/${id}`, { method: "DELETE" });
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
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-semibold text-gray-700 mb-2">
          No companies tracked yet
        </h2>
        <p className="text-gray-500 mb-6">
          Add a company to start tracking product job postings.
        </p>
        <Link
          href="/add"
          className="bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700 transition-colors"
        >
          + Add Company
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Tracked Companies
      </h1>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                Company
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                Last Checked
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-600">
                Total Jobs
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-600">
                New (30d)
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-600">
                Status
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {companies.map((company) => (
              <tr key={company.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/company/${company.id}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {company.name}
                  </Link>
                  <div className="text-xs text-gray-400 truncate max-w-xs">
                    {company.careers_url}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {formatDate(company.last_checked_at)}
                </td>
                <td className="px-4 py-3 text-sm text-center text-gray-700">
                  {company.total_product_jobs}
                </td>
                <td className="px-4 py-3 text-sm text-center">
                  {company.new_jobs_30d > 0 ? (
                    <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs font-medium">
                      {company.new_jobs_30d} new
                    </span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-center">
                  {company.last_check_status === "success" ? (
                    <span className="text-green-600">OK</span>
                  ) : company.last_check_status?.startsWith("error") ? (
                    <span className="text-red-600" title={company.last_check_status}>
                      Error
                    </span>
                  ) : (
                    <span className="text-gray-400">Pending</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => deleteCompany(company.id, company.name)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
