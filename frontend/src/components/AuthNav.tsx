"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthNav() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (!email) return null;

  return (
    <div className="flex items-center gap-3 border-l border-stone-200 pl-4 ml-1">
      <span className="text-sm text-stone-500 truncate max-w-[180px]" title={email}>
        {email}
      </span>
      <button
        onClick={handleSignOut}
        className="border border-stone-300 text-stone-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-stone-700 hover:text-white hover:border-stone-700 transition-all"
      >
        Sign Out
      </button>
    </div>
  );
}
