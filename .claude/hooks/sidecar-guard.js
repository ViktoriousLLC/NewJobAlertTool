#!/usr/bin/env node
// Sidecar enforcement hook for Claude Code.
//
// Each entry in `GUARDED` maps a guarded folder to its required sidecar `.md`.
// Behavior:
//   - PreToolUse(Edit|Write|MultiEdit) on a file in a guarded folder:
//       allow if the sidecar has been "primed" (Read) earlier in this session;
//       otherwise block with exit code 2 and a stderr message.
//   - PreToolUse(Read) on a guarded sidecar: prime the corresponding folder.
//
// State file: .claude/.sidecar-state.json (gitignored). Keyed by session id
// (CLAUDE_SESSION_ID env var) or, as fallback, by date so the marker auto-
// expires after a day.
//
// Hook input arrives as JSON on stdin: { tool_name, tool_input, ... }.
// We never throw — any internal error degrades to "allow" so we don't lock
// the user out of their own repo.

const fs = require("fs");
const path = require("path");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE_FILE = path.join(PROJECT_DIR, ".claude", ".sidecar-state.json");

// Forward-slash paths so the comparison works on Windows + POSIX.
const GUARDED = [
  { folder: "backend/src/scraper/",      sidecar: "backend/src/scraper/SCRAPER.md" },
  { folder: "backend/src/middleware/",   sidecar: "backend/src/middleware/AUTH.md" },
  { folder: "backend/src/routes/",       sidecar: "backend/src/routes/ROUTES.md" },
  { folder: "backend/src/jobs/",         sidecar: "backend/src/jobs/JOBS.md" },
  { folder: "frontend/src/components/",  sidecar: "frontend/src/components/COMPONENTS.md" },
];

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function readJsonFromStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sessionKey() {
  const id = process.env.CLAUDE_SESSION_ID;
  if (id) return `session:${id}`;
  // Fallback: per-day marker. Better than "always allow" if no session id.
  return `day:${new Date().toISOString().slice(0, 10)}`;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    // best-effort
  }
}

function normalizePath(p) {
  if (!p) return "";
  // Strip the project dir prefix if present, then normalize separators.
  let rel = p;
  if (path.isAbsolute(p)) {
    rel = path.relative(PROJECT_DIR, p);
  }
  return rel.split(path.sep).join("/");
}

function findGuardForFile(filePath) {
  const rel = normalizePath(filePath);
  return GUARDED.find((g) => rel.startsWith(g.folder));
}

function findSidecarMatch(filePath) {
  const rel = normalizePath(filePath);
  return GUARDED.find((g) => g.sidecar === rel);
}

function main() {
  const input = readJsonFromStdin();
  if (!input || !input.tool_name) {
    process.exit(0);
  }

  const tool = input.tool_name;
  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath) {
    process.exit(0);
  }

  const key = sessionKey();
  const state = loadState();
  state[key] = state[key] || {};

  // Reading a sidecar primes its folder.
  if (tool === "Read") {
    const sidecarHit = findSidecarMatch(filePath);
    if (sidecarHit) {
      state[key][sidecarHit.folder] = true;
      saveState(state);
    }
    process.exit(0);
  }

  // Editing inside a guarded folder requires the sidecar to be primed.
  if (EDIT_TOOLS.has(tool)) {
    const guard = findGuardForFile(filePath);
    if (!guard) {
      process.exit(0);
    }
    // Editing the sidecar itself is always allowed (otherwise you can't update it).
    if (findSidecarMatch(filePath)) {
      state[key][guard.folder] = true;
      saveState(state);
      process.exit(0);
    }
    if (state[key][guard.folder]) {
      process.exit(0);
    }
    process.stderr.write(
      `Sidecar guard: about to ${tool} ${normalizePath(filePath)} but the ` +
        `sidecar at ${guard.sidecar} has not been read this session. ` +
        `Read it first (Read tool, file_path=${guard.sidecar}), then retry.\n`
    );
    process.exit(2);
  }

  process.exit(0);
}

main();
