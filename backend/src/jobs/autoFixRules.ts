// Proactive auto-fix layer for the daily cron.
//
// Runs BEFORE each per-company scrape. Each rule checks the company's stored
// state (platform_type, platform_config, careers_url) and applies a fix
// when a known-bad pattern is detected. After a fix is applied, the cron
// re-fetches the company row and scrapes with the corrected config so the
// fix takes effect on the SAME run, not the next day.
//
// Adding a new rule:
//   1. Append an entry to `RULES` below.
//   2. `detect()` should be a pure function of `company` state — no network calls.
//      Reactive (error-based) rules belong in a separate `autoFixReactiveRules`
//      module not yet built (deferred to a follow-up; proactive covers most
//      cases where the failure is a config-state issue).
//   3. `fix()` mutates the DB. It runs inside the cron loop, so it should be
//      cheap. Return `ok: true` only after a successful UPDATE. Errors are
//      caught at the call site and treated as a no-op.
//
// Audit log: every successful fix writes to `scraper_events` with
// event_type=`auto_fix_applied` so the weekly digest's self-heal log
// surfaces it alongside stealth recoveries and platform remediations.
//
// The "🤖 Auto-fixed today" section in the daily admin digest lists the rule
// id + human description + before/after diff so the admin can see what the
// system fixed without being told.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AutoFixCandidate {
  id: string;
  name: string;
  careers_url: string;
  platform_type: string | null;
  platform_config: Record<string, string> | null;
  consecutive_failure_count: number | null;
  last_check_status: string | null;
}

export interface AutoFixResult {
  ok: boolean;
  ruleId: string;
  description: string;
  message: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface AutoFixRule {
  id: string;
  description: string;
  detect(company: AutoFixCandidate): boolean;
  fix(company: AutoFixCandidate, supabase: SupabaseClient): Promise<AutoFixResult>;
}

// ---------- Rule catalog ----------
//
// Each rule below corresponds to a real incident. Comment each new entry with
// the date + symptom that drove it.

export const RULES: AutoFixRule[] = [
  {
    // Eli Lilly, 2026-05-26 — 5 days of failure streak. The Phenom scraper
    // throws when `platform_config.baseDomain` doesn't start with `https://`,
    // bypassing all self-healing tiers. Fix: prepend the scheme in-place.
    id: "phenom_basedomain_missing_https",
    description: "Phenom baseDomain config missing https:// prefix — prepend it.",
    detect(company) {
      if (company.platform_type !== "phenom") return false;
      const baseDomain = company.platform_config?.baseDomain;
      if (typeof baseDomain !== "string" || !baseDomain) return false;
      return !baseDomain.startsWith("http://") && !baseDomain.startsWith("https://");
    },
    async fix(company, supabase) {
      const before = company.platform_config?.baseDomain ?? "";
      const after = `https://${before}`;
      const newConfig = { ...(company.platform_config || {}), baseDomain: after };

      const { error } = await supabase
        .from("companies")
        .update({
          platform_config: newConfig,
          consecutive_failure_count: 0,
          auto_disabled: false,
          last_check_status: "pending recheck after auto-fix",
        })
        .eq("id", company.id);

      if (error) {
        return {
          ok: false,
          ruleId: "phenom_basedomain_missing_https",
          description: "Phenom baseDomain missing https://",
          message: `DB update failed: ${error.message}`,
        };
      }

      return {
        ok: true,
        ruleId: "phenom_basedomain_missing_https",
        description: "Phenom baseDomain missing https://",
        message: `Prepended https:// to baseDomain (${before} → ${after})`,
        before: { baseDomain: before },
        after: { baseDomain: after },
      };
    },
  },
];

/**
 * Run the rule catalog against one company. Returns the first matching rule's
 * fix result, or null if no rule matched. Stops at first match — rules
 * intentionally don't compose. If two rules could both apply, refactor one of
 * them or order them so the more specific one wins.
 */
export async function tryProactiveAutoFix(
  company: AutoFixCandidate,
  supabase: SupabaseClient,
): Promise<AutoFixResult | null> {
  for (const rule of RULES) {
    let matches = false;
    try {
      matches = rule.detect(company);
    } catch (err) {
      console.warn(`[autoFix] rule ${rule.id} detect() threw for ${company.name}:`, err);
      continue;
    }
    if (!matches) continue;

    try {
      const result = await rule.fix(company, supabase);
      if (result.ok) {
        console.log(`[autoFix] ${company.name}: rule ${rule.id} applied — ${result.message}`);
      } else {
        console.warn(`[autoFix] ${company.name}: rule ${rule.id} failed — ${result.message}`);
      }
      return result;
    } catch (err) {
      console.error(`[autoFix] rule ${rule.id} fix() threw for ${company.name}:`, err);
      return {
        ok: false,
        ruleId: rule.id,
        description: rule.description,
        message: `Exception during fix: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  }
  return null;
}
