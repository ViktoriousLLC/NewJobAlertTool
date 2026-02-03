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

export default function CompanyDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);

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
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-semibold text-gray-700 mb-4">
          Company not found
        </h2>
        <Link href="/" className="text-blue-600 hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  // Group jobs by date (already sorted newest first from API)
  const jobsByDate = new Map<string, Job[]>();
  for (const job of company.jobs) {
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
      <Link href="/" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
        &larr; Back to dashboard
      </Link>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {company.name}
        </h1>
        <a
          href={company.careers_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline text-sm"
        >
          {company.careers_url}
        </a>
        <div className="mt-4 flex gap-6 text-sm text-gray-600">
          <div>
            <span className="font-medium">Total product jobs:</span>{" "}
            {company.total_product_jobs}
          </div>
          <div>
            <span className="font-medium">Last checked:</span>{" "}
            {company.last_checked_at
              ? new Date(company.last_checked_at).toLocaleString()
              : "Never"}
          </div>
          <div>
            <span className="font-medium">Status:</span>{" "}
            {company.last_check_status || "Pending"}
          </div>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        All Product Jobs ({company.jobs.length})
      </h2>

      {company.jobs.length === 0 ? (
        <p className="text-gray-500">No jobs found.</p>
      ) : (
        <div className="space-y-6">
          {Array.from(jobsByDate.entries()).map(([date, jobs]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-gray-500 mb-2">{date}</h3>
              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                {jobs.map((job) => (
                  <div key={job.id} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {!job.is_baseline && (
                        <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-xs font-medium shrink-0">
                          NEW
                        </span>
                      )}
                      <span className="text-gray-900 truncate">{job.job_title}</span>
                    </div>
                    {job.job_location && (
                      <span className="text-gray-500 text-sm shrink-0 max-w-[200px] truncate">
                        {job.job_location}
                      </span>
                    )}
                    <a
                      href={buildJobUrl(job.job_url_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-sm shrink-0"
                    >
                      View Job
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
