"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/Toast";

export default function SettingsPage() {
  const [emailFrequency, setEmailFrequency] = useState<"daily" | "weekly" | "off">("daily");
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch("/api/preferences")
      .then((res) => res.json())
      .then((data) => {
        setEmailFrequency(data.email_frequency || "daily");
      })
      .catch((err) => { console.error("Failed to load preferences:", err); showToast("Failed to load preferences."); })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(newFrequency: "daily" | "weekly" | "off") {
    setEmailFrequency(newFrequency);
    setSaving(true);
    try {
      await apiFetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_frequency: newFrequency }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save preferences:", err);
      showToast("Failed to save preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-stone-500">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-700 text-sm mb-6 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to dashboard
      </Link>

      <div className="bg-white rounded-xl border border-stone-200 p-4 sm:p-6 shadow-sm">
        <h1 className="text-xl font-bold text-[#1A1A2E] mb-1">Settings</h1>
        <p className="text-sm text-stone-500 mb-6">Manage your notification preferences</p>

        {/* Email frequency */}
        <div>
          <h2 className="text-sm font-semibold text-stone-700 mb-3">Email Alerts</h2>
          <div className="space-y-2">
            <label
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all ${
                emailFrequency === "daily"
                  ? "border-[#0EA5E9] bg-blue-50"
                  : "border-stone-200 hover:bg-stone-50"
              }`}
              onClick={() => handleSave("daily")}
            >
              <input
                type="radio"
                name="email"
                checked={emailFrequency === "daily"}
                onChange={() => handleSave("daily")}
                className="text-[#0EA5E9] focus:ring-[#0EA5E9]"
              />
              <div>
                <div className="text-sm font-medium text-[#1A1A2E]">Daily digest</div>
                <div className="text-xs text-stone-500">
                  Receive a daily email with new PM jobs from your tracked companies
                </div>
              </div>
            </label>

            <label
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all ${
                emailFrequency === "weekly"
                  ? "border-[#0EA5E9] bg-blue-50"
                  : "border-stone-200 hover:bg-stone-50"
              }`}
              onClick={() => handleSave("weekly")}
            >
              <input
                type="radio"
                name="email"
                checked={emailFrequency === "weekly"}
                onChange={() => handleSave("weekly")}
                className="text-[#0EA5E9] focus:ring-[#0EA5E9]"
              />
              <div>
                <div className="text-sm font-medium text-[#1A1A2E]">Weekly digest</div>
                <div className="text-xs text-stone-500">
                  Receive a weekly email every Monday with new PM jobs from the past 7 days
                </div>
              </div>
            </label>

            <label
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all ${
                emailFrequency === "off"
                  ? "border-[#0EA5E9] bg-blue-50"
                  : "border-stone-200 hover:bg-stone-50"
              }`}
              onClick={() => handleSave("off")}
            >
              <input
                type="radio"
                name="email"
                checked={emailFrequency === "off"}
                onChange={() => handleSave("off")}
                className="text-[#0EA5E9] focus:ring-[#0EA5E9]"
              />
              <div>
                <div className="text-sm font-medium text-[#1A1A2E]">Off</div>
                <div className="text-xs text-stone-500">
                  No email alerts. You can still check the dashboard anytime.
                </div>
              </div>
            </label>
          </div>

          {saved && (
            <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
