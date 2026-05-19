"use client";

import dynamic from "next/dynamic";

// Marketing landing — previously at /, now at /about. Kept verbatim so the
// pitch stays available for anyone who wants the "what is this site" story.
const LandingPage = dynamic(() => import("@/components/LandingPage"), {
  ssr: false,
});

export default function AboutPage() {
  return <LandingPage />;
}
