"use client";

import dynamic from "next/dynamic";

// Parallel preview of the job-first feed homepage redesign. Lives at
// /new-home so the existing / route stays unchanged for real users. Visit
// directly via URL to iterate on the design without affecting prod traffic.
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

export default function NewHomePage() {
  return <JobFeed />;
}
