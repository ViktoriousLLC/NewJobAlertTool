import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vik's New Job Tool",
  description: "Track product job postings across companies",
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
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="text-xl font-bold text-stone-800">
                  Vik&apos;s New Job Tool
                </span>
              </Link>
              <Link
                href="/add"
                className="bg-[var(--brand)] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[var(--brand-hover)] transition-all shadow-md hover:shadow-lg"
              >
                + Add Company
              </Link>
            </div>
          </nav>
          <main className="max-w-[1800px] mx-auto px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
