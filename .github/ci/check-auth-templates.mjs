// CI: assert deployed Supabase Auth email templates use the URL format
// documented in backend/src/middleware/AUTH.md. Fails the build if either
// template (Magic Link, Confirm Signup) misses the required token_hash
// pattern OR still uses the broken {{ .ConfirmationURL }} default.
//
// Why this exists: between 2026-05-22 and 2026-05-25, deployed templates
// used `{{ .ConfirmationURL }}` (Supabase's default) which generates links
// pointing at Supabase's hosted /auth/v1/verify endpoint, bypassing our
// /auth/confirm route. 18 users were locked out. AUTH.md documents the
// correct format. This check enforces it mechanically.
//
// Required env:
//   - SUPABASE_PAT: Personal Access Token with Auth read scope
//   - SUPABASE_PROJECT_ID: e.g. lrmxjqijaenyzdjjzmmo
//
// Exit codes:
//   0 — all assertions passed
//   1 — env missing OR Supabase API error OR template assertion failed

const PAT = process.env.SUPABASE_PAT;
const PROJECT_ID = process.env.SUPABASE_PROJECT_ID;

if (!PAT || !PROJECT_ID) {
  console.error("✖ Missing required env: SUPABASE_PAT and/or SUPABASE_PROJECT_ID");
  console.error("  Set SUPABASE_PAT_CI as a GitHub repo secret. Generate at:");
  console.error("  https://supabase.com/dashboard/account/tokens");
  process.exit(1);
}

const url = `https://api.supabase.com/v1/projects/${PROJECT_ID}/config/auth`;
console.log(`→ GET ${url}`);

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${PAT}` },
});

if (!res.ok) {
  const body = await res.text().catch(() => "(no body)");
  console.error(`✖ Supabase Management API returned HTTP ${res.status}`);
  console.error(`  Body: ${body.slice(0, 500)}`);
  process.exit(1);
}

const config = await res.json();

const checks = [
  {
    name: "Magic Link template",
    template: config.mailer_templates_magic_link_content || "",
    required: [
      "token_hash={{ .TokenHash }}",
      "type=magiclink",
    ],
    forbidden: [
      "{{ .ConfirmationURL }}",
    ],
  },
  {
    name: "Confirm Signup template",
    template: config.mailer_templates_confirmation_content || "",
    required: [
      "token_hash={{ .TokenHash }}",
      "type=signup",
    ],
    forbidden: [
      "{{ .ConfirmationURL }}",
    ],
  },
];

let failed = false;
for (const c of checks) {
  console.log(`\n→ Checking: ${c.name} (${c.template.length} chars)`);
  for (const r of c.required) {
    if (c.template.includes(r)) {
      console.log(`  ✓ contains required: ${r}`);
    } else {
      console.error(`  ✖ MISSING REQUIRED: ${r}`);
      failed = true;
    }
  }
  for (const f of c.forbidden) {
    if (c.template.includes(f)) {
      console.error(`  ✖ CONTAINS FORBIDDEN: ${f}`);
      failed = true;
    } else {
      console.log(`  ✓ does not contain: ${f}`);
    }
  }
}

if (failed) {
  console.error("\n✖ AUTH TEMPLATE CHECK FAILED");
  console.error("");
  console.error("  The deployed Supabase Auth templates do not match the format");
  console.error("  documented in backend/src/middleware/AUTH.md. Expected URL pattern:");
  console.error("");
  console.error("    {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink");
  console.error("    {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup");
  console.error("");
  console.error("  To fix: re-run backend/src/scripts/update-auth-templates.mjs with");
  console.error("  a fresh Supabase PAT, OR edit the templates in Supabase Dashboard");
  console.error("  → Authentication → Email Templates to match the pattern above.");
  console.error("");
  console.error("  See incident postmortem 2026-05-22 to 2026-05-25 for context.");
  process.exit(1);
}

console.log("\n✓ All auth template assertions passed.");
console.log(`  Magic Link: ${checks[0].template.length} chars`);
console.log(`  Confirm Signup: ${checks[1].template.length} chars`);
