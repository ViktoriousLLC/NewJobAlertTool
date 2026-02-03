"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function AddCompany() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [careersUrl, setCareersUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, careers_url: careersUrl }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add company");
      }

      const company = await res.json();

      if (company.total_product_jobs > 200) {
        const proceed = confirm(
          `Warning: ${company.total_product_jobs} product jobs were found. This is a lot — the initial baseline has been saved. Continue?`
        );
        if (!proceed) {
          // Delete the company if user cancels
          await fetch(`${API_URL}/api/companies/${company.id}`, {
            method: "DELETE",
          });
          setLoading(false);
          return;
        }
      }

      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Company</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Company Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Roblox"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label
            htmlFor="url"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Careers Page URL
          </label>
          <input
            id="url"
            type="url"
            required
            value={careersUrl}
            onChange={(e) => setCareersUrl(e.target.value)}
            placeholder="e.g. https://careers.roblox.com/jobs"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2 rounded-md font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Adding & Scraping..." : "Add Company"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="px-6 py-2 rounded-md font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>

        {loading && (
          <p className="text-sm text-gray-500">
            Running initial scrape — this may take up to a minute...
          </p>
        )}
      </form>
    </div>
  );
}
