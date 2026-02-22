"use client";

import { useState } from "react";
import Link from "next/link";
import { Reveal, COMPANIES, SAMPLE_JOBS, COMPANY_COLORS } from "./LandingPage";

/* ─── sub-components ─── */

function StepCard({
  number,
  title,
  desc,
  icon,
  delay,
}: {
  number: string;
  title: string;
  desc: string;
  icon: string;
  delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <div
        style={{
          background: "rgba(255,255,255,0.6)",
          backdropFilter: "blur(16px)",
          borderRadius: 16,
          padding: "32px 28px",
          border: "1px solid rgba(255,255,255,0.5)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.03)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -10,
            right: -6,
            fontSize: 80,
            fontWeight: 900,
            color: "rgba(14,165,233,0.06)",
            lineHeight: 1,
          }}
        >
          {number}
        </div>
        <div style={{ fontSize: 28, marginBottom: 14 }}>{icon}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0C1E3A", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 15, color: "#6E6E80", lineHeight: 1.6, fontWeight: 430 }}>{desc}</div>
      </div>
    </Reveal>
  );
}

function JobRow({ job, delay }: { job: (typeof SAMPLE_JOBS)[number]; delay: number }) {
  const [hov, setHov] = useState(false);
  return (
    <Reveal delay={delay}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-[14px]"
        style={{
          background: hov ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.6)",
          backdropFilter: "blur(12px)",
          border: hov ? "1px solid #0EA5E9" : "1px solid rgba(224,224,230,0.5)",
          borderRadius: 12,
          padding: "16px 20px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          transform: hov ? "translateY(-2px)" : "none",
          boxShadow: hov ? "0 8px 24px rgba(14,165,233,0.1)" : "0 1px 4px rgba(0,0,0,0.02)",
        }}
      >
        <div className="flex items-center gap-3 sm:gap-[14px] flex-1 min-w-0">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: job.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {job.company[0]}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-[14px] sm:text-[15px]" style={{ fontWeight: 650, color: "#0C1E3A", marginBottom: 3 }}>{job.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "#6E6E80", fontWeight: 500 }}>{job.company}</span>
              <span style={{ fontSize: 11, color: "#C0C0CC" }}>|</span>
              <span style={{ fontSize: 13, color: "#6E6E80", fontWeight: 500 }}>{job.location}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:block sm:text-right ml-[52px] sm:ml-0" style={{ flexShrink: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#16874D",
              background: "#E8F5EE",
              padding: "3px 10px",
              borderRadius: 6,
              marginBottom: 0,
              display: "inline-block",
            }}
            className="sm:mb-1"
          >
            {job.salary}
          </div>
          <div style={{ fontSize: 12, color: "#9494A8", fontWeight: 500 }}>{job.posted}</div>
        </div>
      </div>
    </Reveal>
  );
}

/* ─── mock screens ─── */

function DashboardMock() {
  const cards = [
    { name: "Google", color: "#4285F4", roles: 44, newCount: 2 },
    { name: "Stripe", color: "#635BFF", roles: 33, newCount: 1 },
    { name: "Netflix", color: "#E50914", roles: 35, newCount: 0 },
    { name: "Uber", color: "#000000", roles: 45, newCount: 1 },
    { name: "Airbnb", color: "#FF5A5F", roles: 6, newCount: 0 },
  ];
  return (
    <div style={{ background: "#FBFBFC", borderRadius: 10, padding: 16, border: "1px solid rgba(224,224,230,0.5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF5F56" }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFBD2E" }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#27C93F" }} />
        <span style={{ fontSize: 11, color: "#9494A8", marginLeft: 8, fontWeight: 500 }}>Dashboard</span>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-1.5">
        {cards.map((co) => {
          const c = COMPANY_COLORS[co.color];
          return (
            <div key={co.name} style={{ borderRadius: 7, overflow: "hidden", background: c.bg96, border: "1px solid #E0E0E6" }}>
              <div
                style={{
                  background: `linear-gradient(135deg, ${c.grad60}, ${c.grad35})`,
                  padding: "5px 7px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    background: co.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 8,
                    fontWeight: 700,
                  }}
                >
                  {co.name[0]}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1A1A2E" }}>{co.name}</span>
              </div>
              <div style={{ padding: "10px 6px", textAlign: "center" }}>
                {co.newCount > 0 && (
                  <div
                    style={{
                      background: "#E8F5EE",
                      color: "#16874D",
                      fontSize: 7,
                      fontWeight: 700,
                      padding: "1px 5px",
                      borderRadius: 3,
                      display: "inline-block",
                      marginBottom: 4,
                    }}
                  >
                    +{co.newCount} new
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 2 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#1A1A2E" }}>{co.roles}</span>
                  <span style={{ fontSize: 8, color: "#6E6E80" }}>roles</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JobsListMock() {
  const jobs = [
    { company: "Google", color: "#4285F4", title: "Sr. Product Manager, Cloud AI", loc: "Mountain View", sal: "$198K-$284K" },
    { company: "Stripe", color: "#635BFF", title: "PM, Payment Methods", loc: "San Francisco", sal: "$176K-$264K" },
    { company: "Netflix", color: "#E50914", title: "Dir. of Product, Content", loc: "Los Gatos", sal: "$270K-$420K" },
  ];
  return (
    <div style={{ background: "#FBFBFC", borderRadius: 10, padding: 16, border: "1px solid rgba(224,224,230,0.5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF5F56" }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFBD2E" }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#27C93F" }} />
        <span style={{ fontSize: 11, color: "#9494A8", marginLeft: 8, fontWeight: 500 }}>All Jobs</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {jobs.map((j) => (
          <div
            key={j.title}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              background: "#fff",
              borderRadius: 7,
              border: "1px solid #E0E0E6",
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 5,
                background: j.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {j.company[0]}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 650, color: "#0C1E3A" }}>{j.title}</div>
              <div style={{ fontSize: 8, color: "#6E6E80" }}>
                {j.company} | {j.loc}
              </div>
            </div>
            <span style={{ fontSize: 8, fontWeight: 700, color: "#16874D", background: "#E8F5EE", padding: "2px 6px", borderRadius: 3 }}>
              {j.sal}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function JobDetailMock() {
  return (
    <div style={{ background: "#FBFBFC", borderRadius: 10, padding: 16, border: "1px solid rgba(224,224,230,0.5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF5F56" }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFBD2E" }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#27C93F" }} />
        <span style={{ fontSize: 11, color: "#9494A8", marginLeft: 8, fontWeight: 500 }}>Job Detail</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 7,
            background: "#4285F4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          G
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0C1E3A" }}>Sr. Product Manager, Cloud AI</div>
          <div style={{ fontSize: 9, color: "#6E6E80" }}>Google | Mountain View, CA</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {["Senior", "$198K-$284K", "Full-time", "Hybrid"].map((t) => (
          <span key={t} style={{ fontSize: 8, fontWeight: 600, color: "#0C1E3A", background: "#F0F0F4", padding: "2px 7px", borderRadius: 4 }}>
            {t}
          </span>
        ))}
      </div>
      <div
        style={{
          padding: "8px 10px",
          background: "linear-gradient(135deg, #FFFBF0, #FFF5E0)",
          border: "1px solid #F0DEB0",
          borderRadius: 6,
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 8, fontWeight: 700, color: "#B8860B", marginBottom: 2 }}>Salary Data from levels.fyi</div>
        <div style={{ display: "flex", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>$245K</div>
            <div style={{ fontSize: 7, color: "#6E6E80" }}>Median Total</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>$198K</div>
            <div style={{ fontSize: 7, color: "#6E6E80" }}>Base</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>$47K</div>
            <div style={{ fontSize: 7, color: "#6E6E80" }}>Stock/yr</div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          style={{
            flex: 1,
            background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
            color: "#fff",
            border: "none",
            padding: "6px 0",
            borderRadius: 5,
            fontSize: 9,
            fontWeight: 700,
            fontFamily: "inherit",
          }}
        >
          Apply on Google
        </button>
        <button
          style={{
            background: "#fff",
            border: "1px solid #E0E0E6",
            color: "#0C1E3A",
            padding: "6px 12px",
            borderRadius: 5,
            fontSize: 9,
            fontWeight: 600,
            fontFamily: "inherit",
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/* ─── sections 3-10 ─── */

export default function LandingBelowFold({ onCtaSubmit }: { onCtaSubmit: (e: React.FormEvent) => void }) {
  return (
    <>
      {/* PROBLEM */}
      <section style={{ background: "linear-gradient(180deg, #F0F4F8 0%, #E8EDF4 40%, #F5F3F0 100%)", padding: "100px 0 60px" }}>
        <div className="px-5 md:px-10" style={{ maxWidth: 1140, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#A14B38", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                The problem with PM job hunting
              </span>
              <h2 className="text-[28px] sm:text-[34px] md:text-[38px]" style={{ fontWeight: 800, color: "#0C1E3A", lineHeight: 1.15, marginTop: 12, letterSpacing: "-0.015em" }}>
                Job boards weren{"'"}t built for product managers.
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ maxWidth: 900, margin: "0 auto" }}>
            {[
              {
                icon: "\uD83D\uDD0D",
                title: "PM roles are buried in noise",
                desc: 'Search "product manager" and you get production managers, project managers, and product engineers. Finding real PM roles takes forever.',
              },
              {
                icon: "\uD83C\uDF0E",
                title: "Location filters don't work",
                desc: "You want US-based or remote roles. Instead, you scroll through hundreds of listings in countries you can't work in.",
              },
              {
                icon: "\uD83D\uDCCA",
                title: "Level and salary are a mystery",
                desc: "Is this a senior role or an entry-level one? What's the comp range? Most listings don't tell you, and you waste time applying blind.",
              },
              {
                icon: "\uD83D\uDD04",
                title: "You're checking the same pages daily",
                desc: "You have 10 dream companies. Every morning you visit each careers page and scroll through listings, hoping something new appeared.",
              },
            ].map((p, i) => (
              <Reveal key={p.title} delay={i * 0.08}>
                <div
                  style={{
                    background: "rgba(255,255,255,0.7)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid rgba(255,255,255,0.6)",
                    borderRadius: 14,
                    padding: "24px 22px",
                    display: "flex",
                    gap: 14,
                    alignItems: "flex-start",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.02)",
                  }}
                >
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{p.icon}</span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0C1E3A", marginBottom: 4 }}>{p.title}</div>
                    <div style={{ fontSize: 14, color: "#6E6E80", lineHeight: 1.55, fontWeight: 430 }}>{p.desc}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" style={{ background: "linear-gradient(180deg, #F5F3F0 0%, #EEF1F5 50%, #F0F4F8 100%)", padding: "80px 0" }}>
        <div className="px-5 md:px-10" style={{ maxWidth: 1140, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#16874D", textTransform: "uppercase", letterSpacing: "0.1em" }}>How it works</span>
              <h2 className="text-[28px] sm:text-[34px] md:text-[38px]" style={{ fontWeight: 800, color: "#0C1E3A", lineHeight: 1.15, marginTop: 12, letterSpacing: "-0.015em" }}>
                Three steps. Zero manual searching.
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <StepCard
              number="1"
              icon={"\uD83C\uDFAF"}
              title="Pick your companies"
              desc="Choose from 20+ top tech companies like Google, Stripe, Netflix, OpenAI, and more. Or add any company with a careers page."
              delay={0}
            />
            <StepCard
              number="2"
              icon={"\uD83D\uDD0E"}
              title="We scan every morning"
              desc="Our scrapers check each company's careers page daily and filter for real product management roles. No noise, no duplicates."
              delay={0.1}
            />
            <StepCard
              number="3"
              icon={"\uD83D\uDCEC"}
              title="Get notified same-day"
              desc="New PM role posted? You'll know within 24 hours, delivered to your inbox with salary data from levels.fyi so you can act fast."
              delay={0.2}
            />
          </div>
        </div>
      </section>

      {/* PRODUCT SCREENS */}
      <section
        style={{
          background: "linear-gradient(165deg, #081226 0%, #0C1E3A 40%, #0F2847 70%, #081226 100%)",
          padding: "80px 0",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          className="absolute rounded-full pointer-events-none"
          style={{ top: -100, left: -100, width: 400, height: 400, background: "radial-gradient(circle, rgba(14,165,233,0.08), transparent 65%)" }}
        />
        <div
          className="absolute rounded-full pointer-events-none"
          style={{ bottom: -80, right: -80, width: 350, height: 350, background: "radial-gradient(circle, rgba(99,91,255,0.06), transparent 65%)" }}
        />

        <div className="px-5 md:px-10" style={{ maxWidth: 1140, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 48 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0EA5E9", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                See it in action
              </span>
              <h2 className="text-[26px] sm:text-[30px] md:text-[34px]" style={{ fontWeight: 800, color: "#fff", lineHeight: 1.15, marginTop: 12, letterSpacing: "-0.015em" }}>
                Everything you need, all in one place.
              </h2>
              <p style={{ fontSize: 16, color: "rgba(255,255,255,0.4)", marginTop: 10, fontWeight: 400 }}>
                Your dashboard. Every PM job. Full salary details.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-[1.3fr_0.9fr_0.9fr] gap-4 items-start">
            <Reveal delay={0}>
              <div>
                <DashboardMock />
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 500, textAlign: "center", marginTop: 10 }}>
                  Dashboard: your companies at a glance
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.15}>
              <div>
                <JobsListMock />
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 500, textAlign: "center", marginTop: 10 }}>
                  All Jobs: browse every PM role
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.3}>
              <div>
                <JobDetailMock />
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 500, textAlign: "center", marginTop: 10 }}>
                  Job Detail: salary data from levels.fyi
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* LATEST JOBS */}
      <section id="jobs" style={{ background: "linear-gradient(180deg, #F0F4F8 0%, #EDF0F5 50%, #F2EFE8 100%)", padding: "80px 0" }}>
        <div className="px-5 md:px-10" style={{ maxWidth: 1140, margin: "0 auto" }}>
          <Reveal>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#0EA5E9", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Fresh from today{"'"}s scan
                </span>
                <h2 className="text-[28px] sm:text-[34px]" style={{ fontWeight: 800, color: "#0C1E3A", lineHeight: 1.15, marginTop: 8, letterSpacing: "-0.015em" }}>
                  Latest PM roles
                </h2>
              </div>
              <Link
                href="/login"
                className="self-start sm:self-auto"
                style={{
                  background: "rgba(255,255,255,0.8)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(224,224,230,0.5)",
                  color: "#0C1E3A",
                  padding: "9px 20px",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                View All Jobs
              </Link>
            </div>
          </Reveal>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {SAMPLE_JOBS.map((j, i) => (
              <JobRow key={j.title} job={j} delay={i * 0.05} />
            ))}
          </div>

          <Reveal delay={0.4}>
            <div style={{ textAlign: "center", marginTop: 28, fontSize: 14, color: "#9494A8", fontWeight: 500 }}>
              Sign up to see all roles, set alerts, and save your favorites.
            </div>
          </Reveal>
        </div>
      </section>

      {/* LEVELS.FYI CALLOUT */}
      <section style={{ background: "linear-gradient(180deg, #F2EFE8 0%, #F5F2EB 50%, #EEF1F5 100%)", padding: "40px 0 80px" }}>
        <div className="px-5 md:px-10" style={{ maxWidth: 1140, margin: "0 auto" }}>
          <Reveal>
            <div
              className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-10 items-center p-6 sm:p-8 md:p-[40px_48px]"
              style={{
                background: "linear-gradient(145deg, rgba(255,251,240,0.8), rgba(255,248,232,0.6))",
                backdropFilter: "blur(16px)",
                border: "1px solid rgba(240,222,176,0.5)",
                borderRadius: 18,
                boxShadow: "0 2px 16px rgba(184,134,11,0.04)",
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#B8860B", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                  Salary Intelligence
                </div>
                <h3 className="text-[22px] sm:text-[26px] md:text-[28px]" style={{ fontWeight: 800, color: "#0C1E3A", lineHeight: 1.2, marginBottom: 12 }}>
                  Know the comp before you apply.
                </h3>
                <p style={{ fontSize: 15, color: "#6E6E80", lineHeight: 1.6, fontWeight: 430 }}>
                  Every job listing includes real salary data from levels.fyi. See base pay, stock, and total compensation so you never waste time
                  on roles outside your range.
                </p>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.85)",
                  borderRadius: 12,
                  padding: 24,
                  border: "1px solid rgba(240,222,176,0.4)",
                  boxShadow: "0 4px 16px rgba(184,134,11,0.05)",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#B8860B", marginBottom: 14 }}>Google Sr. Product Manager</div>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: "Median Total", value: "$284K" },
                    { label: "Base Salary", value: "$198K" },
                    { label: "Stock/yr", value: "$86K" },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="text-[20px] sm:text-[26px]" style={{ fontWeight: 800, color: "#0C1E3A" }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: "#9494A8", fontWeight: 500, marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: "1px solid rgba(240,222,176,0.4)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 11, color: "#9494A8" }}>Powered by</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>levels.fyi</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* STATS */}
      <section style={{ background: "linear-gradient(180deg, #EEF1F5 0%, #F0F4F8 100%)", padding: "0 0 80px" }}>
        <div className="px-5 md:px-10" style={{ maxWidth: 1140, margin: "0 auto" }}>
          <Reveal>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { val: "20+", label: "Companies tracked", color: "#0C1E3A" },
                { val: "250+", label: "PM roles monitored", color: "#0C1E3A" },
                { val: "6AM", label: "Daily scans complete", color: "#0C1E3A" },
                { val: "Free", label: "No credit card ever", color: "#0EA5E9" },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    background: "rgba(255,255,255,0.65)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid rgba(255,255,255,0.5)",
                    borderRadius: 14,
                    padding: "28px 20px",
                    textAlign: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.02)",
                  }}
                >
                  <div className="text-[24px] sm:text-[32px]" style={{ fontWeight: 900, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 13, color: "#6E6E80", fontWeight: 500, marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* FINAL CTA */}
      <section
        style={{
          background: "linear-gradient(165deg, #081226 0%, #0C1E3A 40%, #0F2847 70%, #0A1F3D 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          className="absolute rounded-full pointer-events-none"
          style={{ top: -60, right: -60, width: 300, height: 300, background: "radial-gradient(circle, rgba(14,165,233,0.1), transparent 65%)" }}
        />
        <div
          className="absolute rounded-full pointer-events-none"
          style={{ bottom: -40, left: -40, width: 200, height: 200, background: "radial-gradient(circle, rgba(99,91,255,0.06), transparent 65%)" }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.01) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.01) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        <div className="px-5 md:px-10 py-16 md:py-20 text-center relative" style={{ maxWidth: 1140, margin: "0 auto" }}>
          <Reveal>
            <h2 className="text-[28px] sm:text-[34px] md:text-[38px]" style={{ fontWeight: 800, color: "#fff", marginBottom: 14, letterSpacing: "-0.015em" }}>
              Your next PM role is one scan away.
            </h2>
            <p style={{ fontSize: 17, color: "rgba(255,255,255,0.4)", marginBottom: 32, fontWeight: 400 }}>
              Join free. Pick your companies. Get daily alerts.
            </p>
            <form onSubmit={onCtaSubmit} className="inline-flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-[10px]">
              <input
                type="email"
                placeholder="Your email address"
                className="w-full sm:w-[260px]"
                style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.1)",
                  fontSize: 15,
                  fontFamily: "inherit",
                  outline: "none",
                  color: "#fff",
                  background: "rgba(255,255,255,0.05)",
                }}
              />
              <button
                type="submit"
                style={{
                  background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
                  color: "#fff",
                  border: "none",
                  padding: "14px 28px",
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: "0 4px 20px rgba(14,165,233,0.3)",
                }}
              >
                Get Started Free
              </button>
            </form>
          </Reveal>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="px-5 md:px-10 py-7" style={{ background: "#060E1D", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3" style={{ maxWidth: 1140, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 5,
                background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: 800,
                fontSize: 9,
                letterSpacing: "1px",
              }}
            >
              PM
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>NewPMJobs</span>
          </div>
          <div className="text-center sm:text-right" style={{ fontSize: 13, color: "rgba(255,255,255,0.25)" }}>
            Built by{" "}
            <a
              href="https://www.linkedin.com/in/vik-agarwal/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#0EA5E9", textDecoration: "none", fontWeight: 600 }}
            >
              Vik Agarwal
            </a>
            {" "}| Made by a PM, for PMs
          </div>
        </div>
      </footer>
    </>
  );
}
