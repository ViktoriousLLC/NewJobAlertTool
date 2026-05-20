"use client";

import { COMPANIES, COMPANY_COLORS } from "./LandingPage";

interface HeroCardCompany {
  name: string;
  color: string;
  letter: string;
  roles: number;
  newCount: number;
}

export default function LandingHero({
  onCtaSubmit,
  ctaLabel = "Get Started Free",
}: {
  onCtaSubmit: (e: React.FormEvent) => void;
  ctaLabel?: string;
}) {
  return (
    <section
      style={{
        background:
          "linear-gradient(165deg, #081226 0%, #0C1E3A 30%, #0F2847 55%, #0A1F3D 75%, #081226 100%)",
        position: "relative",
        overflow: "hidden",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Decorative orbs */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{ top: -150, right: -120, width: 600, height: 600, background: "radial-gradient(circle, rgba(14,165,233,0.12), transparent 65%)" }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{ bottom: -100, left: -100, width: 500, height: 500, background: "radial-gradient(circle, rgba(99,91,255,0.08), transparent 65%)" }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{ top: "40%", left: "30%", width: 300, height: 300, background: "radial-gradient(circle, rgba(16,163,127,0.06), transparent 65%)" }}
      />
      {/* Grid texture */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div
        className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_1.1fr] gap-10 md:gap-10 items-center relative px-5 md:px-10 pt-24 md:pt-[110px] pb-10 md:pb-10"
        style={{ maxWidth: 1140, margin: "0 auto", width: "100%" }}
      >
        {/* Left: copy */}
        <div>
          <div style={{ animation: "slideIn 0.6s ease 0.1s both" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(14,165,233,0.1)",
                border: "1px solid rgba(14,165,233,0.18)",
                padding: "5px 14px",
                borderRadius: 20,
                marginBottom: 24,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#0EA5E9",
                  display: "inline-block",
                  animation: "pulse 2s ease infinite",
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#0EA5E9" }}>Made by a PM, for PMs</span>
            </div>
          </div>

          <h1
            className="text-[32px] sm:text-[40px] md:text-[48px]"
            style={{
              fontWeight: 900,
              color: "#fff",
              lineHeight: 1.1,
              marginBottom: 22,
              letterSpacing: "-0.025em",
              animation: "slideIn 0.6s ease 0.2s both",
            }}
          >
            New PM role at your
            <br />
            dream company?
            <br />
            <span
              style={{
                background: "linear-gradient(135deg, #0EA5E9, #38BDF8, #7DD3FC)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {"You'll know first."}
            </span>
          </h1>

          <p
            className="text-[15px] sm:text-[17px] md:text-[18px]"
            style={{
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.65,
              marginBottom: 34,
              maxWidth: 440,
              fontWeight: 400,
              animation: "slideIn 0.6s ease 0.3s both",
            }}
          >
            We scan career pages at top tech companies every day and notify you the moment a product management role is
            posted. Pick your companies, and let the jobs come to you.
          </p>

          <form
            onSubmit={onCtaSubmit}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-[10px]"
            style={{ animation: "slideIn 0.6s ease 0.4s both" }}
          >
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
                whiteSpace: "nowrap",
                boxShadow: "0 4px 20px rgba(14,165,233,0.3)",
              }}
            >
              {ctaLabel}
            </button>
          </form>
          <p
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.25)",
              marginTop: 12,
              fontWeight: 400,
              animation: "slideIn 0.6s ease 0.5s both",
            }}
          >
            Free forever. No spam. No credit card.
          </p>
        </div>

        {/* Right: floating cards + toasts — DESKTOP (hidden on mobile) */}
        <div className="hidden md:block" style={{ position: "relative", height: 480, animation: "slideIn 0.8s ease 0.3s both" }}>
          <div style={{ position: "absolute", top: 0, left: 5, animation: "heroFloat 3s ease-in-out infinite alternate", animationDelay: "0s" }}>
            <HeroCard co={{ ...COMPANIES[0], roles: 44, newCount: 2 }} delay={0} style={{}} noFloat />
            <ToastNotification company="Google" role="Sr. Product Manager, Cloud AI" slideDelay={1} marginTop={-18} marginLeft={50} zIndex={12} />
          </div>
          <HeroCard co={{ ...COMPANIES[2], roles: 33, newCount: 1 }} delay={0.4} style={{ position: "absolute", top: 0, right: 45 }} />
          <div style={{ position: "absolute", top: 170, left: 0, animation: "heroFloat 3.4s ease-in-out infinite alternate", animationDelay: "0.8s" }}>
            <HeroCard co={{ ...COMPANIES[1], roles: 35, newCount: 0 }} delay={0.8} style={{}} noFloat />
            <ToastNotification company="Netflix" role="Dir. of Product, Content Platform" slideDelay={1.6} marginTop={-18} marginLeft={10} zIndex={11} />
          </div>
          <div style={{ position: "absolute", top: 185, right: 10, animation: "heroFloat 3.6s ease-in-out infinite alternate", animationDelay: "1.2s" }}>
            <HeroCard co={{ ...COMPANIES[5], roles: 8, newCount: 0 }} delay={1.2} style={{}} noFloat />
            <ToastNotification company="OpenAI" role="Product Manager, API Platform" slideDelay={2.2} marginTop={-18} marginLeft={-15} zIndex={10} />
          </div>
          <HeroCard co={{ ...COMPANIES[3], roles: 45, newCount: 1 }} delay={0.6} style={{ position: "absolute", top: 355, left: 10 }} />
          <HeroCard co={{ ...COMPANIES[7], roles: 12, newCount: 0 }} delay={1.0} style={{ position: "absolute", top: 370, left: 175 }} />
          <HeroCard co={{ ...COMPANIES[8], roles: 5, newCount: 0 }} delay={1.4} style={{ position: "absolute", top: 360, right: 5 }} />
        </div>

        {/* MOBILE hero graphic — compact grid of cards */}
        <div className="md:hidden relative mt-4" style={{ animation: "slideIn 0.8s ease 0.3s both" }}>
          <div className="grid grid-cols-3 gap-2 max-w-[340px] mx-auto">
            {[
              { ...COMPANIES[0], roles: 44, newCount: 2 },
              { ...COMPANIES[2], roles: 33, newCount: 1 },
              { ...COMPANIES[1], roles: 35, newCount: 0 },
              { ...COMPANIES[5], roles: 8, newCount: 0 },
              { ...COMPANIES[3], roles: 45, newCount: 1 },
              { ...COMPANIES[7], roles: 12, newCount: 0 },
            ].map((co, i) => {
              const colors = COMPANY_COLORS[co.color];
              return (
                <div
                  key={co.name}
                  style={{
                    background: colors.bg96,
                    borderRadius: 10,
                    overflow: "hidden",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    animation: `slideIn 0.5s ease ${0.4 + i * 0.08}s both`,
                  }}
                >
                  <div
                    style={{
                      background: `linear-gradient(135deg, ${colors.grad55}, ${colors.grad30})`,
                      padding: "4px 7px",
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
                        fontSize: 7,
                        fontWeight: 700,
                      }}
                    >
                      {co.letter}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#1A1A2E" }}>{co.name}</span>
                  </div>
                  <div style={{ padding: "8px 6px", textAlign: "center" }}>
                    {co.newCount > 0 && (
                      <span
                        style={{
                          background: "#E8F5EE",
                          color: "#16874D",
                          fontSize: 7,
                          fontWeight: 700,
                          padding: "1px 5px",
                          borderRadius: 3,
                          display: "inline-block",
                          marginBottom: 3,
                        }}
                      >
                        +{co.newCount} new
                      </span>
                    )}
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 2 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#1A1A2E" }}>{co.roles}</span>
                      <span style={{ fontSize: 8, fontWeight: 500, color: "#6E6E80" }}>roles</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Company strip */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", padding: "18px 0" }}>
        <div className="px-5 md:px-10 flex items-center gap-4" style={{ maxWidth: 1140, margin: "0 auto" }}>
          <span
            className="hidden sm:inline"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.2)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            Tracking daily
          </span>
          <div className="flex gap-1.5 flex-wrap overflow-hidden max-h-[28px] sm:max-h-none">
            {COMPANIES.map((c) => (
              <div
                key={c.name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 5,
                  padding: "3px 9px 3px 5px",
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: c.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 7,
                    fontWeight: 700,
                  }}
                >
                  {c.letter}
                </div>
                <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>{c.name}</span>
              </div>
            ))}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: "rgba(14,165,233,0.08)",
                border: "1px solid rgba(14,165,233,0.12)",
                borderRadius: 5,
                padding: "3px 9px",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 600, color: "#0EA5E9" }}>+ more</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
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
