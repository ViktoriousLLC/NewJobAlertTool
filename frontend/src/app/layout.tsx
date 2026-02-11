import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import AuthNav from "@/components/AuthNav";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NewPMJobs.com",
  description: "Track product management job postings across companies",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <div className="min-h-screen">
          <nav className="bg-white/80 backdrop-blur-sm border-b border-stone-200 sticky top-0 z-10">
            <div className="max-w-[1800px] mx-auto px-6 py-4 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 bg-[var(--brand)] rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-xs">PM</span>
                </div>
                <span className="text-xl font-bold text-stone-800">
                  NewPMJobs
                </span>
              </Link>
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="border border-stone-300 text-stone-700 px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-stone-700 hover:text-white hover:border-stone-700 transition-all flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  Home
                </Link>
                <Link
                  href="/jobs?filter=starred"
                  className="border border-stone-300 text-stone-700 px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-stone-700 hover:text-white hover:border-stone-700 transition-all flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  Starred
                </Link>
                <Link
                  href="/jobs"
                  className="border border-[var(--brand)] text-[var(--brand)] px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[var(--brand)] hover:text-white transition-all"
                >
                  View All Jobs
                </Link>
                <Link
                  href="/add"
                  className="bg-[var(--brand)] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[var(--brand-hover)] transition-all shadow-md hover:shadow-lg"
                >
                  + Add Company
                </Link>
                <AuthNav />
              </div>
            </div>
          </nav>
          <main className="max-w-[1800px] mx-auto px-6 py-8">{children}</main>
          <footer className="border-t border-stone-200 py-5 text-center text-sm text-stone-400">
            Built by Vik Agarwal
            <span className="mx-2">·</span>
            <a
              href="https://www.linkedin.com/in/vik-agarwal/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-stone-500 hover:text-[var(--brand)] transition-colors underline underline-offset-2"
            >
              LinkedIn
            </a>
          </footer>
        </div>
      </body>
    </html>
  );
}
