import { Resend } from "resend";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { ADMIN_EMAIL } from "../lib/constants";

const AI_TITLE_RE = /\b(AI|ML|GenAI|LLM|Machine Learning|Generative|Agentforce|Agentic|Voice AI|Copilot|GPT)\b/i;
const TOP_INDUSTRIES = 5;
const TOP_COMPANIES = 10;
const AI_TOP_COMPANIES = 5;
const AI_SAMPLE_TITLES_PER_CO = 3;

interface JobRow {
  job_title: string;
  job_location: string | null;
  first_seen_at: string;
  job_level: string | null;
  companies: { name: string; industry: string | null } | null;
}

export interface WeeklyDigestData {
  weekLabel: string;
  totalNewJobs: number;
  trackedCompanies: number;
  byIndustry: { industry: string; count: number }[];
  topCompanies: { name: string; count: number; sampleTitles: string[] }[];
  aiRoles: { count: number; topCompanies: { name: string; titles: string[] }[] };
}

export async function computeWeeklyDigest(now: Date = new Date()): Promise<WeeklyDigestData> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [{ data: jobsRaw, error: jobsErr }, { count: companyCount, error: coErr }] = await Promise.all([
    supabase
      .from("seen_jobs")
      .select("job_title, job_location, first_seen_at, job_level, companies!inner ( name, industry )")
      .eq("status", "active")
      .eq("is_baseline", false)
      .gte("first_seen_at", weekAgo.toISOString()),
    supabase.from("companies").select("id", { count: "exact", head: true }),
  ]);

  if (jobsErr) throw jobsErr;
  if (coErr) throw coErr;

  const jobs = (jobsRaw || []) as unknown as JobRow[];

  const industryMap = new Map<string, number>();
  const companyMap = new Map<string, { count: number; titles: string[] }>();
  const aiCompanyMap = new Map<string, string[]>();
  let aiCount = 0;

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

  const weekLabel = `${weekAgo.toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return {
    weekLabel,
    totalNewJobs: jobs.length,
    trackedCompanies: companyCount || 0,
    byIndustry,
    topCompanies,
    aiRoles: { count: aiCount, topCompanies: aiTop },
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

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// LinkedIn-ready post text. Plain text with markdown-style emphasis the user
// can paste into LinkedIn and convert manually (LinkedIn doesn't support
// markdown — but the bold markers help the user spot where to apply Unicode
// bold themselves). Mirrors the structure approved 2026-05-22.
export function renderLinkedInPost(d: WeeklyDigestData): string {
  const bankingRow = d.byIndustry.find((b) => b.industry === "banking");
  const bankingPct = bankingRow ? pct(bankingRow.count, d.totalNewJobs) : 0;

  const industryLine = d.byIndustry
    .map((b) => `${formatIndustryLabel(b.industry)}: ${b.count}`)
    .join(" · ");

  const topCoLines = d.topCompanies
    .map((c, i) => `${i + 1}. ${c.name} — ${c.count}`)
    .join("\n");

  const topCo = d.topCompanies[0];
  let topCoBlurb = "";
  if (topCo) {
    const sampleSlots = topCo.sampleTitles
      .slice(0, 5)
      .map((t) => t.replace(/^(Senior |Sr\.? |Manager,? |Director,? )?Product (Manager|Management),?\s*-?\s*/i, "").trim())
      .filter((s) => s.length > 0)
      .slice(0, 5);
    topCoBlurb = `${topCo.name} alone posted ${topCo.count}. ${sampleSlots.join(", ")}.`;
  }

  const aiLines = d.aiRoles.topCompanies
    .map((c, i) => `${i + 1}. ${c.name} — ${c.titles.slice(0, 2).join(" · ")}`)
    .join("\n");

  return [
    `I track ${d.trackedCompanies} companies' PM job postings every day at newpmjobs.com. Starting this week, I'll share the highlights every Friday.`,
    "",
    `This week, ${d.totalNewJobs} new PM roles were posted. Here are the key insights:`,
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

export function renderEmailHtml(d: WeeklyDigestData): string {
  const post = renderLinkedInPost(d);
  const postHtml = post
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");

  const industryTable = d.byIndustry
    .map((b) => `<tr><td style="padding:4px 12px 4px 0;color:#374151;">${formatIndustryLabel(b.industry)}</td><td style="padding:4px 0;color:#111827;font-weight:600;">${b.count}</td><td style="padding:4px 0 4px 12px;color:#6b7280;">${pct(b.count, d.totalNewJobs)}%</td></tr>`)
    .join("");

  const topCoTable = d.topCompanies
    .map((c, i) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${i + 1}</td><td style="padding:4px 12px 4px 0;color:#111827;">${c.name}</td><td style="padding:4px 0;color:#111827;font-weight:600;">${c.count}</td></tr>`)
    .join("");

  const aiList = d.aiRoles.topCompanies
    .map((c) => `<li style="margin-bottom:8px;"><strong style="color:#111827;">${c.name}</strong><div style="color:#4b5563;font-size:13px;">${c.titles.join(" · ")}</div></li>`)
    .join("");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
<div style="max-width:640px;margin:0 auto;padding:24px;background:#ffffff;">
  <p style="margin:0 0 8px 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Weekly LinkedIn Draft</p>
  <h1 style="margin:0 0 4px 0;font-size:22px;color:#111827;">Week of ${d.weekLabel}</h1>
  <p style="margin:0 0 24px 0;color:#6b7280;font-size:14px;">${d.totalNewJobs} new PM roles across ${d.trackedCompanies} companies. Copy + paste below into LinkedIn.</p>

  <div style="background:#f3f4f6;border-left:4px solid #0EA5E9;padding:20px;border-radius:6px;margin-bottom:32px;">
    <div style="font-size:15px;line-height:1.6;color:#111827;">${postHtml}</div>
  </div>

  <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 12px 0;">Raw data for verification</h2>

  <h3 style="font-size:15px;color:#111827;margin:16px 0 8px 0;">By industry</h3>
  <table style="border-collapse:collapse;font-size:14px;">${industryTable}</table>

  <h3 style="font-size:15px;color:#111827;margin:24px 0 8px 0;">Top ${d.topCompanies.length} companies by volume</h3>
  <table style="border-collapse:collapse;font-size:14px;">${topCoTable}</table>

  <h3 style="font-size:15px;color:#111827;margin:24px 0 8px 0;">AI PM roles by company (${d.aiRoles.count} total)</h3>
  <ul style="margin:0;padding-left:20px;font-size:14px;color:#374151;">${aiList}</ul>

  <p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">NewPMJobs weekly digest. Sent every Friday at 14:00 UTC.</p>
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
    console.log("RESEND_API_KEY not set — skipping weekly digest send");
    return { sent: false, reason: "no_api_key", data };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const subject = `Weekly LinkedIn draft — ${data.weekLabel} (${data.totalNewJobs} new PM roles)`;

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
