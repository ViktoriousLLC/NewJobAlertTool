"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import AuthNav from "./AuthNav";

function NavBarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isHome = pathname === "/";
  const isJobs = pathname === "/jobs";
  const isStarred = isJobs && searchParams.get("filter") === "starred";
  const isAllJobs = isJobs && !isStarred;
  const navBtn =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[13px] font-medium transition-all border";
  const navDefault = `${navBtn} bg-white/[0.07] border-white/15 text-[#D8DBE8] hover:bg-[#132B4D] hover:text-white`;
  const navActive = `${navBtn} bg-[#132B4D] border-white/25 text-white`;

  return (
    <nav className="bg-[#0C1E3A] sticky top-0 z-10" style={{ height: 54 }}>
      <div className="max-w-[1400px] mx-auto px-6 h-full flex items-center justify-between">
        {/* Left: Logo + nav links */}
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 mr-2">
            <div
              className="w-[30px] h-[30px] rounded-lg flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #0EA5E9, #6366F1)",
              }}
            >
              <span className="text-white font-bold text-[10px]">PM</span>
            </div>
            <span className="text-[16px] font-bold text-white tracking-tight">
              NewPMJobs
            </span>
          </Link>

          <Link href="/" className={isHome ? navActive : navDefault}>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
            Home
          </Link>

          <Link
            href="/jobs?filter=starred"
            className={isStarred ? navActive : navDefault}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            Starred
          </Link>

          <Link
            href="/jobs"
            className={isAllJobs ? navActive : navDefault}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            </svg>
            View All Jobs
          </Link>
        </div>

        {/* Right: Add Company + AuthNav */}
        <div className="flex items-center gap-3">
          <Link
            href="/?addCompany=true"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] text-[13px] font-semibold transition-all bg-[#0EA5E9] text-white hover:bg-[#0284C7]"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add Company
          </Link>

          {/* Settings */}
          <Link
            href="/settings"
            className="text-[#8B8FA3] hover:text-white p-1.5 rounded-md hover:bg-white/10 transition-all"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>

          {/* Vertical divider */}
          <div className="w-px h-6 bg-white/15" />

          <AuthNav />
        </div>
      </div>
    </nav>
  );
}

export default function NavBar() {
  return (
    <Suspense
      fallback={
        <nav
          className="bg-[#0C1E3A] sticky top-0 z-10"
          style={{ height: 54 }}
        />
      }
    >
      <NavBarInner />
    </Suspense>
  );
}
