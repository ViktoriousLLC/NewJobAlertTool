"use client";

import dynamic from "next/dynamic";

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
  return (
    <>
      <HomeHero />
      <div id="jobs" className="scroll-mt-6">
        <JobFeed />
      </div>
    </>
  );
}

function HomeHero() {
  return (
    <section
      className="relative overflow-hidden rounded-2xl mb-8 px-6 py-12 sm:px-12 sm:py-16"
      style={{
        background:
          "linear-gradient(135deg, #081226 0%, #0F1E3D 55%, #112B5C 100%)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full opacity-30"
        style={{
          background:
            "radial-gradient(closest-side, rgba(14,165,233,0.55), rgba(14,165,233,0) 70%)",
        }}
      />
      <div className="relative max-w-2xl">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-5"
          style={{
            background: "rgba(14,165,233,0.12)",
            border: "1px solid rgba(14,165,233,0.25)",
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-[#0EA5E9] animate-pulse"
          />
          <span className="text-[12px] font-semibold text-[#7DD3FC]">
            Made by a PM, for PMs
          </span>
        </div>

        <h1 className="text-[28px] sm:text-[36px] md:text-[44px] font-[900] leading-[1.08] text-white tracking-tight">
          New PM jobs.{" "}
          <span
            style={{
              background:
                "linear-gradient(135deg, #0EA5E9, #38BDF8, #7DD3FC)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Fresh daily.
          </span>
        </h1>

        <p className="mt-4 text-[15px] sm:text-[16px] leading-[1.65] text-white/65 max-w-[560px]">
          We scan career pages at top tech, fintech, biotech, and consulting
          companies every day and surface every new product management role —
          so you never miss the one at your dream company.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-white/55">
          <span className="inline-flex items-center gap-2">
            <span className="text-[#7DD3FC]">↓</span> See open roles below
          </span>
          <span className="hidden sm:inline text-white/25">·</span>
          <span>Free. No spam. No credit card.</span>
        </div>
      </div>
    </section>
  );
}
