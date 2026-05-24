import { Resend } from "resend";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { ADMIN_EMAIL } from "../lib/constants";

const AI_TITLE_RE = /\b(AI|ML|GenAI|LLM|Machine Learning|Generative|Agentforce|Agentic|Voice AI|Copilot|GPT)\b/i;
const TOP_INDUSTRIES = 5;
const TOP_COMPANIES = 10;
const AI_TOP_COMPANIES = 5;
const AI_SAMPLE_TITLES_PER_CO = 3;
const TOP_LOCATIONS = 5;
const TOP_COMP_COMPANIES = 5;
const TOP_SURGE_COMPANIES = 5;
const SURGE_MIN_THIS_WEEK = 3; // ignore noisy small-sample surges

// Canonicalize tech acronyms in user-facing titles. Job postings frequently
// title-case AI/ML/LLM/etc. ("Productivity Ai", "Ml Infrastructure"); we
// uppercase them at render time. Word-boundary anchored so "Aim", "Aix",
// "Maintenance" aren't touched. Source data in seen_jobs stays as-is.
function fixTechAcronyms(s: string): string {
  return s
    .replace(/\bA\.?I\.?\b/gi, "AI")
    .replace(/\bM\.?L\.?\b/gi, "ML")
    .replace(/\bL\.?L\.?M\.?\b/gi, "LLM")
    .replace(/\bG\.?P\.?T\.?\b/gi, "GPT")
    .replace(/\bGen[\s-]?AI\b/gi, "GenAI");
}

interface JobRow {
  job_title: string;
  job_location: string | null;
  first_seen_at: string;
  job_level: string | null;
  companies: { name: string; industry: string | null } | null;
}

interface CompCacheRow {
  company_name: string;
  data: {
    overallMedianTC?: number;
    tiers?: {
      early?: { min: number; max: number };
      mid?: { min: number; max: number };
      director?: { min: number; max: number };
    };
  } | null;
}

export interface WeeklyDigestData {
  weekLabel: string;
  fridayDate: string;
  totalNewJobs: number;
  trackedCompanies: number;
  byIndustry: { industry: string; count: number }[];
  topCompanies: { name: string; count: number; sampleTitles: string[] }[];
  aiRoles: { count: number; topCompanies: { name: string; titles: string[] }[] };
  // Appendix cuts (added 2026-05-23). All optional for caller safety; the
  // renderer hides any empty section.
  byLocation: { location: string; count: number }[];
  remoteShare: { remote: number; nonRemote: number; pct: number };
  bySeniority: { level: string; count: number }[];
  topPayingCompanies: { name: string; medianTC: number; thisWeekCount: number }[];
  surgeCompanies: { name: string; thisWeek: number; priorAvg: number; ratio: number }[];
  dailyVelocity: { date: string; count: number }[];
}

export async function computeWeeklyDigest(now: Date = new Date()): Promise<WeeklyDigestData> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fiveWeeksAgo = new Date(now.getTime() - 5 * 7 * 24 * 60 * 60 * 1000);

  // Three parallel queries: this-week jobs, total company count, prior-4-week
  // job/company pairs (for the surge cut). Comp data join runs after we know
  // which companies posted this week.
  const [
    { data: jobsRaw, error: jobsErr },
    { count: companyCount, error: coErr },
    { data: priorJobsRaw, error: priorErr },
  ] = await Promise.all([
    supabase
      .from("seen_jobs")
      .select("job_title, job_location, first_seen_at, job_level, companies!inner ( name, industry )")
      .eq("status", "active")
      .eq("is_baseline", false)
      .gte("first_seen_at", weekAgo.toISOString()),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase
      .from("seen_jobs")
      .select("companies!inner ( name )")
      .eq("status", "active")
      .eq("is_baseline", false)
      .gte("first_seen_at", fiveWeeksAgo.toISOString())
      .lt("first_seen_at", weekAgo.toISOString()),
  ]);

  if (jobsErr) throw jobsErr;
  if (coErr) throw coErr;
  if (priorErr) throw priorErr;

  const jobs = (jobsRaw || []) as unknown as JobRow[];
  const priorJobs = (priorJobsRaw || []) as unknown as { companies: { name: string } | null }[];

  // ---- Aggregations over this-week jobs ----
  const industryMap = new Map<string, number>();
  const companyMap = new Map<string, { count: number; titles: string[] }>();
  const aiCompanyMap = new Map<string, string[]>();
  const locationMap = new Map<string, number>();
  const seniorityMap = new Map<string, number>();
  const dailyMap = new Map<string, number>();
  let aiCount = 0;
  let remoteCount = 0;

  for (const j of jobs) {
    const co = j.companies?.name;
    if (!co) continue;

    const industry = j.companies?.industry || "other";
    industryMap.set(industry, (industryMap.get(industry) || 0) + 1);

    const ce = companyMap.get(co) || { count: 0, titles: [] };
    ce.count += 1;
    if (ce.titles.length < 5) ce.titles.push(j.job_title);
    companyMap.set(co, ce);

    if (AI_TITLE_RE.test(j.job_title)) {
      aiCount += 1;
      const a = aiCompanyMap.get(co) || [];
      if (a.length < AI_SAMPLE_TITLES_PER_CO) a.push(j.job_title);
      aiCompanyMap.set(co, a);
    }

    // Location: top cities. "Remote" excluded from city counts but tallied
    // in remoteShare. First chunk before the first comma is the city.
    const loc = (j.job_location || "").trim();
    if (loc) {
      if (/\bremote\b/i.test(loc)) {
        remoteCount += 1;
      } else {
        const city = loc.split(",")[0].trim();
        if (city) {
          locationMap.set(city, (locationMap.get(city) || 0) + 1);
        }
      }
    }

    // Seniority: early / mid / director / "unclassified" (null job_level)
    const sen = j.job_level || "unclassified";
    seniorityMap.set(sen, (seniorityMap.get(sen) || 0) + 1);

    // Daily velocity: YYYY-MM-DD bucket
    const day = j.first_seen_at.slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
  }

  // ---- Comp cache lookup (limited to companies that posted this week) ----
  const uniqueCompanyNames = [...companyMap.keys()];
  let compCacheRows: CompCacheRow[] = [];
  if (uniqueCompanyNames.length > 0) {
    const { data: compData } = await supabase
      .from("comp_cache")
      .select("company_name, data")
      .in("company_name", uniqueCompanyNames);
    compCacheRows = (compData || []) as unknown as CompCacheRow[];
  }
  const compByCompany = new Map<string, number>(); // company -> overall median TC
  for (const row of compCacheRows) {
    if (!row.data) continue;
    let median = row.data.overallMedianTC;
    if (!median && row.data.tiers) {
      // Fallback: average of mid tier
      const mid = row.data.tiers.mid;
      if (mid && mid.min && mid.max) {
        median = Math.round((mid.min + mid.max) / 2);
      }
    }
    if (median && median > 0) {
      compByCompany.set(row.company_name, median);
    }
  }

  // ---- Surge: companies with biggest jump vs prior 4-week average ----
  const priorCountByCompany = new Map<string, number>();
  for (const row of priorJobs) {
    const name = row.companies?.name;
    if (!name) continue;
    priorCountByCompany.set(name, (priorCountByCompany.get(name) || 0) + 1);
  }

  const byIndustry = [...industryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_INDUSTRIES)
    .map(([industry, count]) => ({ industry, count }));

  const topCompanies = [...companyMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, TOP_COMPANIES)
    .map(([name, v]) => ({ name, count: v.count, sampleTitles: v.titles }));

  const aiTop = [...aiCompanyMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, AI_TOP_COMPANIES)
    .map(([name, titles]) => ({ name, titles }));

  const byLocation = [...locationMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LOCATIONS)
    .map(([location, count]) => ({ location, count }));

  const remoteShare = {
    remote: remoteCount,
    nonRemote: jobs.length - remoteCount,
    pct: jobs.length > 0 ? Math.round((remoteCount / jobs.length) * 100) : 0,
  };

  // Order seniority: director > mid > early > unclassified
  const senOrder: Record<string, number> = { director: 0, mid: 1, early: 2, unclassified: 3 };
  const bySeniority = [...seniorityMap.entries()]
    .sort((a, b) => (senOrder[a[0]] ?? 99) - (senOrder[b[0]] ?? 99))
    .map(([level, count]) => ({ level, count }));

  const topPayingCompanies = [...companyMap.entries()]
    .map(([name, v]) => ({ name, thisWeekCount: v.count, medianTC: compByCompany.get(name) || 0 }))
    .filter((c) => c.medianTC > 0)
    .sort((a, b) => b.medianTC - a.medianTC)
    .slice(0, TOP_COMP_COMPANIES);

  const surgeCompanies = [...companyMap.entries()]
    .filter(([, v]) => v.count >= SURGE_MIN_THIS_WEEK)
    .map(([name, v]) => {
      const priorAvg = (priorCountByCompany.get(name) || 0) / 4;
      const ratio = v.count / Math.max(1, priorAvg);
      return { name, thisWeek: v.count, priorAvg: Math.round(priorAvg * 10) / 10, ratio };
    })
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, TOP_SURGE_COMPANIES);

  const dailyVelocity = [...dailyMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, count]) => ({ date, count }));

  const weekLabel = `${weekAgo.toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const fridayDate = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return {
    weekLabel,
    fridayDate,
    totalNewJobs: jobs.length,
    trackedCompanies: companyCount || 0,
    byIndustry,
    topCompanies,
    aiRoles: { count: aiCount, topCompanies: aiTop },
    byLocation,
    remoteShare,
    bySeniority,
    topPayingCompanies,
    surgeCompanies,
    dailyVelocity,
  };
}

function formatIndustryLabel(slug: string): string {
  const map: Record<string, string> = {
    banking: "Banking",
    tech: "Tech",
    fintech: "Fintech",
    biotech: "Biotech",
    gaming: "Gaming",
    consulting: "Consulting",
    healthcare: "Healthcare",
    consumer: "Consumer",
    media: "Media",
    hardware: "Hardware",
    ai: "AI",
    dev_tools: "Dev Tools",
    streaming: "Streaming",
    edtech: "EdTech",
    crypto: "Crypto",
    other: "Other",
  };
  return map[slug] || slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSeniorityLabel(level: string): string {
  const map: Record<string, string> = {
    early: "Early-career (junior IC / new grad)",
    mid: "Mid (senior IC / line manager)",
    director: "Director+ (Director / VP / Head)",
    unclassified: "Unclassified (level not detected)",
  };
  return map[level] || level;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function formatCompUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
}

function formatDateLabel(yyyyMmDd: string): string {
  // Input "2026-05-22" -> "Fri May 22"
  const d = new Date(yyyyMmDd + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// LinkedIn-ready post text. Structure locked editorially 2026-05-22; this
// renderer only formats data and applies tech-acronym capitalization. Don't
// change the post copy without checking with Vik.
export function renderLinkedInPost(d: WeeklyDigestData): string {
  const bankingRow = d.byIndustry.find((b) => b.industry === "banking");
  const bankingPct = bankingRow ? pct(bankingRow.count, d.totalNewJobs) : 0;

  const industryLine = d.byIndustry
    .map((b) => `${formatIndustryLabel(b.industry)}: ${b.count}`)
    .join(" · ");

  const topCoLines = d.topCompanies
    .map((c, i) => `${i + 1}. ${c.name}: ${c.count}`)
    .join("\n");

  const topCo = d.topCompanies[0];
  let topCoBlurb = "";
  if (topCo) {
    const sampleSlots = topCo.sampleTitles
      .slice(0, 5)
      .map((t) => fixTechAcronyms(t).replace(/^(Senior |Sr\.? |Manager,? |Director,? )?Product (Manager|Management),?\s*-?\s*/i, "").trim())
      .filter((s) => s.length > 0)
      .slice(0, 5);
    topCoBlurb = `${topCo.name} alone posted ${topCo.count}. ${sampleSlots.join(", ")}.`;
  }

  // AI roles: company name on its own line, each title indented under it as
  // a bullet on its own line. Matches the format Vik used in his 2026-05-23
  // post draft (long titles needed visual breathing room).
  const aiLines = d.aiRoles.topCompanies
    .map((c, i) => {
      const header = `${i + 1}. ${c.name}`;
      const bullets = c.titles
        .slice(0, 2)
        .map((t) => `   • ${fixTechAcronyms(t)}`)
        .join("\n");
      return `${header}\n${bullets}`;
    })
    .join("\n");

  return [
    `Are you looking for a new PM job? I track PM job postings at ${d.trackedCompanies} companies every day at newpmjobs.com. Here are the highlights for the week ending ${d.fridayDate}.`,
    "",
    `${d.totalNewJobs} new PM roles were posted this week. The key insights:`,
    "",
    `**Banking is on a tear.**`,
    `${bankingPct}% of all new PM roles posted this week were in banking.`,
    industryLine,
    "",
    `**Top 10 companies by volume:**`,
    topCoLines,
    "",
    topCoBlurb,
    "",
    `**Where the new AI PM roles landed (${d.aiRoles.count} this week):**`,
    aiLines,
    "",
    `Where are you applying right now? And what else would you want to see in next week's summary?`,
  ].join("\n");
}

// ----- HTML rendering helpers for the email body -----

const SECTION_HEADER_STYLE = "font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin:32px 0 12px 0;font-weight:600;";
const SUBHEAD_STYLE = "font-size:15px;color:#111827;margin:20px 0 8px 0;font-weight:600;";
const TABLE_STYLE = "border-collapse:collapse;font-size:14px;";
const TD_LABEL = "padding:4px 12px 4px 0;color:#374151;";
const TD_VAL = "padding:4px 0;color:#111827;font-weight:600;";
const TD_DIM = "padding:4px 0 4px 12px;color:#6b7280;";

function renderIndustryTable(d: WeeklyDigestData): string {
  return d.byIndustry
    .map((b) => `<tr><td style="${TD_LABEL}">${formatIndustryLabel(b.industry)}</td><td style="${TD_VAL}">${b.count}</td><td style="${TD_DIM}">${pct(b.count, d.totalNewJobs)}%</td></tr>`)
    .join("");
}

function renderTopCoTable(d: WeeklyDigestData): string {
  return d.topCompanies
    .map((c, i) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${i + 1}</td><td style="padding:4px 12px 4px 0;color:#111827;">${c.name}</td><td style="${TD_VAL}">${c.count}</td></tr>`)
    .join("");
}

function renderAiList(d: WeeklyDigestData): string {
  return d.aiRoles.topCompanies
    .map((c) => `<li style="margin-bottom:12px;"><strong style="color:#111827;">${c.name}</strong><ul style="margin:6px 0 0 0;padding-left:18px;color:#4b5563;font-size:13px;">${c.titles.slice(0, 3).map((t) => `<li style="margin-bottom:3px;">${fixTechAcronyms(t)}</li>`).join("")}</ul></li>`)
    .join("");
}

function renderLocationTable(d: WeeklyDigestData): string {
  if (d.byLocation.length === 0) return "";
  return d.byLocation
    .map((b, i) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${i + 1}</td><td style="padding:4px 12px 4px 0;color:#111827;">${b.location}</td><td style="${TD_VAL}">${b.count}</td><td style="${TD_DIM}">${pct(b.count, d.totalNewJobs)}%</td></tr>`)
    .join("");
}

function renderSeniorityTable(d: WeeklyDigestData): string {
  return d.bySeniority
    .map((b) => `<tr><td style="${TD_LABEL}">${formatSeniorityLabel(b.level)}</td><td style="${TD_VAL}">${b.count}</td><td style="${TD_DIM}">${pct(b.count, d.totalNewJobs)}%</td></tr>`)
    .join("");
}

function renderCompTable(d: WeeklyDigestData): string {
  if (d.topPayingCompanies.length === 0) return "";
  return d.topPayingCompanies
    .map((c, i) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${i + 1}</td><td style="padding:4px 12px 4px 0;color:#111827;">${c.name}</td><td style="${TD_VAL}">${formatCompUSD(c.medianTC)}</td><td style="${TD_DIM}">${c.thisWeekCount} role${c.thisWeekCount === 1 ? "" : "s"}</td></tr>`)
    .join("");
}

function renderSurgeTable(d: WeeklyDigestData): string {
  if (d.surgeCompanies.length === 0) return "";
  return d.surgeCompanies
    .map((c, i) => {
      const ratioLabel = c.priorAvg > 0 ? `${c.ratio.toFixed(1)}x` : "new";
      return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${i + 1}</td><td style="padding:4px 12px 4px 0;color:#111827;">${c.name}</td><td style="${TD_VAL}">${c.thisWeek}</td><td style="${TD_DIM}">${c.priorAvg.toFixed(1)} avg → ${ratioLabel}</td></tr>`;
    })
    .join("");
}

function renderDailyVelocityTable(d: WeeklyDigestData): string {
  return d.dailyVelocity
    .map((day) => `<tr><td style="padding:4px 12px 4px 0;color:#374151;">${formatDateLabel(day.date)}</td><td style="${TD_VAL}">${day.count}</td><td style="${TD_DIM}">${pct(day.count, d.totalNewJobs)}%</td></tr>`)
    .join("");
}

export function renderEmailHtml(d: WeeklyDigestData): string {
  const post = renderLinkedInPost(d);
  const postHtml = post
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
<div style="max-width:680px;margin:0 auto;padding:24px;background:#ffffff;">

  <p style="margin:0 0 8px 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Weekly LinkedIn Draft · ${d.fridayDate}</p>
  <h1 style="margin:0 0 4px 0;font-size:22px;color:#111827;">Week of ${d.weekLabel}</h1>
  <p style="margin:0 0 24px 0;color:#6b7280;font-size:14px;">${d.totalNewJobs} new PM roles across ${d.trackedCompanies} companies. Copy + paste below into LinkedIn. Appendix data slices below for next week's lead inspiration.</p>

  <div style="background:#f3f4f6;border-left:4px solid #0EA5E9;padding:20px;border-radius:6px;margin-bottom:32px;">
    <div style="font-size:15px;line-height:1.6;color:#111827;white-space:pre-wrap;">${postHtml}</div>
  </div>

  <h2 style="${SECTION_HEADER_STYLE}">Raw data for verification</h2>

  <h3 style="${SUBHEAD_STYLE}">By industry</h3>
  <table style="${TABLE_STYLE}">${renderIndustryTable(d)}</table>

  <h3 style="${SUBHEAD_STYLE}">Top ${d.topCompanies.length} companies by volume</h3>
  <table style="${TABLE_STYLE}">${renderTopCoTable(d)}</table>

  <h3 style="${SUBHEAD_STYLE}">AI PM roles by company (${d.aiRoles.count} total)</h3>
  <ul style="margin:0;padding-left:20px;font-size:14px;color:#374151;">${renderAiList(d)}</ul>

  <h2 style="${SECTION_HEADER_STYLE}">Appendix: data slices for editorial inspiration</h2>

  <h3 style="${SUBHEAD_STYLE}">Top cities by new role volume</h3>
  <table style="${TABLE_STYLE}">${renderLocationTable(d)}</table>
  <p style="font-size:13px;color:#6b7280;margin:8px 0 0 0;">Remote roles: <strong style="color:#111827;">${d.remoteShare.remote}</strong> (${d.remoteShare.pct}% of this week's new roles).</p>

  <h3 style="${SUBHEAD_STYLE}">By seniority</h3>
  <table style="${TABLE_STYLE}">${renderSeniorityTable(d)}</table>

  <h3 style="${SUBHEAD_STYLE}">Top-paying companies hiring this week (median TC)</h3>
  <table style="${TABLE_STYLE}">${renderCompTable(d) || `<tr><td style="color:#9ca3af;font-style:italic;font-size:13px;">No comp data matched this week's hiring companies.</td></tr>`}</table>
  <p style="font-size:11px;color:#9ca3af;margin:6px 0 0 0;font-style:italic;">Median TC sourced from levels.fyi via comp_cache. Companies without coverage excluded.</p>

  <h3 style="${SUBHEAD_STYLE}">Surge: biggest jumps vs prior 4-week average</h3>
  <table style="${TABLE_STYLE}">${renderSurgeTable(d) || `<tr><td style="color:#9ca3af;font-style:italic;font-size:13px;">No surges met the threshold (≥${SURGE_MIN_THIS_WEEK} this week).</td></tr>`}</table>

  <h3 style="${SUBHEAD_STYLE}">Daily posting velocity</h3>
  <table style="${TABLE_STYLE}">${renderDailyVelocityTable(d)}</table>

  <p style="margin-top:36px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">NewPMJobs weekly digest. Sent every Friday at 14:00 UTC.</p>
</div>
</body></html>`;
}

export async function sendWeeklyDigest(now: Date = new Date()): Promise<{ sent: boolean; reason?: string; data?: WeeklyDigestData }> {
  let data: WeeklyDigestData;
  try {
    data = await computeWeeklyDigest(now);
  } catch (err) {
    Sentry.captureException(err);
    console.error("Weekly digest compute failed:", err);
    return { sent: false, reason: "compute_failed" };
  }

  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set, skipping weekly digest send");
    return { sent: false, reason: "no_api_key", data };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  // Unicode-bold WEEKLY so it renders bold in Gmail's subject column.
  // Falls back to a fallback font in clients that don't render Unicode bold,
  // which still reads as ALL CAPS "WEEKLY". If it ever looks broken, switch
  // to plain ASCII: `WEEKLY: LinkedIn Job Summary for ${data.fridayDate}`.
  const subject = `\u{1D5EA}\u{1D5D8}\u{1D5D8}\u{1D5DE}\u{1D5DF}\u{1D5EC}: LinkedIn Job Summary for ${data.fridayDate}`;

  try {
    await resend.emails.send({
      from: "NewPMJobs <alerts@newpmjobs.com>",
      to: ADMIN_EMAIL,
      subject,
      html: renderEmailHtml(data),
    });
    console.log(`Weekly digest sent to ${ADMIN_EMAIL}: ${subject}`);
    return { sent: true, data };
  } catch (err) {
    Sentry.captureException(err);
    console.error("Weekly digest send failed:", err);
    return { sent: false, reason: "send_failed", data };
  }
}
