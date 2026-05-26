// DEV-11 v1: daily heuristic audit of recent code changes.
// Scans the last 24h of commits for known risk patterns and emails admin
// if anything trips. Silent success days are the norm.
//
// Risk patterns checked (each one was derived from a real bug we shipped):
//   1. `{{ .ConfirmationURL }}` in code — auth template anti-pattern
//      (caused the 2026-05-22 template regression; 18 users locked out)
//   2. `NextResponse.redirect(` in a file that also touches verifyOtp /
//      exchangeCodeForSession without a cookieStore.getAll() before the
//      redirect — DEV-3 cookie-drop bug (silently broke sessions for
//      11+ users since 2026-05-20)
//   3. JWT-shaped strings in committed source (eyJ.eyJ.) — accidental
//      service-role key leak
//   4. New backend route handlers under backend/src/routes/ that lack
//      `requireAuth` / `requireAdmin` in the same file — auth-bypass risk
//
// Required env (GitHub Actions step `env` block injects these):
//   RESEND_API_KEY       — for sending the admin email on findings
//   ADMIN_EMAIL          — recipient
//   GITHUB_RUN_URL       — link back to the workflow run (optional, for the email)
//
// Exit codes:
//   0 — no findings (good)
//   1 — findings present (workflow fails; email sent)

import { execSync } from "node:child_process";
import { Resend } from "resend";

const SINCE = "1 day ago";

function getRecentDiff() {
  // Combined unified diff of every commit in the last 24h.
  // -U0 keeps the diff lean. We don't follow renames — the line context
  // already tells us where.
  try {
    return execSync(`git log --since="${SINCE}" -p -U0 --no-merges`, {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err) {
    console.error("git log failed:", err.message);
    return "";
  }
}

function getRecentCommits() {
  try {
    return execSync(`git log --since="${SINCE}" --pretty=format:"%h %s" --no-merges`, {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

// Parse a unified diff into per-file added-line buckets.
// Returns { [filename]: ["+ line text", ...] }
function parseAddedLines(diff) {
  const byFile = {};
  let current = null;
  for (const line of diff.split("\n")) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m) {
      current = m[1];
      if (!byFile[current]) byFile[current] = [];
      continue;
    }
    if (line.match(/^---/) || line.match(/^@@/)) continue;
    if (current && line.startsWith("+") && !line.startsWith("+++")) {
      byFile[current].push(line.slice(1));
    }
  }
  return byFile;
}

// ----- Checks -----

const findings = [];

function flag(severity, ruleId, file, line, snippet, remediation) {
  findings.push({ severity, ruleId, file, line, snippet, remediation });
}

const diff = getRecentDiff();
const commits = getRecentCommits();
const byFile = parseAddedLines(diff);

if (Object.keys(byFile).length === 0) {
  console.log("✓ No code changes in the last 24h. Nothing to audit.");
  process.exit(0);
}

console.log(`→ Auditing ${Object.keys(byFile).length} changed files across these commits:\n${commits}\n`);

// Files that are EXPECTED to reference the bad pattern (documentation,
// CI checks that look for it). Don't false-positive on these.
function isMetaFile(file) {
  return (
    file.startsWith(".github/ci/") ||
    file.startsWith(".github/workflows/") ||
    file.endsWith(".md") ||
    file.includes("CLAUDE.md")
  );
}

// Strip whitespace then check if line looks like a JS/TS comment.
function isCommentLine(text) {
  const t = text.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

// 1. Auth template anti-pattern
for (const [file, lines] of Object.entries(byFile)) {
  // Only flag in files that look auth-related (don't fire on JSDoc/comments
  // mentioning the variable for documentation purposes).
  if (!/(auth|template|mailer)/i.test(file)) continue;
  if (isMetaFile(file)) continue;
  lines.forEach((text, idx) => {
    if (isCommentLine(text)) return;
    if (text.includes("{{ .ConfirmationURL }}")) {
      flag(
        "HIGH",
        "auth-confirmation-url",
        file,
        idx,
        text.trim().slice(0, 200),
        "Use {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=... per AUTH.md. See incident 2026-05-22."
      );
    }
  });
}

// 2. Cookie-drop pattern in route handlers
for (const [file, lines] of Object.entries(byFile)) {
  if (!file.includes("/auth/") && !file.includes("middleware")) continue;
  const text = lines.join("\n");
  const touchesAuth = /\b(verifyOtp|exchangeCodeForSession|signInWithOtp)\b/.test(text);
  const hasRedirect = /NextResponse\.redirect\s*\(/.test(text);
  const hasCookieCopy = /cookieStore\.getAll\(\)/.test(text);
  if (touchesAuth && hasRedirect && !hasCookieCopy) {
    flag(
      "HIGH",
      "auth-cookie-drop",
      file,
      0,
      "NextResponse.redirect() near auth API without cookieStore.getAll() copy",
      "Copy cookies onto the redirect: `cookieStore.getAll().forEach(c => response.cookies.set(c))`. See DEV-3 / AUTH.md gotchas."
    );
  }
}

// 3. Hardcoded JWT-shaped strings (service role key leak indicator)
const JWT_RE = /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
for (const [file, lines] of Object.entries(byFile)) {
  // Skip .env example files which are placeholders
  if (file.endsWith(".env") || file.endsWith(".env.local") || file.endsWith(".env.example")) continue;
  if (isMetaFile(file)) continue;
  lines.forEach((text, idx) => {
    if (JWT_RE.test(text)) {
      flag(
        "CRITICAL",
        "jwt-in-source",
        file,
        idx,
        text.trim().slice(0, 80) + "…",
        "JWT-shaped string committed to source. Revoke the key in Supabase Dashboard, rotate via Railway env vars."
      );
    }
  });
}

// 4. New backend route without auth gate
for (const [file, lines] of Object.entries(byFile)) {
  if (!file.startsWith("backend/src/routes/")) continue;
  if (file.endsWith(".md")) continue;
  // Heuristic: if the diff added a router.<method>( call AND the FULL file
  // (we re-read it) doesn't reference requireAuth/requireAdmin, flag it.
  const addedRoutes = lines.filter((l) =>
    /\brouter\.(get|post|put|delete|patch)\s*\(/.test(l)
  );
  if (addedRoutes.length === 0) continue;
  let fullFile = "";
  try {
    fullFile = execSync(`git show HEAD:${file}`, { encoding: "utf8" });
  } catch {
    continue;
  }
  if (!/requireAuth|requireAdmin/.test(fullFile)) {
    flag(
      "HIGH",
      "route-without-auth",
      file,
      0,
      addedRoutes[0].trim(),
      "New route in backend/src/routes/ lacks requireAuth or requireAdmin. See ROUTES.md Data Isolation pattern."
    );
  }
}

// ----- Report -----

if (findings.length === 0) {
  console.log("✓ Audit clean. No risk patterns found in the last 24h of changes.");
  process.exit(0);
}

console.log(`✖ ${findings.length} finding${findings.length === 1 ? "" : "s"}:\n`);
for (const f of findings) {
  console.log(`  [${f.severity}] ${f.ruleId} — ${f.file}:${f.line}`);
  console.log(`    ${f.snippet}`);
  console.log(`    Fix: ${f.remediation}\n`);
}

// Send admin email
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "vikrant.agar@gmail.com";
const RUN_URL = process.env.GITHUB_RUN_URL || "(no link provided)";

if (RESEND_API_KEY) {
  const resend = new Resend(RESEND_API_KEY);
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;max-width:640px;margin:0 auto;padding:24px;background:#ffffff;">
      <p style="margin:0 0 6px 0;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">NewPMJobs · Daily Audit</p>
      <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#111827;">${findings.length} finding${findings.length === 1 ? "" : "s"} in the last 24h of commits</h1>
      <p style="margin:0 0 20px 0;font-size:14px;color:#6b7280;">Commits scanned:</p>
      <pre style="background:#f9fafb;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto;">${commits.replace(/[<>&]/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}</pre>
      <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin:24px 0 12px 0;">Findings</h2>
      ${findings.map((f) => `
        <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:14px 18px;border-radius:6px;margin-bottom:12px;">
          <p style="margin:0 0 4px 0;font-size:13px;font-weight:600;color:#991b1b;">${f.severity} — ${f.ruleId}</p>
          <p style="margin:0 0 6px 0;font-size:13px;color:#111827;"><code style="font-family:ui-monospace,monospace;font-size:12px;background:#fee2e2;padding:2px 6px;border-radius:3px;">${f.file}${f.line ? ":" + f.line : ""}</code></p>
          <p style="margin:0 0 6px 0;font-size:12px;color:#4b5563;font-family:ui-monospace,monospace;">${f.snippet.replace(/[<>&]/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}</p>
          <p style="margin:6px 0 0 0;font-size:13px;color:#111827;"><strong>Fix:</strong> ${f.remediation}</p>
        </div>
      `).join("")}
      <p style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">
        Workflow run: <a href="${RUN_URL}" style="color:#0EA5E9;">${RUN_URL}</a><br/>
        Audit script: .github/ci/daily-code-audit.mjs · See DEV-11 in Linear for the rule list.
      </p>
    </div>
  `;
  try {
    await resend.emails.send({
      from: "NewPMJobs <alerts@newpmjobs.com>",
      to: ADMIN_EMAIL,
      subject: `[NewPMJobs Audit] ${findings.length} risk pattern${findings.length === 1 ? "" : "s"} flagged in last 24h`,
      html,
    });
    console.log(`✉ Admin email sent to ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error("Resend send failed:", err.message);
  }
} else {
  console.warn("RESEND_API_KEY not set — skipping admin email (findings still logged above)");
}

process.exit(1);
