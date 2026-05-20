import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Fetch ALL users via supabase.auth.admin.listUsers — with proper
 * cursor pagination, not the silent perPage=50 default that bit us on
 * 2026-05-20 when our user count crossed 50 and the 16 oldest users
 * (including admin) silently dropped out of the daily email batch.
 *
 * Iterates page-by-page until a partial page comes back (signal: fewer
 * results than PAGE_SIZE = end of data). 100-page safety cap so a runaway
 * pagination bug can't infinite-loop the cron (100 pages * 1000/page =
 * 100k users — well above any plausible scale for this product).
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

export async function listAllUsers(): Promise<User[]> {
  const all: User[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    const batch = data?.users || [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) return all;
  }
  console.warn(`listAllUsers: hit safety cap of ${MAX_PAGES} pages (${MAX_PAGES * PAGE_SIZE} users) — paginate further if this is real`);
  return all;
}
