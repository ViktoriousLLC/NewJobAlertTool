"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import LandingHero from "./LandingHero";

/* ─── exported helpers ─── */

export function mix(hex: string, pct: number): string {
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  const f = pct / 100;
  return `rgb(${Math.round(r + (255 - r) * f)},${Math.round(g + (255 - g) * f)},${Math.round(b + (255 - b) * f)})`;
}

export function useInView(opts: IntersectionObserverInit = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const o = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setV(true);
          o.disconnect();
        }
      },
      { threshold: 0.1, ...opts }
    );
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return [ref, v] as const;
}

export function Reveal({
  children,
  delay = 0,
  y = 30,
  style = {},
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  style?: React.CSSProperties;
}) {
  const [ref, v] = useInView();
  return (
    <div
      ref={ref}
      style={{
        opacity: v ? 1 : 0,
        transform: v ? "translateY(0)" : `translateY(${y}px)`,
        transition: `opacity 0.7s cubic-bezier(.22,.68,0,.71) ${delay}s, transform 0.7s cubic-bezier(.22,.68,0,.71) ${delay}s`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ─── exported data ─── */

export const COMPANIES = [
  { name: "Google", color: "#4285F4", letter: "G" },
  { name: "Netflix", color: "#E50914", letter: "N" },
  { name: "Stripe", color: "#635BFF", letter: "S" },
  { name: "Uber", color: "#000000", letter: "U" },
  { name: "Airbnb", color: "#FF5A5F", letter: "A" },
  { name: "OpenAI", color: "#10A37F", letter: "O" },
  { name: "Anthropic", color: "#D4A574", letter: "A" },
  { name: "Discord", color: "#5865F2", letter: "D" },
  { name: "Figma", color: "#A259FF", letter: "F" },
  { name: "Roblox", color: "#E2231A", letter: "R" },
  { name: "DoorDash", color: "#FF3008", letter: "D" },
  { name: "Reddit", color: "#FF4500", letter: "R" },
  { name: "Meta", color: "#0668E1", letter: "M" },
  { name: "Instacart", color: "#43B02A", letter: "I" },
  { name: "PayPal", color: "#003087", letter: "P" },
  { name: "Cisco", color: "#049FD9", letter: "C" },
];

export const SAMPLE_JOBS = [
  { company: "Google", color: "#4285F4", title: "Senior Product Manager, Cloud AI", location: "Mountain View, CA", salary: "$198K - $284K", posted: "2 hours ago" },
  { company: "Stripe", color: "#635BFF", title: "Product Manager, Payment Methods", location: "San Francisco, CA", salary: "$176K - $264K", posted: "5 hours ago" },
  { company: "Netflix", color: "#E50914", title: "Director of Product, Content Platform", location: "Los Gatos, CA", salary: "$270K - $420K", posted: "1 day ago" },
  { company: "Airbnb", color: "#FF5A5F", title: "Product Manager II, Search & Discovery", location: "Remote (US)", salary: "$160K - $215K", posted: "1 day ago" },
  { company: "Discord", color: "#5865F2", title: "Senior PM, Safety & Trust", location: "San Francisco, CA", salary: "$183K - $210K", posted: "3 days ago" },
  { company: "OpenAI", color: "#10A37F", title: "Product Manager, API Platform", location: "San Francisco, CA", salary: "$245K - $385K", posted: "4 days ago" },
  { company: "Roblox", color: "#E2231A", title: "Senior PM, Creator Monetization", location: "San Mateo, CA", salary: "$220K - $295K", posted: "5 days ago" },
  { company: "Meta", color: "#0668E1", title: "Product Manager, AI Experiences", location: "Menlo Park, CA", salary: "$185K - $267K", posted: "5 days ago" },
  { company: "Figma", color: "#A259FF", title: "PM, Developer Platform", location: "San Francisco, CA", salary: "$168K - $245K", posted: "6 days ago" },
];

/* ─── pre-computed colors (avoids ~24 runtime mix() calls per render) ─── */

export const COMPANY_COLORS = Object.fromEntries(
  COMPANIES.map((co) => [
    co.color,
    {
      bg96: mix(co.color, 96),
      grad55: mix(co.color, 55),
      grad30: mix(co.color, 30),
      grad60: mix(co.color, 60),
      grad35: mix(co.color, 35),
    },
  ])
) as Record<string, { bg96: string; grad55: string; grad30: string; grad60: string; grad35: string }>;

/* ─── lazy below-fold (sections 3-10) ─── */

const LandingBelowFold = dynamic(() => import("./LandingBelowFold"), {
  ssr: false,
});

/* ─── sub-components ─── */

function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const container = document.getElementById("landing-scroll-container");
    if (!container) return;
    const h = () => setScrolled(container.scrollTop > 20);
    container.addEventListener("scroll", h);
    return () => container.removeEventListener("scroll", h);
  }, []);

  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: scrolled ? "rgba(8, 18, 38, 0.92)" : "transparent",
        backdropFilter: scrolled ? "blur(20px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.06)" : "none",
        transition: "all 0.3s ease",
      }}
    >
      <div
        className="px-5 md:px-10"
        style={{
          maxWidth: 1140,
          margin: "0 auto",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: "1.5px",
            }}
          >
            PM
          </div>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>NewPMJobs</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <a href="#how-it-works" className="hidden sm:inline" style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 500, textDecoration: "none" }}>
            How it Works
          </a>
          <a href="#jobs" className="hidden sm:inline" style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 500, textDecoration: "none" }}>
            Latest Jobs
          </a>
          <Link
            href="/login"
            style={{
              background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
              color: "#fff",
              border: "none",
              padding: "9px 22px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Sign In
          </Link>
        </div>
      </div>
    </nav>
  );
}

interface HeroCardCompany {
  name: string;
  color: string;
  letter: string;
  roles: number;
  newCount: number;
}

function HeroCard({
  co,
  delay,
  style: s,
  noFloat,
}: {
  co: HeroCardCompany;
  delay: number;
  style?: React.CSSProperties;
  noFloat?: boolean;
}) {
  const colors = COMPANY_COLORS[co.color];
  return (
    <div
      style={{
        background: colors.bg96,
        borderRadius: 12,
        overflow: "hidden",
        width: 155,
        flexShrink: 0,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        ...(noFloat
          ? {}
          : {
              animation: `heroFloat ${3 + delay * 0.5}s ease-in-out infinite alternate`,
              animationDelay: `${delay}s`,
            }),
        border: "1px solid rgba(255,255,255,0.08)",
        ...s,
      }}
    >
      <div
        style={{
          background: `linear-gradient(135deg, ${colors.grad55}, ${colors.grad30})`,
          padding: "6px 9px",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            background: co.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          {co.letter}
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1A2E" }}>{co.name}</span>
      </div>
      <div style={{ padding: "12px 8px", textAlign: "center" }}>
        {co.newCount > 0 && (
          <span
            style={{
              background: "#E8F5EE",
              color: "#16874D",
              fontSize: 8,
              fontWeight: 700,
              padding: "2px 7px",
              borderRadius: 4,
              display: "inline-block",
              marginBottom: 5,
            }}
          >
            +{co.newCount} new
          </span>
        )}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#1A1A2E" }}>{co.roles}</span>
          <span style={{ fontSize: 10, fontWeight: 500, color: "#6E6E80" }}>roles</span>
        </div>
      </div>
    </div>
  );
}

function ToastNotification({
  company,
  role,
  slideDelay,
  marginTop = -18,
  marginLeft = 0,
  zIndex = 10,
}: {
  company: string;
  role: string;
  slideDelay: number;
  marginTop?: number;
  marginLeft?: number;
  zIndex?: number;
}) {
  return (
    <div
      style={{
        marginTop,
        marginLeft,
        background: "rgba(255,255,255,0.97)",
        borderRadius: 12,
        padding: "10px 14px",
        boxShadow: "0 12px 48px rgba(0,0,0,0.2)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex,
        animation: `slideIn 0.5s ease ${slideDelay}s both`,
        border: "1px solid rgba(14,165,233,0.15)",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 800,
          fontSize: 10,
          flexShrink: 0,
        }}
      >
        PM
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>New PM role at {company}</div>
        <div style={{ fontSize: 10, color: "#6E6E80" }}>{role}</div>
      </div>
    </div>
  );
}

/* ─── main landing page ─── */

export default function LandingPage() {
  const router = useRouter();

  function handleCtaSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push("/login");
  }

  return (
    <div
      id="landing-scroll-container"
      className="fixed inset-0 z-[200] overflow-y-auto"
      style={{ scrollBehavior: "smooth" }}
    >
      <LandingNav />

      <LandingHero onCtaSubmit={handleCtaSubmit} />

      <LandingBelowFold onCtaSubmit={handleCtaSubmit} />
    </div>
  );
}
