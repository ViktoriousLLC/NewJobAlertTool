"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import LandingHero from "@/components/LandingHero";

// The job-first feed homepage. Took over from the old LandingPage on the
// 2026-05-20 swap; the old landing is preserved at /welcome.
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
  const router = useRouter();

  function handleCtaSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push("/login?next=/");
  }

  return (
    <div
      id="home-scroll"
      className="fixed inset-0 z-0 overflow-y-auto bg-[#081226] pt-[54px]"
      style={{ scrollBehavior: "smooth" }}
    >
      <LandingHero onCtaSubmit={handleCtaSubmit} compact />

      <section
        id="jobs"
        className="scroll-mt-6 px-5 md:px-10 py-12 md:py-16"
        style={{
          background:
            "linear-gradient(180deg, #F0F4F8 0%, #E8EDF4 40%, #F5F3F0 100%)",
        }}
      >
        <div className="max-w-[1140px] mx-auto">
          <JobFeed />
        </div>
      </section>

      <footer className="bg-[#081226] border-t border-white/5 py-6 text-center text-sm text-white/40">
        Built by Vik Agarwal
        <span className="mx-2">·</span>
        <a
          href="https://www.linkedin.com/in/vik-agarwal/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-[#0EA5E9] transition-colors underline underline-offset-2"
        >
          LinkedIn
        </a>
        <span className="mx-2">·</span>
        <a
          href="/privacy"
          className="hover:text-[#0EA5E9] transition-colors underline underline-offset-2"
        >
          Privacy
        </a>
      </footer>
    </div>
  );
}
