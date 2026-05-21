"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";

interface AuthNavProps {
  email: string | null;
}

export default function AuthNav({ email }: AuthNavProps) {
  const router = useRouter();

  async function handleSignOut() {
    trackEvent("user_signed_out");
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (!email) {
    return (
      <Link
        href="/login"
        className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-3.5 py-1.5 rounded-[6px] text-[13px] font-semibold transition-all"
      >
        Sign In
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-[#8B8FA3] truncate max-w-[140px] sm:max-w-[180px]" title={email}>
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
