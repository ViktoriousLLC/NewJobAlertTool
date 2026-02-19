import { useState, useEffect, useRef } from "react";

/* ─── helpers ─── */
function useInView(opts = {}) {
  const ref = useRef(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setV(true); o.disconnect(); } }, { threshold: 0.1, ...opts });
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return [ref, v];
}

function Reveal({ children, delay = 0, y = 30, style = {} }) {
  const [ref, v] = useInView();
  return (
    <div ref={ref} style={{
      opacity: v ? 1 : 0,
      transform: v ? "translateY(0)" : `translateY(${y}px)`,
      transition: `opacity 0.7s cubic-bezier(.22,.68,0,.71) ${delay}s, transform 0.7s cubic-bezier(.22,.68,0,.71) ${delay}s`,
      ...style,
    }}>{children}</div>
  );
}

function mix(hex, pct) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const f = pct / 100;
  return `rgb(${Math.round(r + (255 - r) * f)},${Math.round(g + (255 - g) * f)},${Math.round(b + (255 - b) * f)})`;
}

/* ─── data ─── */
const COMPANIES = [
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

const SAMPLE_JOBS = [
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

/* ─── components ─── */

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      background: scrolled ? "rgba(8, 18, 38, 0.92)" : "transparent",
      backdropFilter: scrolled ? "blur(20px)" : "none",
      borderBottom: scrolled ? "1px solid rgba(255,255,255,0.06)" : "none",
      transition: "all 0.3s ease",
    }}>
      <div style={{
        maxWidth: 1140, margin: "0 auto", padding: "0 40px",
        height: 64, display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 12, letterSpacing: "1.5px",
          }}>PM</div>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>NewPMJobs</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <a href="#how-it-works" style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 500, textDecoration: "none" }}>How it Works</a>
          <a href="#jobs" style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 500, textDecoration: "none" }}>Latest Jobs</a>
          <button style={{
            background: "linear-gradient(135deg, #0EA5E9, #0284C7)", color: "#fff", border: "none",
            padding: "9px 22px", borderRadius: 8, fontSize: 14,
            fontWeight: 600, cursor: "pointer", fontFamily: "'Outfit', sans-serif",
          }}>Sign In</button>
        </div>
      </div>
    </nav>
  );
}

function HeroCard({ co, delay, style: s, noFloat }) {
  return (
    <div style={{
      background: mix(co.color, 96),
      borderRadius: 12, overflow: "hidden",
      width: 155, flexShrink: 0,
      boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
      ...(noFloat ? {} : {
        animation: `heroFloat ${3 + delay * 0.5}s ease-in-out infinite alternate`,
        animationDelay: `${delay}s`,
      }),
      border: "1px solid rgba(255,255,255,0.08)",
      ...s,
    }}>
      <div style={{
        background: `linear-gradient(135deg, ${mix(co.color, 55)}, ${mix(co.color, 30)})`,
        padding: "6px 9px", display: "flex", alignItems: "center", gap: 5,
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: 4, background: co.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: 9, fontWeight: 700,
        }}>{co.letter}</div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1A2E" }}>{co.name}</span>
      </div>
      <div style={{ padding: "12px 8px", textAlign: "center" }}>
        {co.newCount > 0 && (
          <span style={{
            background: "#E8F5EE", color: "#16874D",
            fontSize: 8, fontWeight: 700,
            padding: "2px 7px", borderRadius: 4,
            display: "inline-block", marginBottom: 5,
          }}>+{co.newCount} new</span>
        )}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#1A1A2E" }}>{co.roles}</span>
          <span style={{ fontSize: 10, fontWeight: 500, color: "#6E6E80" }}>roles</span>
        </div>
      </div>
    </div>
  );
}

function JobRow({ job, delay }) {
  const [hov, setHov] = useState(false);
  return (
    <Reveal delay={delay}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          background: hov ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.6)",
          backdropFilter: "blur(12px)",
          border: hov ? "1px solid #0EA5E9" : "1px solid rgba(224,224,230,0.5)",
          borderRadius: 12, padding: "16px 20px",
          display: "flex", alignItems: "center", gap: 14,
          cursor: "pointer",
          transition: "all 0.2s ease",
          transform: hov ? "translateY(-2px)" : "none",
          boxShadow: hov ? "0 8px 24px rgba(14,165,233,0.1)" : "0 1px 4px rgba(0,0,0,0.02)",
        }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: job.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: 16, fontWeight: 700, flexShrink: 0,
        }}>{job.company[0]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 650, color: "#0C1E3A", marginBottom: 3 }}>{job.title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#6E6E80", fontWeight: 500 }}>{job.company}</span>
            <span style={{ fontSize: 11, color: "#C0C0CC" }}>|</span>
            <span style={{ fontSize: 13, color: "#6E6E80", fontWeight: 500 }}>{job.location}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: "#16874D",
            background: "#E8F5EE", padding: "3px 10px", borderRadius: 6,
            marginBottom: 4, display: "inline-block",
          }}>{job.salary}</div>
          <div style={{ fontSize: 12, color: "#9494A8", fontWeight: 500 }}>{job.posted}</div>
        </div>
      </div>
    </Reveal>
  );
}

function StepCard({ number, title, desc, icon, delay }) {
  return (
    <Reveal delay={delay}>
      <div style={{
        background: "rgba(255,255,255,0.6)",
        backdropFilter: "blur(16px)",
        borderRadius: 16,
        padding: "32px 28px",
        border: "1px solid rgba(255,255,255,0.5)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.03)",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: -10, right: -6,
          fontSize: 80, fontWeight: 900, color: "rgba(14,165,233,0.06)",
          lineHeight: 1,
        }}>{number}</div>
        <div style={{ fontSize: 28, marginBottom: 14 }}>{icon}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0C1E3A", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 15, color: "#6E6E80", lineHeight: 1.6, fontWeight: 430 }}>{desc}</div>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
        {cards.map(co => (
          <div key={co.name} style={{ borderRadius: 7, overflow: "hidden", background: mix(co.color, 96), border: "1px solid #E0E0E6" }}>
            <div style={{
              background: `linear-gradient(135deg, ${mix(co.color, 60)}, ${mix(co.color, 35)})`,
              padding: "5px 7px", display: "flex", alignItems: "center", gap: 4,
            }}>
              <div style={{ width: 16, height: 16, borderRadius: 3, background: co.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 8, fontWeight: 700 }}>{co.name[0]}</div>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#1A1A2E" }}>{co.name}</span>
            </div>
            <div style={{ padding: "10px 6px", textAlign: "center" }}>
              {co.newCount > 0 && <div style={{ background: "#E8F5EE", color: "#16874D", fontSize: 7, fontWeight: 700, padding: "1px 5px", borderRadius: 3, display: "inline-block", marginBottom: 4 }}>+{co.newCount} new</div>}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 2 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#1A1A2E" }}>{co.roles}</span>
                <span style={{ fontSize: 8, color: "#6E6E80" }}>roles</span>
              </div>
            </div>
          </div>
        ))}
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
        {jobs.map(j => (
          <div key={j.title} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fff", borderRadius: 7, border: "1px solid #E0E0E6" }}>
            <div style={{ width: 24, height: 24, borderRadius: 5, background: j.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{j.company[0]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 650, color: "#0C1E3A" }}>{j.title}</div>
              <div style={{ fontSize: 8, color: "#6E6E80" }}>{j.company} | {j.loc}</div>
            </div>
            <span style={{ fontSize: 8, fontWeight: 700, color: "#16874D", background: "#E8F5EE", padding: "2px 6px", borderRadius: 3 }}>{j.sal}</span>
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
        <div style={{ width: 32, height: 32, borderRadius: 7, background: "#4285F4", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700 }}>G</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0C1E3A" }}>Sr. Product Manager, Cloud AI</div>
          <div style={{ fontSize: 9, color: "#6E6E80" }}>Google | Mountain View, CA</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {["Senior", "$198K-$284K", "Full-time", "Hybrid"].map(t => (
          <span key={t} style={{ fontSize: 8, fontWeight: 600, color: "#0C1E3A", background: "#F0F0F4", padding: "2px 7px", borderRadius: 4 }}>{t}</span>
        ))}
      </div>
      <div style={{ padding: "8px 10px", background: "linear-gradient(135deg, #FFFBF0, #FFF5E0)", border: "1px solid #F0DEB0", borderRadius: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 8, fontWeight: 700, color: "#B8860B", marginBottom: 2 }}>Salary Data from levels.fyi</div>
        <div style={{ display: "flex", gap: 12 }}>
          <div><div style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>$245K</div><div style={{ fontSize: 7, color: "#6E6E80" }}>Median Total</div></div>
          <div><div style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>$198K</div><div style={{ fontSize: 7, color: "#6E6E80" }}>Base</div></div>
          <div><div style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>$47K</div><div style={{ fontSize: 7, color: "#6E6E80" }}>Stock/yr</div></div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={{ flex: 1, background: "linear-gradient(135deg, #0EA5E9, #0284C7)", color: "#fff", border: "none", padding: "6px 0", borderRadius: 5, fontSize: 9, fontWeight: 700, fontFamily: "'Outfit', sans-serif" }}>Apply on Google</button>
        <button style={{ background: "#fff", border: "1px solid #E0E0E6", color: "#0C1E3A", padding: "6px 12px", borderRadius: 5, fontSize: 9, fontWeight: 600, fontFamily: "'Outfit', sans-serif" }}>Save</button>
      </div>
    </div>
  );
}

/* ─── main ─── */
export default function Landing() {
  const [email, setEmail] = useState("");

  return (
    <div style={{ fontFamily: "'Outfit', sans-serif", overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;450;500;600;650;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::selection { background: #0EA5E9; color: #fff; }
        html { scroll-behavior: smooth; }
        @keyframes heroFloat { 0% { transform: translateY(0); } 100% { transform: translateY(-10px); } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
        a:hover { opacity: 0.85; }
        input::placeholder { color: rgba(255,255,255,0.3); }
      `}</style>

      <Nav />

      {/* ═══ HERO ═══ */}
      <section style={{
        background: "linear-gradient(165deg, #081226 0%, #0C1E3A 30%, #0F2847 55%, #0A1F3D 75%, #081226 100%)",
        position: "relative",
        overflow: "hidden",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* mesh orbs */}
        <div style={{ position: "absolute", top: -150, right: -120, width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(14,165,233,0.12), transparent 65%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -100, left: -100, width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,91,255,0.08), transparent 65%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "40%", left: "30%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,163,127,0.06), transparent 65%)", pointerEvents: "none" }} />
        {/* subtle grid texture */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          pointerEvents: "none",
        }} />

        <div style={{
          flex: 1, maxWidth: 1140, margin: "0 auto", padding: "110px 40px 40px",
          display: "grid", gridTemplateColumns: "1fr 1.1fr",
          gap: 40, alignItems: "center", position: "relative",
        }}>
          {/* Left: copy */}
          <div>
            <div style={{ animation: "slideIn 0.6s ease 0.1s both" }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "rgba(14,165,233,0.1)", border: "1px solid rgba(14,165,233,0.18)",
                padding: "5px 14px", borderRadius: 20, marginBottom: 24,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0EA5E9", display: "inline-block", animation: "pulse 2s ease infinite" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#0EA5E9" }}>Made by a PM, for PMs</span>
              </div>
            </div>

            <h1 style={{
              fontSize: 48, fontWeight: 900, color: "#fff",
              lineHeight: 1.1, marginBottom: 22, letterSpacing: "-0.025em",
              animation: "slideIn 0.6s ease 0.2s both",
            }}>
              New PM role at your
              <br />dream company?
              <br /><span style={{
                background: "linear-gradient(135deg, #0EA5E9, #38BDF8, #7DD3FC)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}>You'll know first.</span>
            </h1>

            <p style={{
              fontSize: 18, color: "rgba(255,255,255,0.5)", lineHeight: 1.65,
              marginBottom: 34, maxWidth: 440, fontWeight: 400,
              animation: "slideIn 0.6s ease 0.3s both",
            }}>
              We scan career pages at top tech companies every day and notify you the moment a product management role is posted. Pick your companies, and let the jobs come to you.
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 10, animation: "slideIn 0.6s ease 0.4s both" }}>
              <input
                type="email" placeholder="Your email address"
                value={email} onChange={e => setEmail(e.target.value)}
                style={{
                  width: 260, padding: "14px 16px", borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.1)", fontSize: 15,
                  fontFamily: "'Outfit', sans-serif", outline: "none",
                  color: "#fff", background: "rgba(255,255,255,0.05)",
                }}
              />
              <button style={{
                background: "linear-gradient(135deg, #0EA5E9, #0284C7)", color: "#fff", border: "none",
                padding: "14px 28px", borderRadius: 10, fontSize: 15,
                fontWeight: 700, cursor: "pointer", fontFamily: "'Outfit', sans-serif",
                whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(14,165,233,0.3)",
              }}>Get Started Free</button>
            </div>
            <p style={{
              fontSize: 13, color: "rgba(255,255,255,0.25)", marginTop: 12, fontWeight: 400,
              animation: "slideIn 0.6s ease 0.5s both",
            }}>Free forever. No spam. No credit card.</p>
          </div>

          {/* Right: floating cards - Option B diagonal cascade */}
          <div style={{ position: "relative", height: 480, animation: "slideIn 0.8s ease 0.3s both" }}>
            {/* Google + toast group */}
            <div style={{
              position: "absolute", top: 0, left: 5,
              animation: `heroFloat 3s ease-in-out infinite alternate`,
              animationDelay: "0s",
            }}>
              <HeroCard co={{ ...COMPANIES[0], roles: 44, newCount: 2 }} delay={0} style={{}} noFloat />
              <div style={{
                marginTop: -18, marginLeft: 50,
                background: "rgba(255,255,255,0.97)", borderRadius: 12, padding: "10px 14px",
                boxShadow: "0 12px 48px rgba(0,0,0,0.25)",
                display: "flex", alignItems: "center", gap: 10,
                zIndex: 12, animation: "slideIn 0.5s ease 1s both",
                border: "1px solid rgba(14,165,233,0.15)",
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontWeight: 800, fontSize: 10,
                }}>PM</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>New PM role at Google</div>
                  <div style={{ fontSize: 10, color: "#6E6E80" }}>Sr. Product Manager, Cloud AI</div>
                </div>
              </div>
            </div>

            {/* Stripe (no toast) */}
            <HeroCard co={{ ...COMPANIES[2], roles: 33, newCount: 1 }} delay={0.4} style={{ position: "absolute", top: 0, right: 45 }} />

            {/* Netflix + toast group */}
            <div style={{
              position: "absolute", top: 170, left: 0,
              animation: `heroFloat 3.4s ease-in-out infinite alternate`,
              animationDelay: "0.8s",
            }}>
              <HeroCard co={{ ...COMPANIES[1], roles: 35, newCount: 0 }} delay={0.8} style={{}} noFloat />
              <div style={{
                marginTop: -18, marginLeft: 10,
                background: "rgba(255,255,255,0.97)", borderRadius: 12, padding: "10px 14px",
                boxShadow: "0 12px 48px rgba(0,0,0,0.2)",
                display: "flex", alignItems: "center", gap: 10,
                zIndex: 11, animation: "slideIn 0.5s ease 1.6s both",
                border: "1px solid rgba(14,165,233,0.15)",
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontWeight: 800, fontSize: 10,
                }}>PM</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>New PM role at Netflix</div>
                  <div style={{ fontSize: 10, color: "#6E6E80" }}>Dir. of Product, Content Platform</div>
                </div>
              </div>
            </div>

            {/* OpenAI + toast group */}
            <div style={{
              position: "absolute", top: 185, right: 10,
              animation: `heroFloat 3.6s ease-in-out infinite alternate`,
              animationDelay: "1.2s",
            }}>
              <HeroCard co={{ ...COMPANIES[5], roles: 8, newCount: 0 }} delay={1.2} style={{}} noFloat />
              <div style={{
                marginTop: -18, marginLeft: -15,
                background: "rgba(255,255,255,0.97)", borderRadius: 12, padding: "10px 14px",
                boxShadow: "0 12px 48px rgba(0,0,0,0.15)",
                display: "flex", alignItems: "center", gap: 10,
                zIndex: 10, animation: "slideIn 0.5s ease 2.2s both",
                border: "1px solid rgba(14,165,233,0.15)",
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontWeight: 800, fontSize: 10,
                }}>PM</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>New PM role at OpenAI</div>
                  <div style={{ fontSize: 10, color: "#6E6E80" }}>Product Manager, API Platform</div>
                </div>
              </div>
            </div>

            {/* Uber (no toast) */}
            <HeroCard co={{ ...COMPANIES[3], roles: 45, newCount: 1 }} delay={0.6} style={{ position: "absolute", top: 355, left: 10 }} />

            {/* Discord (no toast, fills gap between Uber and Figma) */}
            <HeroCard co={{ ...COMPANIES[7], roles: 12, newCount: 0 }} delay={1.0} style={{ position: "absolute", top: 370, left: 175 }} />

            {/* Figma (no toast) */}
            <HeroCard co={{ ...COMPANIES[8], roles: 5, newCount: 0 }} delay={1.4} style={{ position: "absolute", top: 360, right: 5 }} />
          </div>
        </div>

        {/* Company strip */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", padding: "18px 0" }}>
          <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 40px", display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap", flexShrink: 0 }}>Tracking daily</span>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {COMPANIES.map(c => (
                <div key={c.name} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 5, padding: "3px 9px 3px 5px",
                }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, background: c.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 7, fontWeight: 700 }}>{c.letter}</div>
                  <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>{c.name}</span>
                </div>
              ))}
              <div style={{ display: "inline-flex", alignItems: "center", background: "rgba(14,165,233,0.08)", border: "1px solid rgba(14,165,233,0.12)", borderRadius: 5, padding: "3px 9px" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#0EA5E9" }}>+ more</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ PROBLEM ═══ */}
      <section style={{
        background: "linear-gradient(180deg, #F0F4F8 0%, #E8EDF4 40%, #F5F3F0 100%)",
        padding: "100px 0 60px",
      }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 40px" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#A14B38", textTransform: "uppercase", letterSpacing: "0.1em" }}>The problem with PM job hunting</span>
              <h2 style={{ fontSize: 38, fontWeight: 800, color: "#0C1E3A", lineHeight: 1.15, marginTop: 12, letterSpacing: "-0.015em" }}>
                Job boards weren't built for product managers.
              </h2>
            </div>
          </Reveal>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 900, margin: "0 auto" }}>
            {[
              { icon: "🔍", title: "PM roles are buried in noise", desc: 'Search "product manager" and you get production managers, project managers, and product engineers. Finding real PM roles takes forever.' },
              { icon: "🌎", title: "Location filters don't work", desc: "You want US-based or remote roles. Instead, you scroll through hundreds of listings in countries you can't work in." },
              { icon: "📊", title: "Level and salary are a mystery", desc: "Is this a senior role or an entry-level one? What's the comp range? Most listings don't tell you, and you waste time applying blind." },
              { icon: "🔄", title: "You're checking the same pages daily", desc: "You have 10 dream companies. Every morning you visit each careers page and scroll through listings, hoping something new appeared." },
            ].map((p, i) => (
              <Reveal key={p.title} delay={i * 0.08}>
                <div style={{
                  background: "rgba(255,255,255,0.7)", backdropFilter: "blur(12px)",
                  border: "1px solid rgba(255,255,255,0.6)", borderRadius: 14,
                  padding: "24px 22px", display: "flex", gap: 14, alignItems: "flex-start",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.02)",
                }}>
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

      {/* ═══ HOW IT WORKS ═══ */}
      <section id="how-it-works" style={{
        background: "linear-gradient(180deg, #F5F3F0 0%, #EEF1F5 50%, #F0F4F8 100%)",
        padding: "80px 0",
      }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 40px" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 56 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#16874D", textTransform: "uppercase", letterSpacing: "0.1em" }}>How it works</span>
              <h2 style={{ fontSize: 38, fontWeight: 800, color: "#0C1E3A", lineHeight: 1.15, marginTop: 12, letterSpacing: "-0.015em" }}>Three steps. Zero manual searching.</h2>
            </div>
          </Reveal>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
            <StepCard number="1" icon="🎯" title="Pick your companies" desc="Choose from 20+ top tech companies like Google, Stripe, Netflix, OpenAI, and more. Or add any company with a careers page." delay={0} />
            <StepCard number="2" icon="🔎" title="We scan every morning" desc="Our scrapers check each company's careers page daily and filter for real product management roles. No noise, no duplicates." delay={0.1} />
            <StepCard number="3" icon="📬" title="Get notified same-day" desc="New PM role posted? You'll know within 24 hours, delivered to your inbox with salary data from levels.fyi so you can act fast." delay={0.2} />
          </div>
        </div>
      </section>

      {/* ═══ PRODUCT SCREENS ═══ */}
      <section style={{
        background: "linear-gradient(165deg, #081226 0%, #0C1E3A 40%, #0F2847 70%, #081226 100%)",
        padding: "80px 0",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -100, left: -100, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(14,165,233,0.08), transparent 65%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -80, right: -80, width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,91,255,0.06), transparent 65%)", pointerEvents: "none" }} />

        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 40px" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 48 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0EA5E9", textTransform: "uppercase", letterSpacing: "0.1em" }}>See it in action</span>
              <h2 style={{ fontSize: 34, fontWeight: 800, color: "#fff", lineHeight: 1.15, marginTop: 12, letterSpacing: "-0.015em" }}>Everything you need, all in one place.</h2>
              <p style={{ fontSize: 16, color: "rgba(255,255,255,0.4)", marginTop: 10, fontWeight: 400 }}>Your dashboard. Every PM job. Full salary details.</p>
            </div>
          </Reveal>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.9fr 0.9fr", gap: 16, alignItems: "start" }}>
            <Reveal delay={0}><div><DashboardMock /><div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 500, textAlign: "center", marginTop: 10 }}>Dashboard: your companies at a glance</div></div></Reveal>
            <Reveal delay={0.15}><div><JobsListMock /><div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 500, textAlign: "center", marginTop: 10 }}>All Jobs: browse every PM role</div></div></Reveal>
            <Reveal delay={0.3}><div><JobDetailMock /><div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 500, textAlign: "center", marginTop: 10 }}>Job Detail: salary data from levels.fyi</div></div></Reveal>
          </div>
        </div>
      </section>

      {/* ═══ LATEST JOBS ═══ */}
      <section id="jobs" style={{
        background: "linear-gradient(180deg, #F0F4F8 0%, #EDF0F5 50%, #F2EFE8 100%)",
        padding: "80px 0",
      }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 40px" }}>
          <Reveal>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 32 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#0EA5E9", textTransform: "uppercase", letterSpacing: "0.1em" }}>Fresh from today's scan</span>
                <h2 style={{ fontSize: 34, fontWeight: 800, color: "#0C1E3A", lineHeight: 1.15, marginTop: 8, letterSpacing: "-0.015em" }}>Latest PM roles</h2>
              </div>
              <button style={{ background: "rgba(255,255,255,0.8)", backdropFilter: "blur(8px)", border: "1px solid rgba(224,224,230,0.5)", color: "#0C1E3A", padding: "9px 20px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Outfit', sans-serif" }}>View All Jobs</button>
            </div>
          </Reveal>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {SAMPLE_JOBS.map((j, i) => <JobRow key={j.title} job={j} delay={i * 0.05} />)}
          </div>

          <Reveal delay={0.4}>
            <div style={{ textAlign: "center", marginTop: 28, fontSize: 14, color: "#9494A8", fontWeight: 500 }}>
              Sign up to see all roles, set alerts, and save your favorites.
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ LEVELS.FYI CALLOUT ═══ */}
      <section style={{
        background: "linear-gradient(180deg, #F2EFE8 0%, #F5F2EB 50%, #EEF1F5 100%)",
        padding: "40px 0 80px",
      }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 40px" }}>
          <Reveal>
            <div style={{
              background: "linear-gradient(145deg, rgba(255,251,240,0.8), rgba(255,248,232,0.6))",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(240,222,176,0.5)",
              borderRadius: 18, padding: "40px 48px",
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "center",
              boxShadow: "0 2px 16px rgba(184,134,11,0.04)",
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#B8860B", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Salary Intelligence</div>
                <h3 style={{ fontSize: 28, fontWeight: 800, color: "#0C1E3A", lineHeight: 1.2, marginBottom: 12 }}>Know the comp before you apply.</h3>
                <p style={{ fontSize: 15, color: "#6E6E80", lineHeight: 1.6, fontWeight: 430 }}>
                  Every job listing includes real salary data from levels.fyi. See base pay, stock, and total compensation so you never waste time on roles outside your range.
                </p>
              </div>
              <div style={{
                background: "rgba(255,255,255,0.85)", borderRadius: 12, padding: 24,
                border: "1px solid rgba(240,222,176,0.4)",
                boxShadow: "0 4px 16px rgba(184,134,11,0.05)",
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#B8860B", marginBottom: 14 }}>Google Sr. Product Manager</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                  {[
                    { label: "Median Total", value: "$284K" },
                    { label: "Base Salary", value: "$198K" },
                    { label: "Stock/yr", value: "$86K" },
                  ].map(s => (
                    <div key={s.label}>
                      <div style={{ fontSize: 26, fontWeight: 800, color: "#0C1E3A" }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: "#9494A8", fontWeight: 500, marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(240,222,176,0.4)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#9494A8" }}>Powered by</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0C1E3A" }}>levels.fyi</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ STATS ═══ */}
      <section style={{
        background: "linear-gradient(180deg, #EEF1F5 0%, #F0F4F8 100%)",
        padding: "0 0 80px",
      }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 40px" }}>
          <Reveal>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
              {[
                { val: "20+", label: "Companies tracked", color: "#0C1E3A" },
                { val: "250+", label: "PM roles monitored", color: "#0C1E3A" },
                { val: "6AM", label: "Daily scans complete", color: "#0C1E3A" },
                { val: "Free", label: "No credit card ever", color: "#0EA5E9" },
              ].map(s => (
                <div key={s.label} style={{
                  background: "rgba(255,255,255,0.65)", backdropFilter: "blur(12px)",
                  border: "1px solid rgba(255,255,255,0.5)",
                  borderRadius: 14, padding: "28px 20px", textAlign: "center",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.02)",
                }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 13, color: "#6E6E80", fontWeight: 500, marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section style={{
        background: "linear-gradient(165deg, #081226 0%, #0C1E3A 40%, #0F2847 70%, #0A1F3D 100%)",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -60, right: -60, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(14,165,233,0.1), transparent 65%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -40, left: -40, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,91,255,0.06), transparent 65%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.01) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.01) 1px, transparent 1px)", backgroundSize: "60px 60px", pointerEvents: "none" }} />

        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "80px 40px", textAlign: "center", position: "relative" }}>
          <Reveal>
            <h2 style={{ fontSize: 38, fontWeight: 800, color: "#fff", marginBottom: 14, letterSpacing: "-0.015em" }}>
              Your next PM role is one scan away.
            </h2>
            <p style={{ fontSize: 17, color: "rgba(255,255,255,0.4)", marginBottom: 32, fontWeight: 400 }}>
              Join free. Pick your companies. Get daily alerts.
            </p>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <input type="email" placeholder="Your email address" style={{
                width: 260, padding: "14px 16px", borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.1)", fontSize: 15,
                fontFamily: "'Outfit', sans-serif", outline: "none",
                color: "#fff", background: "rgba(255,255,255,0.05)",
              }} />
              <button style={{
                background: "linear-gradient(135deg, #0EA5E9, #0284C7)", color: "#fff", border: "none",
                padding: "14px 28px", borderRadius: 10, fontSize: 15,
                fontWeight: 700, cursor: "pointer", fontFamily: "'Outfit', sans-serif",
                boxShadow: "0 4px 20px rgba(14,165,233,0.3)",
              }}>Get Started Free</button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer style={{
        background: "#060E1D", borderTop: "1px solid rgba(255,255,255,0.03)", padding: "28px 40px",
      }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 5, background: "linear-gradient(135deg, #0EA5E9, #0284C7)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 9, letterSpacing: "1px" }}>PM</div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>NewPMJobs</span>
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.25)" }}>
            Built by{" "}
            <a href="https://www.linkedin.com/in/vik-agarwal/" target="_blank" rel="noopener noreferrer" style={{ color: "#0EA5E9", textDecoration: "none", fontWeight: 600 }}>Vik Agarwal</a>
            {" "}| Made by a PM, for PMs
          </div>
        </div>
      </footer>
    </div>
  );
}
