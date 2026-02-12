"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const POSTHOG_KEY = "POSTHOG_KEY_REDACTED";
const POSTHOG_HOST = "https://us.i.posthog.com";

if (typeof window !== "undefined" && !posthog.__loaded) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false, // we handle manually for SPA navigation
    capture_pageleave: true,
  });
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname) {
      let url = window.origin + pathname;
      const search = searchParams.toString();
      if (search) url += `?${search}`;
      posthog.capture("$pageview", { $current_url: url });
    }
  }, [pathname, searchParams]);

  return null;
}

export default function PostHogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  );
}
