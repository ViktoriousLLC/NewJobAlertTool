// Paginate a PostgREST select past its silent 1000-row cap.
//
// PostgREST caps any single `.select()` at 1000 rows and returns NO error, so
// an unbounded read on a table over 1000 rows silently processes a truncated
// slice. This bit the daily email (PR #97, ~43% of subscribers dropped) and
// the weekly digest surge math (DEV-36). Use this for any global read on a
// table that can exceed 1000 rows.
//
// `makeQuery(from, to)` MUST return a query that is already narrowed + ordered
// by a STABLE UNIQUE key (e.g. `.order("id")`) with `.range(from, to)` applied
// last. A stable order is required so paging cannot skip or duplicate rows.
//
// Example:
//   const rows = await fetchAllRows<JobRow>((from, to) =>
//     supabase.from("seen_jobs").select("...").eq("status", "active")
//       .order("id", { ascending: true }).range(from, to)
//   );

const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>
): Promise<T[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows as T[];
}
