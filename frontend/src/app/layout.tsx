import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import NavBar from "@/components/NavBar";
import PostHogProvider from "@/components/PostHogProvider";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
      <body className={`${outfit.className} antialiased`}>
        <PostHogProvider>
        <div className="min-h-screen">
          <NavBar />
          <main className="max-w-[1400px] mx-auto px-6 py-8">{children}</main>
          <footer className="border-t border-stone-200 py-5 text-center text-sm text-stone-400">
            Built by Vik Agarwal
            <span className="mx-2">&middot;</span>
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
        </PostHogProvider>
      </body>
    </html>
  );
}
