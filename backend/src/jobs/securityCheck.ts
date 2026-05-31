import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as Sentry from "@sentry/node";
import { supabase } from "../lib/supabase";

const execAsync = promisify(exec);

export interface VulnFinding {
  package: string;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  fixAvailable: boolean;
  via: string;
  fingerprint: string;
}

/** Lightweight per-surface audit summary. The backend surface (below) also gets
 * the full week-over-week diff; the frontend surface is summary-only for now so
 * a frontend dependency regression is at least *visible* in the Monday digest
 * (it auto-deploys from main like the backend, but only the backend runs the
 * cron, so historically the frontend audit only happened at Vercel build time). */
export interface SurfaceVulnSummary {
  totalVulns: number;
  bySeverity: { info: number; low: number; moderate: number; high: number; critical: number };
  /** Null when the audit couldn't run for this surface (no lockfile, npm error). */
  ok: boolean;
}

export interface SecurityFindings {
  totalVulns: number;
  bySeverity: { info: number; low: number; moderate: number; high: number; critical: number };
  current: VulnFinding[];
  /** Fingerprints that appeared since last week's snapshot. */
  newSinceLastWeek: VulnFinding[];
  /** Fingerprints from last week that aren't in current. */
  resolvedSinceLastWeek: VulnFinding[];
  /** True if this is the first snapshot ever (no previous week to compare). */
  isFirstSnapshot: boolean;
  /** Frontend (Next.js) production-dependency audit summary. Null if it couldn't
   * run (e.g. frontend/ not present alongside the backend deploy). Backend totals
   * are the top-level fields above; this surfaces frontend regressions too. */
  frontend: SurfaceVulnSummary | null;
}

/**
 * Run `npm audit --json --omit=dev` in `cwd` and return the parsed JSON, or null
 * if it couldn't run / parse. `npm audit` exits non-zero when vulns are found —
 * that's normal and the stdout still holds valid JSON, so we recover from the
 * thrown error's stdout before giving up.
 */
async function runNpmAudit(cwd: string, surface: string): Promise<AuditOutput | null> {
  try {
    const { stdout } = await execAsync("npm audit --json --omit=dev", {
      cwd,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout) as AuditOutput;
  } catch (err) {
    const errObj = err as { stdout?: string; message?: string };
    if (errObj.stdout) {
      try {
        return JSON.parse(errObj.stdout) as AuditOutput;
      } catch {
        // fall through to null
      }
    }
    console.error(`Security check (${surface}): npm audit failed:`, errObj.message || err);
    Sentry.captureException(err, { tags: { phase: "security-check", surface } });
    return null;
  }
}

/**
 * Run npm audit against both the backend and frontend production dependencies.
 * Used by the Monday admin digest to surface new CVEs week-over-week (backend gets
 * the full diff; frontend is a count summary so regressions there are visible too).
 *
 * Returns null only if the BACKEND audit fails (no npm binary, no package-lock,
 * malformed JSON) — that's the deploy surface running this cron. A frontend audit
 * failure degrades to `frontend: { ok: false }` and never breaks the section.
 */
export async function runSecurityCheck(): Promise<SecurityFindings | null> {
  // cwd resolves up from src/jobs to backend/ where package.json lives in dev.
  // In production (Railway), the built file lives in dist/jobs and backend/ is
  // the working directory anyway — both paths land on the same package.json.
  const backendCwd = path.resolve(__dirname, "..", "..");
  // Frontend lives as a sibling of backend/ in the repo. On Railway the deploy
  // root is the repo, so ../frontend exists; if it doesn't (or has no lockfile),
  // runNpmAudit returns null and the frontend summary degrades to ok:false
  // rather than breaking the whole security section.
  const frontendCwd = path.resolve(backendCwd, "..", "frontend");

  const [auditJson, frontendAuditJson] = await Promise.all([
    runNpmAudit(backendCwd, "backend"),
    runNpmAudit(frontendCwd, "frontend"),
  ]);

  if (!auditJson) {
    return null;
  }

  const frontend: SurfaceVulnSummary | null = frontendAuditJson
    ? (() => {
        const fe = parseAuditOutput(frontendAuditJson);
        return { totalVulns: fe.length, bySeverity: countBySeverity(fe), ok: true };
      })()
    : { totalVulns: 0, bySeverity: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }, ok: false };

  const current = parseAuditOutput(auditJson);
  const fingerprints = current.map((v) => v.fingerprint);

  // Diff against the most recent prior snapshot. The Tuesday-digest duplicate
  // was dropped 2026-05-18 so "latest" is always the previous Monday and the
  // week-over-week math just works.
  const { data: prev } = await supabase
    .from("security_snapshots")
    .select("vuln_fingerprints, snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevFingerprints: string[] = (prev?.vuln_fingerprints as string[] | undefined) || [];
  const prevSet = new Set(prevFingerprints);
  const currentSet = new Set(fingerprints);

  const newSinceLastWeek = current.filter((v) => !prevSet.has(v.fingerprint));
  // Synthesize VulnFinding stubs for resolved items — we only kept fingerprints,
  // so reconstruct what we can from the fingerprint format.
  const resolvedSinceLastWeek = prevFingerprints
    .filter((fp) => !currentSet.has(fp))
    .map((fp) => parseFingerprint(fp));

  // Persist this run's snapshot so next Monday can diff against it
  await supabase.from("security_snapshots").insert({
    total_vulns: current.length,
    by_severity: countBySeverity(current),
    vuln_fingerprints: fingerprints,
  });

  return {
    totalVulns: current.length,
    bySeverity: countBySeverity(current),
    current,
    newSinceLastWeek,
    resolvedSinceLastWeek,
    isFirstSnapshot: !prev,
    frontend,
  };
}

// --- Internals ---

interface AuditOutput {
  vulnerabilities?: Record<string, AuditVuln>;
  metadata?: {
    vulnerabilities?: { info?: number; low?: number; moderate?: number; high?: number; critical?: number; total?: number };
  };
}

interface AuditVuln {
  name: string;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  via: Array<string | { source?: number; name?: string; url?: string; title?: string }>;
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean };
}

function parseAuditOutput(audit: AuditOutput): VulnFinding[] {
  const out: VulnFinding[] = [];
  const vulns = audit.vulnerabilities || {};
  for (const [pkg, v] of Object.entries(vulns)) {
    const via = describeVia(v.via);
    const fixAvailable = Boolean(v.fixAvailable);
    out.push({
      package: pkg,
      severity: v.severity,
      fixAvailable,
      via,
      fingerprint: `${pkg}|${v.severity}|${fixAvailable ? "fix" : "nofix"}`,
    });
  }
  // Sort: critical > high > moderate > low > info
  const rank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 } as const;
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out;
}

function describeVia(via: AuditVuln["via"]): string {
  if (!via || via.length === 0) return "unknown";
  const first = via[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object") {
    return first.title || first.url || first.name || "unknown";
  }
  return "unknown";
}

function countBySeverity(vulns: VulnFinding[]) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const v of vulns) counts[v.severity]++;
  return counts;
}

function parseFingerprint(fp: string): VulnFinding {
  const [pkg, severity, fix] = fp.split("|");
  return {
    package: pkg || "unknown",
    severity: (severity as VulnFinding["severity"]) || "low",
    fixAvailable: fix === "fix",
    via: "(from last week's snapshot)",
    fingerprint: fp,
  };
}
