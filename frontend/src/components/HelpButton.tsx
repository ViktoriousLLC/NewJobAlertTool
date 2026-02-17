"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

type IssueType = "bug" | "missing_data" | "other";

export default function HelpButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [issueType, setIssueType] = useState<IssueType>("bug");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issue_type: issueType,
          message,
          page_url: window.location.href,
        }),
      });
      setSubmitted(true);
      setMessage("");
      setTimeout(() => {
        setSubmitted(false);
        setIsOpen(false);
      }, 2000);
    } catch (err) {
      console.error("Help form submit failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full bg-[#0C1E3A] text-white shadow-lg hover:bg-[#132B4D] transition-all flex items-center justify-center"
        title="Help & Feedback"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      {/* Help form popup */}
      {isOpen && (
        <div className="fixed bottom-20 right-5 z-50 w-80 bg-white rounded-xl shadow-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1A1A2E]">Help & Feedback</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-stone-400 hover:text-stone-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {submitted ? (
            <div className="p-6 text-center">
              <svg className="w-10 h-10 text-green-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm text-stone-600">Thanks! We&apos;ll look into it.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Category</label>
                <select
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value as IssueType)}
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus:outline-none focus:border-[#0EA5E9]"
                >
                  <option value="bug">Bug Report</option>
                  <option value="missing_data">Missing / Wrong Data</option>
                  <option value="other">Other Feedback</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Details</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  rows={3}
                  placeholder="Tell us what's wrong or what you'd like to see..."
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg resize-none focus:outline-none focus:border-[#0EA5E9] placeholder-stone-400"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !message.trim()}
                className="w-full bg-[#0EA5E9] text-white py-2 rounded-lg text-sm font-semibold hover:bg-[#0284C7] transition-all disabled:opacity-50"
              >
                {submitting ? "Sending..." : "Send Feedback"}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
