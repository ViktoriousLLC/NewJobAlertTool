"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { identifyUser, trackEvent } from "@/lib/analytics";

export default function AuthNav() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) {
        setEmail(user.email);
        identifyUser(user.email);
      }
    });
  }, []);

  async function handleSignOut() {
    trackEvent("user_signed_out");
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (!email) return null;

  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-[#8B8FA3] truncate max-w-[180px]" title={email}>
        {email}
      </span>
      <button
        onClick={handleSignOut}
        className="border border-white/15 text-[#8B8FA3] bg-transparent px-3 py-1.5 rounded-[6px] text-[13px] font-medium hover:bg-white/10 hover:text-white transition-all"
      >
        Sign Out
      </button>
    </div>
  );
}
