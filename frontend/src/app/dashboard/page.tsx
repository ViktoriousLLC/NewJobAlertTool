"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Personal dashboard — previously the authed view at /. Authed users land
// on the feed by default now; this route is for explicit dashboard access
// (the existing subscribed-companies UI). Unauth visitors get redirected
// to /login.
const Dashboard = dynamic(() => import("@/components/DashboardContent"), {
  ssr: false,
});

export default function DashboardPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"loading" | "authenticated">("loading");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setAuthState("authenticated");
      } else {
        router.push(`/login?next=${encodeURIComponent("/dashboard")}`);
      }
    });
  }, [router]);

  if (authState === "loading") return null;
  return <Dashboard />;
}
