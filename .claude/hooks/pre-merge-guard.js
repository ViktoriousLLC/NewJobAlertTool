#!/usr/bin/env node
// Pre-merge ship-gate hook for Claude Code (DEV-60).
//
// The recurring failure: manual `gh pr merge` relies on the agent REMEMBERING the
// ship discipline (project-history entry, Linear ticket, docs), and it drops an
// item under load — a different one each time. This makes the core discipline
// MECHANICAL: a PreToolUse(Bash) hook that BLOCKS `gh pr merge <N>` unless the PR
// carries a project-history.md entry AND references a Linear DEV-N.
//
// Behavior:
//   - Non-Bash tools, or Bash commands that aren't `gh pr merge <N>`: exit 0 (allow), fast.
//   - `gh pr merge <N>`: verify via `gh` that the PR diff includes project-history.md
//     and that a DEV-N is referenced (body/title/branch/commits). Block (exit 2) if not.
//   - FAILS OPEN: any error, missing gh, or unparseable command → exit 0. Never locks bash.
//
// Hook input arrives as JSON on stdin: { tool_name, tool_input: { command }, ... }.
const fs = require("fs");
const { execSync } = require("child_process");

function readJson() {
  try { const r = fs.readFileSync(0, "utf8"); return r ? JSON.parse(r) : null; } catch { return null; }
}
function sh(cmd) {
  try { return execSync(cmd, { encoding: "utf8", timeout: 25000, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
}

const input = readJson();
const cmd = input && input.tool_input && input.tool_input.command;
if (!input || input.tool_name !== "Bash" || typeof cmd !== "string") process.exit(0);
if (!/gh\s+pr\s+merge/.test(cmd)) process.exit(0); // only gate PR merges

const m = cmd.match(/gh\s+pr\s+merge\s+(\d+)/);
if (!m) process.exit(0); // no PR number to verify → fail open
const pr = m[1];

// 1. project-history.md must be in the PR diff (the savecc-on-ship entry).
const files = sh(`gh pr diff ${pr} --name-only`);
if (files === null) process.exit(0); // gh unavailable → fail open, never block on tooling

const failures = [];
if (!/(^|\/)project-history\.md\s*$/m.test(files)) {
  failures.push(`- PR #${pr} has NO project-history.md entry. Add a dated entry (savecc-on-ship) before merging.`);
}
// 2. A Linear DEV-N must be referenced (body/title/branch/commit messages).
const meta = sh(`gh pr view ${pr} --json title,body,headRefName,commits`) || "";
if (!/DEV-\d+/i.test(meta)) {
  failures.push(`- PR #${pr} references NO Linear ticket (DEV-N) in its title/body/branch/commits. Create or reference one.`);
}

if (failures.length) {
  process.stderr.write(
    `Ship-gate (pre-merge) BLOCKED merge of PR #${pr} — missing required discipline:\n` +
    failures.join("\n") + "\n" +
    `Also confirm before merging: a product-development-journey.md phase if this is a user-facing capability shift, ` +
    `and CLAUDE.md / sidecar currency if it touched an endpoint, table, env var, or convention.\n` +
    `Fix the above on the branch, then re-run the merge.\n`
  );
  process.exit(2);
}
process.exit(0);
