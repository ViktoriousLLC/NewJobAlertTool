# Claude Code Subagents

Specialized AI agents that handle recurring tasks for NewJobAlertTool. Invoked automatically when you describe a matching task, or by explicit name.

## How to use

**Easy way — just describe what you need:**
- "The Coinbase scraper is broken" → spawns `scraper-doctor`
- "Review my pending change" → spawns `change-reviewer`
- "Production is down" → spawns `incident-triage`
- "Find me 10 new fintech companies to add" → spawns `catalog-scout`
- "Audit the auth code" → spawns `security-auth`

**Explicit way — name the agent:**
- "Use threat-modeling-expert on the Stripe Phase 1 plan"
- "Run spec-writer for a CSV export feature"
- "Have db-optimizer check the seen_jobs query plan"

Both work. The easy way is the default. Explicit when you have a specific opinion.

## Active agents (13)

| Agent | What it does | Invoke when | Model |
|---|---|---|---|
| `scraper-doctor` | Diagnoses one broken scraper and proposes a fix | A company shows 0 jobs or fails in admin digest | sonnet |
| `catalog-scout` | Researches new companies, detects ATS, outputs JSONL | Expanding catalog (220 → 1000) | sonnet |
| `security-auth` | Audits login/JWT/cookie code | Quarterly + before auth changes | opus |
| `security-data-isolation` | Audits cross-user data leaks + RLS | Quarterly + before new user-scoped routes | opus |
| `security-infra` | Audits npm vulns, env vars, headers, body limits | Quarterly + before dependency updates | opus |
| `change-reviewer` | Independent code review of pending diff | Before pushing any non-trivial change | opus |
| `code-refactorer` | Behavior-preserving cleanup | After a feature merge, when code is messy | sonnet |
| `incident-triage` | Production incident root-cause + fix proposal | Cron fail, batch email fail, mass scrape fail | opus |
| `debugger` | Fixes one specific bug (dev/local) | Local bugs (NOT prod incidents) | sonnet |
| `db-optimizer` | Postgres query / index / JSONB tuning | New query patterns, slow queries detected | opus |
| `performance-engineer` | App-layer perf review (N+1, parallelism, caching) | Feature reviews on hot paths | sonnet |
| `threat-modeling-expert` | STRIDE on new feature surfaces | Before Stripe, Twilio, new endpoints/tables | opus |
| `spec-writer` | Feature idea → backlog.md table spec | Before kicking off any new phase | sonnet |

## Deferred agents (pull when trigger fires)

Six more agents identified during research but not built yet. Each has a clear trigger:

| Agent | Source | Trigger to pull |
|---|---|---|
| `payment-integration` + 4 Stripe skills | `wshobson/agents` payment-processing plugin | Phase 1 (Stripe billing) kickoff |
| `experiment-tracker` | `msitarzewski/agency-agents` | First A/B test post-launch |
| `growth-hacker` | `msitarzewski/agency-agents` | Referral or growth push |
| `brand-landingpage` skill | `wshobson/agents` | Next landing page iteration |
| `seo-cannibalization-detector` + `content-marketer` | `wshobson/agents` | When blog or SEO launches |
| `customer-support` | `wshobson/agents` | Help inbox exceeds ~50 submissions/week |

When a trigger fires, just say: "we're starting [Phase X], pull in those agents." Claude will fork the public versions, trim them to fit this project, scrub external branding/links, and add them to this directory.

## Rules every agent follows

- **No direct git ops.** Agents do not commit, push, or open PRs. They return findings/patches in their output. The main agent handles git after your review.
- **PR flow always.** Every code or config change goes through: branch → push → `gh pr create` → preview review → merge. `main` is branch-protected.
- **Scoped, not sprawling.** Each agent has a specific job and stays in lane. If it notices something outside scope, it surfaces it in a "spillover" section but doesn't act on it.
- **Output contract.** Every agent file declares the exact markdown format it returns. Predictable, scannable, reviewable.

## Editing or adding agents

Each agent is a single `.md` file with YAML frontmatter:

```yaml
---
name: agent-name
description: When to invoke. Be specific so Claude routes correctly.
model: sonnet | opus
tools: Read, Grep, Glob, Bash, etc.
---

(system prompt — the agent's instructions)
```

After editing or adding an agent, **restart Claude Code** to register the change. Agents are loaded at session start.

To pull a deferred agent or add a new one from scratch, describe the role and Claude will draft the file using the same conventions as the existing 13.

## Why this exists

This portfolio was built on 2026-05-13 after evaluating ~700 public agents across four collections (`wshobson/agents`, `VoltAgent/awesome-claude-code-subagents`, `iannuttall/claude-agents`, `msitarzewski/agency-agents`). Most public agents are written for enterprise teams and don't fit a solo PM project. The 8 borrowed agents here were rewritten from scratch — no external links, no author signatures, no vendor name-drops, no roleplay headers. The 5 custom agents encode project-specific patterns (the 3-tier scraper recovery, the security audit triplet, the backlog.md spec format) that no public agent could cover.

Full reasoning + comparison data lives in the conversation history. Future audits should re-evaluate the public ecosystem every 6 months — collections grow fast.
