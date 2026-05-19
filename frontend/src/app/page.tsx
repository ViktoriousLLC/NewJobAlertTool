"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";

const LandingPage = dynamic(() => import("@/components/LandingPage"), {
  ssr: false,
});

const Dashboard = dynamic(() => import("@/components/DashboardContent"), {
  ssr: false,
});

export default function HomePage() {
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthState(session?.user ? "authenticated" : "unauthenticated");
    });
  }, []);

  if (authState === "loading") return null;
  if (authState === "unauthenticated") return <LandingPage />;

  return <Dashboard />;
}
