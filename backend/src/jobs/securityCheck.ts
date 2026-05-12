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
}

/**
 * Run npm audit against the backend's package-lock.json and return parsed findings.
 * Used by the Monday admin digest to surface new CVEs week-over-week.
 *
 * Returns null if npm audit fails for any reason (no npm binary, no package-lock,
 * malformed JSON). Failure should not break the cron — we just skip the section.
 */
export async function runSecurityCheck(): Promise<SecurityFindings | null> {
  let auditJson: AuditOutput | null = null;
  try {
    // cwd resolves up from src/jobs to backend/ where package.json lives in dev.
    // In production (Railway), the built file lives in dist/jobs and backend/ is
    // the working directory anyway — both paths land on the same package.json.
    const cwd = path.resolve(__dirname, "..", "..");
    const { stdout } = await execAsync("npm audit --json --omit=dev", {
      cwd,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    auditJson = JSON.parse(stdout) as AuditOutput;
  } catch (err) {
    // `npm audit` exits non-zero when vulns are found — that's normal, the
    // stdout still contains valid JSON. Try to recover from the error's stdout.
    const errObj = err as { stdout?: string; message?: string };
    if (errObj.stdout) {
      try {
        auditJson = JSON.parse(errObj.stdout) as AuditOutput;
      } catch {
        // fall through to null
      }
    }
    if (!auditJson) {
      console.error("Security check: npm audit failed:", errObj.message || err);
      Sentry.captureException(err, { tags: { phase: "security-check" } });
      return null;
    }
  }

  const current = parseAuditOutput(auditJson);
  const fingerprints = current.map((v) => v.fingerprint);

  // Fetch the most recent previous snapshot for diff
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
