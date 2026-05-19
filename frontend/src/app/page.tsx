"use client";

import dynamic from "next/dynamic";

// Job-first feed landing — replaces the prior auth-gated split where
// unauth saw the marketing landing and authed saw a personal dashboard.
// Marketing landing moved to /about; the dashboard moved to /dashboard.
const JobFeed = dynamic(() => import("@/components/JobFeed"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20">
      <div className="animate-pulse flex items-center gap-2 text-stone-500">
        Loading latest jobs…
      </div>
    </div>
  ),
});

export default function HomePage() {
  return <JobFeed />;
}
