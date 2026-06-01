#!/usr/bin/env node
// DEV-64: Clone the prod CATALOG (companies, seen_jobs, comp_cache) into the staging
// Supabase project. Catalog tables ONLY — never user/PII tables (auth.users,
// user_subscriptions, user_preferences, user_job_favorites, etc. stay synthetic in
// staging). DB-to-DB via supabase-js service-role clients, so NO row data passes
// through any terminal / log / chat. Idempotent (upsert on id) — safe to re-run on
// demand or on a schedule.
//
// Creds come from env, NEVER the command line or chat:
//   SEED_SOURCE_URL  = prod    Supabase URL   (https://<prod-ref>.supabase.co)
//   SEED_SOURCE_KEY  = prod    service_role key
//   SEED_TARGET_URL  = staging Supabase URL   (https://<staging-ref>.supabase.co)
//   SEED_TARGET_KEY  = staging service_role key
//   SEED_WIPE=1      = (optional) TRUNCATE-then-reload for a pristine copy
//
//   node tools/seed-staging.mjs
// On Railway (so nothing is typed in the shell — set SEED_* as staging-env vars):
//   railway run --environment staging node tools/seed-staging.mjs
//
// SAFETY: refuses to run unless TARGET is the known staging project ref AND differs
// from SOURCE — this clone can NEVER write to prod.

import { createClient } from "@supabase/supabase-js";

const SOURCE_URL = process.env.SEED_SOURCE_URL;
const SOURCE_KEY = process.env.SEED_SOURCE_KEY;
const TARGET_URL = process.env.SEED_TARGET_URL;
const TARGET_KEY = process.env.SEED_TARGET_KEY;

// The only project this script is ever allowed to write to.
const STAGING_REF = process.env.SEED_TARGET_REF || "pcrurbrppundzfbcjxrg";
const PROD_REF = "lrmxjqijaenyzdjjzmmo";

// Catalog tables only, in FK-safe insert order (companies before seen_jobs).
const TABLES = ["companies", "seen_jobs", "comp_cache"];
const READ_PAGE = 1000; // PostgREST hard caps a single select at 1000 rows.
const WRITE_BATCH = 500;
const WIPE = process.env.SEED_WIPE === "1";

function die(msg) {
  console.error(`\n[seed-staging] ABORT: ${msg}\n`);
  process.exit(1);
}

if (!SOURCE_URL || !SOURCE_KEY || !TARGET_URL || !TARGET_KEY) {
  die("Set SEED_SOURCE_URL, SEED_SOURCE_KEY, SEED_TARGET_URL, SEED_TARGET_KEY (service-role keys).");
}
if (!TARGET_URL.includes(STAGING_REF)) {
  die(`TARGET (${TARGET_URL}) is not the staging project (${STAGING_REF}). Refusing to write.`);
}
if (TARGET_URL.includes(PROD_REF)) {
  die("TARGET points at the PROD project. Refusing — this script only ever writes to staging.");
}
if (SOURCE_URL === TARGET_URL) {
  die("SOURCE and TARGET are the same project.");
}

const source = createClient(SOURCE_URL, SOURCE_KEY, { auth: { persistSession: false } });
const target = createClient(TARGET_URL, TARGET_KEY, { auth: { persistSession: false } });

async function readAll(table) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await source
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (error) die(`read ${table}: ${error.message}`);
    rows.push(...data);
    if (!data || data.length < READ_PAGE) break;
    from += READ_PAGE;
  }
  return rows;
}

async function wipe(table) {
  // Service role bypasses RLS. Reverse-FK order handled by the caller.
  const { error } = await target.from(table).delete().not("id", "is", null);
  if (error) die(`wipe ${table}: ${error.message}`);
}

async function upsertAll(table, rows) {
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = rows.slice(i, i + WRITE_BATCH);
    const { error } = await target.from(table).upsert(batch, { onConflict: "id" });
    if (error) die(`upsert ${table} [${i}..${i + batch.length}]: ${error.message}`);
    process.stdout.write(`  ${table}: ${Math.min(i + WRITE_BATCH, rows.length)}/${rows.length}\r`);
  }
}

(async () => {
  console.log(`[seed-staging] SOURCE ${SOURCE_URL}`);
  console.log(`[seed-staging] TARGET ${TARGET_URL}\n`);

  if (WIPE) {
    console.log("[seed-staging] WIPE=1 — clearing target catalog tables first (reverse FK order)…");
    for (const t of [...TABLES].reverse()) await wipe(t);
  }

  for (const table of TABLES) {
    const rows = await readAll(table);
    console.log(`[seed-staging] ${table}: read ${rows.length} rows from source`);
    if (rows.length) await upsertAll(table, rows);
    const { count } = await target.from(table).select("*", { count: "exact", head: true });
    console.log(`\n[seed-staging] ${table}: target now has ${count} rows`);
  }

  console.log("\n[seed-staging] done — staging catalog is in sync with prod.");
  process.exit(0);
})();
