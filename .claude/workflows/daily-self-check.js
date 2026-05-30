export const meta = {
  name: 'daily-self-check',
  description: 'Parallel fan-out daily scraper self-check (DEV-41). Diagnoses each suspect company, then adversarially verifies the diagnosis against the LIVE ATS board before it counts. Returns the confirmed-actionable report (empty => no admin email). Replaces the old serial scraper-doctor loop that mislabeled broken scrapers as healthy for weeks.',
  phases: [
    { title: 'Diagnose', detail: 'one scraper-doctor per suspect, hits the live board' },
    { title: 'Verify', detail: 'independent refute pass against the live board (both directions)' },
  ],
}

// args = array of suspect company rows the triggering agent already filtered from
// the `companies` table, e.g. {id, name, platform_type, platform_config,
// careers_url, last_check_status, subscriber_count, consecutive_failure_count,
// consecutive_healthy_zero_days, total_product_jobs}. The suspect SQL lives in
// the trigger (JOBS.md "Daily Self-Check Agent"); it EXCLUDES is_verified_zero
// companies (auto-managed, known-zero — not real suspects) so the fan-out stays
// small. Keeping the fetch in the trigger keeps this workflow a pure pipeline.
//
// args may arrive as a real array, a { suspects: [...] } object, or — depending
// on how the caller forwards it — a JSON-encoded string. Normalize all three so
// the trigger can't accidentally feed us an empty run.
function parseSuspects(a) {
  let v = a
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { return [] }
  }
  if (Array.isArray(v)) return v
  if (v && Array.isArray(v.suspects)) return v.suspects
  return []
}
const suspects = parseSuspects(args)
log(`args arrived as ${typeof args}; parsed ${suspects.length} suspect(s).`)

// Hard cap so a bad day (or a relabel sweep) can't silently balloon the fan-out
// into hundreds of agents. Anything over the cap is reported, never dropped silently.
const MAX = 20
const scoped = suspects.slice(0, MAX)
const overflow = suspects.slice(MAX)
if (overflow.length > 0) {
  log(`WARNING: ${suspects.length} suspects exceeds cap ${MAX}. Checking the first ${MAX}; NOT silently dropping the rest — these ${overflow.length} need a manual look or a higher cap: ${overflow.map((c) => c.name).join(', ')}`)
}
if (scoped.length === 0) {
  log('No suspects passed in — clean board, nothing to check.')
  return { suspects: 0, dropped: 0, confirmed: [], all: [], overflow: [] }
}
log(`Self-check over ${scoped.length} suspect ${scoped.length === 1 ? 'company' : 'companies'}: ${scoped.map((c) => c.name).join(', ')}`)

const DIAGNOSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    company: { type: 'string' },
    isBroken: { type: 'boolean', description: 'true if the scraper is actually failing to surface real, available PM-type roles' },
    category: { type: 'string', description: 'platform-moved | selector-broke | config-wrong | silent-zero | genuinely-zero-PMs | low-quality-data | stale-label | transient | healthy-false-alarm | other' },
    rootCause: { type: 'string' },
    proposedFix: { type: 'string', description: 'concrete fix, or "none needed" if healthy' },
    liveJobsFound: { type: 'number', description: 'count of PM-type roles you saw on the LIVE board when you checked it yourself' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['company', 'isBroken', 'category', 'rootCause', 'proposedFix', 'liveJobsFound', 'confidence'],
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    company: { type: 'string' },
    refuted: { type: 'boolean', description: 'true if the diagnosis does NOT hold up against what you independently found' },
    stillActionable: { type: 'boolean', description: 'true ONLY if there is a real, fixable scraper problem affecting subscribers that an admin should act on' },
    liveBoardResult: { type: 'string', description: 'what you actually saw hitting the live board yourself (your own numbers, not the diagnosis\'s)' },
    reason: { type: 'string' },
  },
  required: ['company', 'refuted', 'stillActionable', 'liveBoardResult', 'reason'],
}

const diagnosePrompt = (c) =>
`You are the daily scraper self-check, diagnosing ONE suspect company end-to-end. Do NOT assume it is broken — most suspects turn out to be false alarms, and your value is telling real breakage apart from benign states.

Company: ${c.name}
platform_type: ${c.platform_type}
platform_config: ${JSON.stringify(c.platform_config)}
careers_url: ${c.careers_url}
last_check_status: ${c.last_check_status}
total_product_jobs (last recorded): ${c.total_product_jobs}
subscriber_count: ${c.subscriber_count}
consecutive_failure_count: ${c.consecutive_failure_count}
consecutive_healthy_zero_days: ${c.consecutive_healthy_zero_days}

It tripped a suspect filter (status contains "error" / "0 jobs from source" / the legacy "quality: 0/100" label / a failure streak / a healthy-zero streak). Note: many of these are "success (quality: 0/100)" companies that DO have jobs recorded — decide whether that is a real problem (scraper returning malformed or empty data) or benign (the quality scorer mislabels, the label is stale and predates a recent fix, or the company genuinely has few/zero PM roles right now).

Do this:
1. Read backend/src/scraper/SCRAPER.md once for platform-specific gotchas (Ashby transient null-on-200, Workday tenant/boardPath, Greenhouse boardName, etc).
2. Hit the LIVE source yourself — curl the ATS API or fetch the board for this platform_type + config — and count the Product Manager-type roles actually available right now. Do not trust the recorded numbers; get your own.
3. Conclude: is the scraper actually broken? category, root cause, a concrete proposed fix (or "none needed" if healthy), and liveJobsFound = the PM-type roles you saw live.

Return the structured diagnosis. Do not edit any files — this is diagnosis only.`

const verifyPrompt = (c, diag) =>
`Adversarial verification of a scraper self-check diagnosis. Be skeptical and INDEPENDENT — your job is to try to REFUTE the diagnosis, in BOTH directions:
- If it concluded BROKEN: try to prove it's a false alarm (the company actually has live PM roles flowing / the scraper is fine).
- If it concluded HEALTHY: try to prove it's actually broken (a real problem the first agent missed — the "mislabeled-healthy" case that let zombie jobs sit live for weeks).

Company: ${c.name} (platform_type=${c.platform_type}, config=${JSON.stringify(c.platform_config)}, url=${c.careers_url}, last_check_status=${c.last_check_status}).

Diagnosis to challenge:
- isBroken: ${diag.isBroken}
- category: ${diag.category}
- rootCause: ${diag.rootCause}
- proposedFix: ${diag.proposedFix}
- liveJobsFound: ${diag.liveJobsFound}
- confidence: ${diag.confidence}

Independently hit the live ATS board/API yourself (curl/fetch) and get YOUR OWN count of available PM-type roles — do not reuse the diagnosis's numbers. Then decide:
- refuted: true if the diagnosis does not hold up against what you found.
- stillActionable: true ONLY if you INDEPENDENTLY confirmed a real, fixable scraper problem affecting subscribers that an admin should act on. Default to false when uncertain.
Return the structured verdict with liveBoardResult = what you actually saw. Diagnosis only — do not edit files.`

// pipeline (not parallel): each suspect flows diagnose -> verify independently, no
// barrier, so a slow diagnosis on one company doesn't hold up verification of another.
const results = await pipeline(
  scoped,
  (c) => agent(diagnosePrompt(c), { label: `diagnose:${c.name}`, phase: 'Diagnose', schema: DIAGNOSE_SCHEMA, agentType: 'scraper-doctor' }),
  (diag, c) => {
    // A diagnose step that returned nothing is itself actionable — surface it as
    // "needs a manual look" rather than letting it vanish from the report.
    if (!diag) {
      return {
        company: c.name,
        diagnosis: null,
        verdict: { company: c.name, refuted: false, stillActionable: true, liveBoardResult: 'n/a', reason: 'diagnose step returned no result — needs a manual look' },
      }
    }
    return agent(verifyPrompt(c, diag), { label: `verify:${c.name}`, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'scraper-doctor' })
      .then((v) => ({ company: c.name, diagnosis: diag, verdict: v }))
  },
)

const all = results.filter(Boolean)
// Confirmed = survived the adversarial pass as a real, actionable problem. This is
// the report body; the trigger emails the admin ONLY if this is non-empty.
const confirmed = all.filter((r) => r.verdict && r.verdict.stillActionable === true)
const diagnoseFailed = scoped.length - all.length // items that threw out of the pipeline entirely

log(`Done. ${scoped.length} checked -> ${confirmed.length} confirmed actionable, ${all.length - confirmed.length} cleared as false alarm/healthy${diagnoseFailed > 0 ? `, ${diagnoseFailed} errored out of the pipeline` : ''}.`)

return {
  suspects: scoped.length,
  dropped: overflow.length,
  diagnoseFailed,
  confirmed,
  all,
  overflow: overflow.map((c) => c.name),
}
