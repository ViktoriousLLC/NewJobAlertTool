"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Redirect to dashboard with modal open
export default function AddCompanyRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/?addCompany=true");
  }, [router]);

  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-pulse text-stone-500">Redirecting...</div>
    </div>
  );
}
