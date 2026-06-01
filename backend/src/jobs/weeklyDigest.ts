import { Resend } from "resend";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";
import { ADMIN_EMAIL } from "../lib/constants";
import { fetchAllRows } from "../lib/fetchAllRows";
import { writeLeads, type LeadCandidate, type PhrasedLead } from "../lib/weeklyLeadWriter";
import {
  buildImagePrompt,
  pickArtStyle,
  generateDigestImage,
  type ArtStyleKey,
} from "../lib/weeklyDigestImage";

const AI_TITLE_RE = /\b(AI|ML|GenAI|LLM|Machine Learning|Generative|Agentforce|Agentic|Voice AI|Copilot|GPT)\b/i;
const TOP_INDUSTRIES = 5;
const TOP_COMPANIES = 10;
const AI_TOP_COMPANIES = 5;
const AI_SAMPLE_TITLES_PER_CO = 3;
const TOP_LOCATIONS = 5;
const TOP_COMP_COMPANIES = 5;
const TOP_SURGE_COMPANIES = 5;
const SURGE_MIN_THIS_WEEK = 3; // ignore noisy small-sample surges

// Companies that count as "big tech" for the concentration angle.
const BIG_TECH = new Set(["Amazon", "Apple", "Google", "Meta", "Microsoft", "Netflix", "NVIDIA", "Adobe"]);

// Eligibility thresholds for lead angles (keep small-sample noise out of the
// public hook). Snapshots only -- deliberately no week-over-week trend claims,
// which on this data are contaminated by catalog-onboarding bursts.
const AI_MIN = 3;
const BIG_TECH_MIN = 3;

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

// Clean a raw job title for display: fix acronyms + strip em/en dashes (Vik's
// hard style rule) so role titles in the post never carry a stray dash.
function cleanTitle(t: string): string {
  return fixTechAcronyms(t)
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  // Rotating "My take" lead + alternates + banner (added 2026-05-30, DEV-43).
  aiShare: { count: number; total: number; pct: number };
  bigTechShare: { companies: string[]; count: number; pct: number };
  suggestedLead: PhrasedLead | null;
  alternateLeads: PhrasedLead[];
  imagePrompt: string;
  artStyle: ArtStyleKey;
  llmModel: string | null;
  llmUsage: { input: number; output: number } | null;
}

// Build the factual lead-angle candidates from this-week data (snapshots only).
// Priority order = push order: ai_share, top_company, big_tech, top_pay,
// top_city, seniority. The first eligible angle not used in recent weeks becomes
// the lead; the rest become the appendix alternates.
function buildLeadCandidates(d: {
  total: number;
  aiCount: number;
  aiTopNames: string[];
  topCompanies: { name: string; count: number }[];
  bigTechShare: { companies: string[]; count: number; pct: number };
  topPay?: { name: string; medianTC: number };
  topCity?: { location: string; count: number };
  remote: number;
  midCount: number;
}): LeadCandidate[] {
  const candidates: LeadCandidate[] = [];
  const { total } = d;
  const aiRatio = d.aiCount > 0 ? Math.round(total / d.aiCount) : 0;
  // Only phrase as "1 in N" when that's an honest rounding (AI share below ~40%);
  // otherwise use the percentage so the public claim never misstates the ratio.
  const aiRatioPhrase = aiRatio >= 2 ? `about 1 in ${aiRatio}` : `${pct(d.aiCount, total)}% of new roles`;

  if (d.aiCount >= AI_MIN && total > 0) {
    candidates.push({
      key: "ai_share",
      fact: `${d.aiCount} of the ${total} new PM roles this week were AI roles (${aiRatioPhrase}). Companies hiring them include ${d.aiTopNames.slice(0, 3).join(", ")}.`,
      fallbackHook: "AI roles are everywhere now.",
      fallbackSupport: `${d.aiCount} of the ${total} new PM roles this week were AI roles (${aiRatioPhrase}).`,
      imageSubline: aiRatio >= 2 ? `1 in ${aiRatio} new PM roles is an AI role.` : `${pct(d.aiCount, total)}% of new PM roles are AI.`,
    });
  }

  const top = d.topCompanies[0];
  const second = d.topCompanies[1];
  if (top) {
    candidates.push({
      key: "top_company",
      fact: `${top.name} posted ${top.count} new PM roles this week, the most of any company${second ? ` (the next was ${second.name} at ${second.count})` : ""}.`,
      fallbackHook: `${top.name} is hiring PMs like crazy.`,
      fallbackSupport: `It posted ${top.count} new PM roles this week, the most of any company${second ? `, more than ${second.name}'s ${second.count}` : ""}.`,
      imageSubline: `${top.count} new PM roles this week.`,
    });
  }

  if (d.bigTechShare.count >= BIG_TECH_MIN && d.bigTechShare.companies.length >= 2) {
    candidates.push({
      key: "big_tech",
      fact: `${d.bigTechShare.companies.join(", ")} together posted ${d.bigTechShare.count} of the ${total} new PM roles this week (about ${d.bigTechShare.pct}%).`,
      fallbackHook: "Big tech is doing most of the hiring.",
      fallbackSupport: `${d.bigTechShare.companies.slice(0, 4).join(", ")} posted ${d.bigTechShare.count} of the ${total} new PM roles this week.`,
      imageSubline: `${d.bigTechShare.pct}% of new PM roles.`,
    });
  }

  if (d.topPay) {
    candidates.push({
      key: "top_pay",
      fact: `${d.topPay.name} has the highest median PM total comp of any company hiring this week, ${formatCompUSD(d.topPay.medianTC)}.`,
      fallbackHook: `${d.topPay.name} pays the most.`,
      fallbackSupport: `Its median PM total comp is ${formatCompUSD(d.topPay.medianTC)}, the highest of anyone hiring this week.`,
      imageSubline: `${formatCompUSD(d.topPay.medianTC)} median PM comp.`,
    });
  }

  if (d.topCity) {
    candidates.push({
      key: "top_city",
      fact: `${d.topCity.location} led every city this week with ${d.topCity.count} new PM roles. Only ${d.remote} of ${total} were remote.`,
      fallbackHook: `${d.topCity.location} led every other city.`,
      fallbackSupport: `${d.topCity.count} new PM roles landed in ${d.topCity.location} this week, more than any other city.`,
      imageSubline: `${d.topCity.count} new roles in ${d.topCity.location}.`,
    });
  }

  if (d.midCount > 0 && total > 0) {
    candidates.push({
      key: "seniority",
      fact: `${d.midCount} of the ${total} new PM roles this week (${pct(d.midCount, total)}%) were mid-level.`,
      fallbackHook: "Most roles this week were mid-level.",
      fallbackSupport: `${d.midCount} of the ${total} new PM roles (${pct(d.midCount, total)}%) were mid-level.`,
      imageSubline: `${pct(d.midCount, total)}% mid-level.`,
    });
  }

  return candidates;
}

export async function computeWeeklyDigest(now: Date = new Date()): Promise<WeeklyDigestData> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fiveWeeksAgo = new Date(now.getTime() - 5 * 7 * 24 * 60 * 60 * 1000);

  // Three parallel queries: this-week jobs, total company count, prior-4-week
  // job/company pairs (for the surge cut). Comp data join runs after we know
  // which companies posted this week.
  //
  // Both seen_jobs reads are paginated via fetchAllRows: the prior-4-week
  // window already sits near the PostgREST 1000-row cap and an unbounded
  // select silently truncated it, undercounting the surge baseline so flat
  // companies read as "surging" in the LinkedIn draft (DEV-36).
  const [jobsRaw, companyCountResult, priorJobsRaw] = await Promise.all([
    fetchAllRows<JobRow>((from, to) =>
      supabase
        .from("seen_jobs")
        .select("job_title, job_location, first_seen_at, job_level, companies!inner ( name, industry )")
        .eq("status", "active")
        .eq("is_baseline", false)
        .gte("first_seen_at", weekAgo.toISOString())
        .order("id", { ascending: true })
        .range(from, to)
    ),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    fetchAllRows<{ companies: { name: string } | null }>((from, to) =>
      supabase
        .from("seen_jobs")
        .select("companies!inner ( name )")
        .eq("status", "active")
        .eq("is_baseline", false)
        .gte("first_seen_at", fiveWeeksAgo.toISOString())
        .lt("first_seen_at", weekAgo.toISOString())
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  if (companyCountResult.error) throw companyCountResult.error;
  const companyCount = companyCountResult.count;

  const jobs = jobsRaw as unknown as JobRow[];
  const priorJobs = priorJobsRaw as unknown as { companies: { name: string } | null }[];

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

  const total = jobs.length;

  // ---- Big-tech concentration ----
  let bigTechCount = 0;
  const bigTechNames: string[] = [];
  for (const [name, v] of companyMap) {
    if (BIG_TECH.has(name)) {
      bigTechCount += v.count;
      bigTechNames.push(name);
    }
  }
  bigTechNames.sort((a, b) => (companyMap.get(b)?.count || 0) - (companyMap.get(a)?.count || 0));
  const bigTechShare = { companies: bigTechNames, count: bigTechCount, pct: pct(bigTechCount, total) };
  const aiShare = { count: aiCount, total, pct: pct(aiCount, total) };

  // ---- Lead angle candidates (snapshots) ----
  const midCount = bySeniority.find((s) => s.level === "mid")?.count || 0;
  const candidates = buildLeadCandidates({
    total,
    aiCount,
    aiTopNames: aiTop.map((c) => c.name),
    topCompanies: topCompanies.map((c) => ({ name: c.name, count: c.count })),
    bigTechShare,
    topPay: topPayingCompanies[0],
    topCity: byLocation[0],
    remote: remoteCount,
    midCount,
  });

  // ---- Freshness: avoid repeating the last couple of weeks' angle/style ----
  let recentAngles = new Set<string>();
  let recentStyle: string | null = null;
  try {
    const { data: histRows } = await supabase
      .from("weekly_lead_history")
      .select("angle, art_style")
      .order("created_at", { ascending: false })
      .limit(2);
    recentAngles = new Set((histRows || []).map((r: { angle: string }) => r.angle));
    recentStyle = (histRows && histRows[0]?.art_style) || null;
  } catch {
    // table missing locally / read failed -> no freshness constraint, fine.
  }

  const leadCandidate = candidates.find((c) => !recentAngles.has(c.key)) || candidates[0] || null;
  const artStyle = pickArtStyle(recentStyle);

  // ---- Phrase every candidate in Vik's voice (LLM, with deterministic fallback) ----
  const writerResult = await writeLeads(candidates);
  const phrasedByKey = new Map(writerResult.leads.map((l) => [l.key, l]));
  const suggestedLead = leadCandidate ? phrasedByKey.get(leadCandidate.key) || null : null;
  const alternateLeads = writerResult.leads.filter((l) => !leadCandidate || l.key !== leadCandidate.key);

  const imageDateLabel = fridayDate; // "May 29" -> builder uppercases it
  const imagePrompt = suggestedLead
    ? buildImagePrompt({ dateLabel: imageDateLabel, hook: suggestedLead.hook, subline: suggestedLead.imageSubline, style: artStyle })
    : "";

  return {
    weekLabel,
    fridayDate,
    totalNewJobs: total,
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
    aiShare,
    bigTechShare,
    suggestedLead,
    alternateLeads,
    imagePrompt,
    artStyle,
    llmModel: writerResult.model,
    llmUsage: writerResult.usage,
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

// LinkedIn-ready post text. Structure refreshed 2026-05-30 (DEV-43) with Vik:
// above-the-fold dated volume -> "My take this week:" (rotating, voice-written) ->
// generic stats block (@-tagged) -> CTA. Plain text on purpose -- Vik bolds the
// opener + numbered headers in AuthoredUp; do not add Unicode/markdown bold here.
// Prefix "@" to any company name appearing in free text (the Claude-written
// lead) so every company in the post is a LinkedIn mention, matching the already
// @-tagged structured sections. Guards: longest-name-first (so "American Express"
// tags before "American"), word boundaries (won't tag inside "Metadata"), and a
// not-already-@ check (won't produce "@@Google"). Case-sensitive so it only tags
// proper-cased company mentions, never lowercase common words ("adobe", "uber").
function tagCompanyMentions(text: string, names: string[]): string {
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^@\\w])(${escaped})\\b`, "g");
    text = text.replace(re, (_m, pre, nm) => `${pre}@${nm}`);
  }
  return text;
}

export function renderLinkedInPost(d: WeeklyDigestData): string {
  const total = d.totalNewJobs;
  const aiRatio = d.aiRoles.count > 0 ? Math.round(total / d.aiRoles.count) : 0;

  const industryLine = d.byIndustry
    .map((b) => `${formatIndustryLabel(b.industry)} ${b.count} (${pct(b.count, total)}%)`)
    .join(", ");
  const topCoLines = d.topCompanies.map((c) => `@${c.name} - ${c.count}`).join("\n");
  const aiLines = d.aiRoles.topCompanies
    .map((c) => `@${c.name}: ${c.titles.slice(0, 2).map(cleanTitle).join("; ")}`)
    .join("\n");

  const leadNames = [
    ...d.topCompanies.map((c) => c.name),
    ...d.aiRoles.topCompanies.map((c) => c.name),
  ];
  const takeLine = d.suggestedLead
    ? tagCompanyMentions(
        `My take this week: ${d.suggestedLead.hook} ${d.suggestedLead.support}`.replace(/\s+/g, " ").trim(),
        leadNames,
      )
    : "My take this week: here is where PM hiring landed.";

  return [
    `${total} new PM jobs were posted this week (week ending ${d.fridayDate}).`,
    "",
    takeLine,
    "",
    "",
    `I track PM postings at ${d.trackedCompanies} companies every day at NewPMjobs.com. Here are this week's stats:`,
    "",
    `1. By industry: ${industryLine}`,
    "",
    `2. Top 10 companies by new PM role volume:`,
    topCoLines,
    "",
    `3. New AI PM roles (${d.aiRoles.count} this week${aiRatio >= 2 ? `, about 1 in ${aiRatio}` : ""}):`,
    aiLines,
    "",
    `What roles are you chasing this week? See them all at NewPMjobs.com.`,
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
    .map((c) => `<li style="margin-bottom:12px;"><strong style="color:#111827;">${c.name}</strong><ul style="margin:6px 0 0 0;padding-left:18px;color:#4b5563;font-size:13px;">${c.titles.slice(0, 3).map((t) => `<li style="margin-bottom:3px;">${cleanTitle(t)}</li>`).join("")}</ul></li>`)
    .join("");
}

function renderAlternates(d: WeeklyDigestData): string {
  if (!d.alternateLeads.length) {
    return `<p style="color:#9ca3af;font-style:italic;font-size:13px;margin:0;">No alternate angles met the bar this week.</p>`;
  }
  return `<ul style="margin:0;padding-left:20px;font-size:14px;color:#374151;">${d.alternateLeads
    .map((l) => `<li style="margin-bottom:8px;"><strong style="color:#111827;">${escapeHtml(l.hook)}</strong> ${escapeHtml(l.support)}</li>`)
    .join("")}</ul>`;
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
      return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${i + 1}</td><td style="padding:4px 12px 4px 0;color:#111827;">${c.name}</td><td style="${TD_VAL}">${c.thisWeek}</td><td style="${TD_DIM}">${c.priorAvg.toFixed(1)} avg to ${ratioLabel}</td></tr>`;
    })
    .join("");
}

function renderDailyVelocityTable(d: WeeklyDigestData): string {
  return d.dailyVelocity
    .map((day) => `<tr><td style="padding:4px 12px 4px 0;color:#374151;">${formatDateLabel(day.date)}</td><td style="${TD_VAL}">${day.count}</td><td style="${TD_DIM}">${pct(day.count, d.totalNewJobs)}%</td></tr>`)
    .join("");
}

function costFooter(d: WeeklyDigestData, imageAttached: boolean): string {
  let llmLine = "lead written by deterministic fallback (no LLM cost)";
  let llmCost = 0;
  if (d.llmUsage && d.llmModel) {
    const isOpus = /opus/i.test(d.llmModel);
    const inRate = isOpus ? 5 : 3;
    const outRate = isOpus ? 25 : 15;
    llmCost = (d.llmUsage.input / 1_000_000) * inRate + (d.llmUsage.output / 1_000_000) * outRate;
    llmLine = `${d.llmModel}: ${d.llmUsage.input} in / ${d.llmUsage.output} out = $${llmCost.toFixed(4)}`;
  }
  const imgCost = imageAttached ? 0.039 : 0;
  const total = llmCost + imgCost;
  const imgLine = imageAttached ? "; banner image: $0.039" : " (no image generated this run)";
  return `Generation cost: ${llmLine}${imgLine}. Total this send: ~$${total.toFixed(3)}.`;
}

export function renderEmailHtml(d: WeeklyDigestData, imageAttached = false): string {
  const post = renderLinkedInPost(d);
  // Keep real newlines (do NOT convert to <br/>): a <pre> element preserves them
  // in the plain-text clipboard flavor, so copy-paste into LinkedIn keeps line
  // breaks. The old <br/>-in-a-div collapsed to one line when pasted.
  const postHtml = escapeHtml(post);

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
<div style="max-width:680px;margin:0 auto;padding:24px;background:#ffffff;">

  <p style="margin:0 0 8px 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Weekly LinkedIn Draft · ${d.fridayDate}</p>
  <h1 style="margin:0 0 4px 0;font-size:22px;color:#111827;">Week of ${d.weekLabel}</h1>
  <p style="margin:0 0 24px 0;color:#6b7280;font-size:14px;">${d.totalNewJobs} new PM roles across ${d.trackedCompanies} companies. Copy + paste below into LinkedIn (bold the opener and the numbered headers in AuthoredUp).</p>

  <div style="background:#f3f4f6;border-left:4px solid #0EA5E9;padding:20px;border-radius:6px;margin-bottom:32px;">
    <pre style="margin:0;font-family:inherit;font-size:15px;line-height:1.6;color:#111827;white-space:pre-wrap;word-break:break-word;">${postHtml}</pre>
  </div>

  <h2 style="${SECTION_HEADER_STYLE}">Alternate leads (swap into "My take this week")</h2>
  ${renderAlternates(d)}

  <h2 style="${SECTION_HEADER_STYLE}">Banner image (Hot Take · ${d.fridayDate} · style: ${d.artStyle})</h2>
  ${imageAttached ? `<p style="font-size:13px;color:#111827;margin:0 0 8px 0;">A generated banner is attached to this email (download and post it). Or regenerate free in your own nano banana with the prompt below.</p>` : `<p style="font-size:13px;color:#6b7280;margin:0 0 8px 0;">No banner auto-generated this run. Paste the prompt below into nano banana.</p>`}
  ${d.imagePrompt ? `<pre style="white-space:pre-wrap;background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;color:#374151;margin:0;">${escapeHtml(d.imagePrompt)}</pre>` : ""}

  <h2 style="${SECTION_HEADER_STYLE}">Raw data for verification</h2>

  <h3 style="${SUBHEAD_STYLE}">By industry</h3>
  <table style="${TABLE_STYLE}">${renderIndustryTable(d)}</table>

  <h3 style="${SUBHEAD_STYLE}">Top ${d.topCompanies.length} companies by volume</h3>
  <table style="${TABLE_STYLE}">${renderTopCoTable(d)}</table>

  <h3 style="${SUBHEAD_STYLE}">AI PM roles by company (${d.aiRoles.count} total, ${d.aiShare.pct}% of new roles)</h3>
  <ul style="margin:0;padding-left:20px;font-size:14px;color:#374151;">${renderAiList(d)}</ul>

  <h2 style="${SECTION_HEADER_STYLE}">Appendix: data slices for editorial inspiration</h2>

  <h3 style="${SUBHEAD_STYLE}">Top cities by new role volume</h3>
  <table style="${TABLE_STYLE}">${renderLocationTable(d)}</table>
  <p style="font-size:13px;color:#6b7280;margin:8px 0 0 0;">Remote roles: <strong style="color:#111827;">${d.remoteShare.remote}</strong> (${d.remoteShare.pct}% of this week's new roles).</p>

  <h3 style="${SUBHEAD_STYLE}">Big-tech concentration</h3>
  <p style="font-size:13px;color:#374151;margin:0;">${d.bigTechShare.companies.length ? `${d.bigTechShare.companies.join(", ")} posted <strong style="color:#111827;">${d.bigTechShare.count}</strong> of ${d.totalNewJobs} new PM roles (${d.bigTechShare.pct}%).` : "No big-tech companies in this week's hiring set."}</p>

  <h3 style="${SUBHEAD_STYLE}">By seniority</h3>
  <table style="${TABLE_STYLE}">${renderSeniorityTable(d)}</table>

  <h3 style="${SUBHEAD_STYLE}">Top-paying companies hiring this week (median TC)</h3>
  <table style="${TABLE_STYLE}">${renderCompTable(d) || `<tr><td style="color:#9ca3af;font-style:italic;font-size:13px;">No comp data matched this week's hiring companies.</td></tr>`}</table>
  <p style="font-size:11px;color:#9ca3af;margin:6px 0 0 0;font-style:italic;">Median TC sourced from levels.fyi via comp_cache. Companies without coverage excluded.</p>

  <h3 style="${SUBHEAD_STYLE}">Surge: biggest jumps vs prior 4-week average</h3>
  <table style="${TABLE_STYLE}">${renderSurgeTable(d) || `<tr><td style="color:#9ca3af;font-style:italic;font-size:13px;">No surges met the threshold (>= ${SURGE_MIN_THIS_WEEK} this week).</td></tr>`}</table>
  <p style="font-size:11px;color:#9ca3af;margin:6px 0 0 0;font-style:italic;">Caution: surge ratios can be inflated by recent catalog additions. Do not post as a trend.</p>

  <h3 style="${SUBHEAD_STYLE}">Daily posting velocity</h3>
  <table style="${TABLE_STYLE}">${renderDailyVelocityTable(d)}</table>

  <p style="margin-top:36px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">NewPMJobs weekly digest. Sent every Friday at 14:00 UTC. ${costFooter(d, imageAttached)}</p>
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

  // Generate the banner image (best-effort; falls back to the text prompt in the
  // email when the Gemini API is unavailable / out of credits).
  const image = data.imagePrompt ? await generateDigestImage(data.imagePrompt) : null;

  const resend = new Resend(process.env.RESEND_API_KEY);
  // Leading 📬📬📬 (open mailbox with raised flag) so Vik can spot the weekly
  // digest at a glance in his inbox; Unicode-bold WEEKLY renders bold in Gmail's
  // subject column.
  const subject = `\u{1F4EC}\u{1F4EC}\u{1F4EC} \u{1D5EA}\u{1D5D8}\u{1D5D8}\u{1D5DE}\u{1D5DF}\u{1D5EC}: LinkedIn Job Summary for ${data.fridayDate}`;

  try {
    const { error: sendErr } = await resend.emails.send({
      from: "NewPMJobs <alerts@newpmjobs.com>",
      to: ADMIN_EMAIL,
      subject,
      html: renderEmailHtml(data, !!image),
      ...(image
        ? { attachments: [{ filename: `hot-take-${data.fridayDate.replace(/\s+/g, "-").toLowerCase()}.png`, content: image.base64 }] }
        : {}),
    });
    // Resend returns API errors (rotated/422 key, etc.) in `error` WITHOUT throwing,
    // so the catch alone would log "sent" on a silent failure + still write
    // weekly_lead_history. Treat an error-field the same as a throw.
    if (sendErr) {
      Sentry.captureException(new Error(`Weekly digest Resend error: ${sendErr.message || JSON.stringify(sendErr)}`));
      console.error("Weekly digest send returned an error:", sendErr);
      return { sent: false, reason: "send_failed", data };
    }
    console.log(`Weekly digest sent to ${ADMIN_EMAIL}: ${subject}`);
  } catch (err) {
    Sentry.captureException(err);
    console.error("Weekly digest send failed:", err);
    return { sent: false, reason: "send_failed", data };
  }

  // Record the lead angle + art style so next week's freshness rule rotates off
  // them. Best-effort: a logging failure must not fail an already-sent digest.
  if (data.suggestedLead) {
    try {
      await supabase.from("weekly_lead_history").insert({
        week_ending: now.toISOString().slice(0, 10),
        angle: data.suggestedLead.key,
        headline: data.suggestedLead.hook,
        art_style: data.artStyle,
      });
    } catch (err) {
      Sentry.captureException(err);
      console.error("weekly_lead_history insert failed (non-fatal):", err);
    }
  }

  return { sent: true, data };
}
