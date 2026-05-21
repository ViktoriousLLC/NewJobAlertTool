"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";

// Preserves the original authed-/ dashboard ("Tracked Companies" view).
// Authed users only — unauth bounces to /login.
const Dashboard = dynamic(() => import("@/components/DashboardContent"), {
  ssr: false,
});

export default function CompaniesPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthState(session?.user ? "authenticated" : "unauthenticated");
    });
  }, []);

  useEffect(() => {
    if (authState === "unauthenticated") {
      router.replace("/login?next=/companies");
    }
  }, [authState, router]);

  if (authState !== "authenticated") return null;
  return <Dashboard />;
}
