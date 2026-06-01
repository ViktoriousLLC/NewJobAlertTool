---
description: Ship the current work end-to-end — branch off origin/main, commit, review, open the PR, merge, clean up the branch, and update the docs. ONE confirmation, then the whole chain. Usage: /ship (or just say "ship it" / "just ship").
---

# /ship — the one sanctioned way to get a change onto `main`

The user wants to ship the current work. This command exists to remove the per-session improvisation (branch vs local main, worktree or not, cleanup, savecc) that caused a 4-window `main` divergence on 2026-05-29. There are no decisions to make here — run the same chain every time. **Do NOT ask separate "should I push?" / "should I merge?" questions.** One confirmation, then Steps 1-8 autonomously.

## Step 0 — One confirmation gate
Summarize what's being shipped in one plain line, then ask exactly once:
> "Ship this? I'll branch off origin/main, commit, [review,] open the PR, merge, clean up the branch, and update the docs."

If the user already said "ship" / "just ship", treat that as the yes and skip straight to Step 1. On "no", stop and change nothing.

## Step 1 — Pre-flight (never touch local `main`)
- `git fetch origin --prune`.
- Get the work onto a branch off current `origin/main`:
  - Uncommitted work sitting on local `main`? Create a branch and move it there: `git checkout -b claude/<slug>`. Commits land on the branch, never on local main.
  - Already on a `claude/*` branch? Keep it; rebase onto `origin/main` if behind.
  - For large/parallel work, prefer an isolated worktree: `git worktree add ../<dir> -b claude/<slug> origin/main` (skip `npm ci` unless the change needs it — Windows long-path).
- `<slug>` = short kebab summary of the change.

## Step 2 — Bundle the docs AND the Linear task INTO this change (savecc-on-ship)
Make the PR self-documenting before committing:
- **Linear task (NOT optional) — every ship has one.** Find the Linear issue this work belongs to; if none exists, **create it** in the Development team (`DEV-N`) before opening the PR. Reference it in the commit/PR body. (Marking it Done/In-Progress + linking the PR happens at merge, Step 8.) A PR with no Linear task is an incomplete ship.
- **project-history.md** — append a dated `## YYYY-MM-DD — <theme>` entry (what changed, why, alternatives). Key by date + theme, never by PR number.
- **product-development-journey.md** — ONLY for a major user-facing capability shift (not bug fixes / chores). Plain, flowing, book-voice — **read `docs/Viks Voice/vik_voice_style_guide.md` first**, and keep the TL;DR table row to a plain one-line "what + why" (no jargon, no story, no fancy framing). When you add a phase, add its TL;DR table row in the SAME edit (a phase without a row is a half-update).
- **Operational-doc currency check** — if the change touches an API endpoint, DB table/column, env var, gotcha, or convention, update **CLAUDE.md** and the relevant sidecar (`SCRAPER.md` / `AUTH.md` / `ROUTES.md` / `JOBS.md` / `COMPONENTS.md`) in THIS SAME PR.

## Step 3 — Commit + push
- `git add -A && git commit -m "<conventional message>"` (end with the `Co-Authored-By` trailer).
- `git push -u origin <branch>`.

## Step 4 — Review (the one place judgment helps → use an agent)
- For a non-trivial **code** diff, spawn the `change-reviewer` agent on the diff and address any blocker before merging. Skip for docs-only or tiny diffs.

## Step 5 — Open the PR
- `gh pr create --title "..." --body "..."` (body = what/why + the docs updated in Step 2).

## Step 6 — Merge
- **Cron-window guard (DEV-57): do NOT merge during 13:55-16:00 UTC.** A merge auto-redeploys Railway and would kill the in-flight 14:00 daily cron (the 2026-05-31 P0). `date -u +%H%M`; if inside the window, STOP and report the PR URL — merge after 16:00 UTC. (CI's `cron-window-guard` also blocks it.)
- `main` is a repository ruleset (id 16381419) with **0 required approvals**, so merge is allowed without a human approver: `gh pr merge <n> --squash`.
- Merge ONLY if CI (Railway + Vercel) is green and the review had no unaddressed blockers. If anything is red or pending, **pause and report the PR URL** instead of merging.

## Step 7 — Clean up (so branches never pile up again)
- `git fetch origin --prune` (sweeps the auto-deleted remote branch); if the remote branch survives, `git push origin --delete <branch>`.
- `git checkout main && git reset --hard origin/main` — local main now matches GitHub.
- `git branch -D <branch>`; if a worktree was used, `git worktree remove <dir>`.

## Step 8 — Finish + verify
- **Linear: close the loop.** Move the Step 2 task to **Done** (or **In Progress** if it's multi-part / blocked on something) and add the PR link / a one-line "shipped in #N" comment. This is the merge-time half of the Step 2 Linear rule — don't skip it.
- Update **MEMORY.md** (memory dir, instant) with the project-state change + any new lesson.
- After a backend merge: `curl -s https://api.newpmjobs.com/api/health` (expect `{"status":"ok"}`).
- Report: PR # + merge commit, the **Linear task ID + its new state**, what shipped, which docs updated, local main reset, branch cleaned, health check.

## Hard rules
- NEVER commit to local `main`. Branch always.
- ONE confirmation (Step 0); after that, no more push/merge questions.
- Cleanup (Step 7) and local-main reset are NOT optional.
- Doc updates ride in the SAME PR as the change (Step 2). That is the savecc-on-ship; there is no separate "remember to savecc later".
- **Every ship has a Linear task** — create it if one doesn't exist (Step 2) and move it to its new state + link the PR on merge (Step 8). Docs AND Linear, every time.
- **This binds EVERY PR, not just `/ship`.** If you push a branch and open a PR by hand (no `/ship`), you STILL owe the Linear task + the Step 2 docs in that same PR. The manual-git fast-path is the exact thing that let docs + Linear lag a whole session on 2026-05-31 — there is no shortcut that skips them.

## When to pause instead of merging
CI red/pending; the `change-reviewer` found a blocker; the diff touches auth / security / payments and a human should look; or the user said "PR only, don't merge".
