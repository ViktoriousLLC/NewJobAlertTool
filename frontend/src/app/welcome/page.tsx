"use client";

import dynamic from "next/dynamic";

// Permanent backup of the original marketing landing page (was at / until
// /new-home took over). Kept live in case we ever need to point external
// links here, or roll back the / swap. LandingPage uses fixed inset-0
// z-[200] internally so it takes over the viewport — no global NavBar.
const LandingPage = dynamic(() => import("@/components/LandingPage"), {
  ssr: false,
});

export default function WelcomePage() {
  return <LandingPage />;
}
