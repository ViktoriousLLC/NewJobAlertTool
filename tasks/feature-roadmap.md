# NewJobAlertTool — Improvement Ideas & Feature Roadmap

## Context

You have a working PM job scraping tool that monitors ~19 companies and surfaces new product management roles. It's the only tool that *proactively discovers* PM jobs by scraping careers pages — competitors like Teal, Huntr, and Simplify require you to find jobs yourself first. The opportunity is to layer intelligence, automation, and application workflow on top of this unique discovery engine so it becomes a full job search command center.

---

## Part 1: My Improvement Ideas (from research)

### Idea A: Ghost Job Detection Signals
**30% of job postings in 2026 are fake.** Companies post them to benchmark salaries, look like they're growing, or make current employees feel replaceable. No tool currently flags this.

Signals we could track: how long a job has been posted, whether it's been re-posted, whether the listing exists on the company's actual careers page vs. just aggregator sites, whether a hiring manager is identifiable on LinkedIn. Display a confidence badge: "Fresh posting" vs. "Stale — posted 90+ days."

### Idea B: Company Intelligence Cards
When you look at a Stripe PM role, you should instantly see: funding stage, Glassdoor rating, recent layoffs/hiring trends, team size, and recent press. Otta does this for their own listings — we could do it for every scraped job. Data sources: Crunchbase API, Glassdoor, public SEC filings, news APIs.

### Idea C: Job Description Fetching + AI Analysis
Right now we store title + location + URL. We should also fetch the actual job description text and run it through Claude to extract: required skills, years of experience, team/org, reporting structure, and whether it's a "real PM" role vs. a project manager or product ops role mislabeled as PM.

### Idea D: Smart Match Scoring
After we have the JD text + a user profile (resume/skills), auto-score every new job: "This role is a 87% match for you — strong on strategy experience, gap in ML/AI knowledge." This is what Teal charges $29/month for, but done automatically at discovery time.

### Idea E: Application Status Pipeline
Turn the tool from a monitoring dashboard into a daily-use job search CRM. Kanban-style columns: Watching → Applied → Phone Screen → Onsite → Offer → Rejected. Every competitor (Huntr, Teal, Simplify) has this — it's table stakes for serious job searchers.

---

## Part 2: Your Ideas — Stack Ranked

### TOP 5 (Do these — they directly accelerate your job search)

**1. Proactively write a cover letter in my voice**
*The single biggest time sink in PM applications is crafting a tailored cover letter.* If the tool has your writing samples and the JD, Claude can draft one in your voice in seconds. You review, tweak, send. Saves 30-60 min per application. This is the feature that turns the tool from "monitoring" to "action."

**2. Daily emails**
*You should never have to open the app to find out about new jobs.* A morning email at 10am UTC with "3 new PM roles found today" — title, company, location, link — means you see new opportunities the instant they appear. Already half-built: Resend is installed, email template exists, cron runs daily. Just needs the API key configured.

**3. Looking at past documents → one-page recommendation for why to apply or not**
*This is your unfair advantage.* Feed Claude your resume, past cover letters, and career goals. For each new job, it generates a 1-page brief: "Apply — your payments experience at X maps directly to this Stripe role. Skip — this is a junior role below your level." Turns a 10-minute evaluation into a 10-second scan.

**4. Customize CV if I want to apply**
*Every PM knows you should tailor your resume for each role, but nobody actually does it because it takes too long.* Claude can rewrite bullet points to emphasize the skills each JD asks for. Your master resume goes in, a tailored version comes out. Cost: ~$0.02 per generation with Haiku.

**5. Search for more jobs automagically**
*19 companies isn't enough.* The tool should auto-discover new companies hiring PMs by monitoring Greenhouse boards, Lever, Wellfound, Y Combinator's Work at a Startup, and Lenny's Pallet job board. Instead of you adding companies manually, the tool finds them for you.

---

### NEXT 5 (High value, build after the top 5)

**6. Integrate levels.fyi**
*Salary context changes whether you even bother applying.* Levels.fyi has free embeddable widgets AND markdown endpoints for PM salary data by company. Quick iframe embed on company pages, or fetch salary ranges server-side. Helps you filter out roles that don't meet your TC target.

**7. To-do list / application pipeline feature**
*You need to track where each application stands.* A Kanban board (Interested → Applied → Interviewing → Offer → Rejected) turns the tool from "job feed" to "job search CRM." Without this, you're tracking status in a spreadsheet anyway.

**8. UI: click a job → links to Google Docs for cover letter, resume, notes**
*Each application needs artifacts.* When you click a job, you should see action links: "Cover Letter (Google Doc)" / "Tailored Resume (Google Doc)" / "Notes." Google Docs API can auto-create these, or start simple with manual link attachment.

**9. Review (resume review against JD)**
*Before you apply, get a match score.* Paste your resume + the JD, get back "82% match — add keywords: experimentation, A/B testing, growth metrics." This is what Jobscan charges $50/month for. With Claude it's pennies and can be automated for every new job.

**10. LangChain/Claude API workflow on Railway**
*The AI backbone for features #1-4 and #9.* After each daily scrape, trigger a Claude analysis pipeline: fetch JD, score match, generate cover letter draft, flag ghost jobs. Runs server-side on Railway, stores results in Supabase. Don't need LangChain specifically — direct Claude API calls are simpler and sufficient.

---

### THE REST (Nice-to-have, longer-term, or risky)

**11. YouTube MCP for videos on job pages**
*Helpful for company research but doesn't directly help you apply.* Use YouTube Data API to auto-find "day in the life as PM at [Company]" or "[Company] culture" videos and embed on the company detail page. Free tier gives 100 searches/day. Nice enrichment, low urgency.

**12. Open source it**
*Cool for portfolio/credibility, but doesn't help you get a job faster.* The scraper architecture is genuinely impressive and could be a good open-source project. But open-sourcing takes time (docs, cleanup, community management) that's better spent on features that help you apply.

**13. Productize it (multi-user SaaS)**
*The biggest opportunity but also the biggest investment.* Would need: Supabase Auth, user isolation (RLS), Stripe billing, onboarding flow, scraper scaling. Starter kits exist (Makerkit, Supastarter ~$299). Realistic timeline: 2-4 weeks to MVP. Do this only after the tool proves its value for your own job search — then you'll know exactly what to charge for.

**14. Scrape LinkedIn hiring manager posts**
*High signal, high risk.* LinkedIn's anti-scraping is the most aggressive of any platform. Legal gray area (hiQ v. LinkedIn settled for $500K). Account ban risk. Better alternative: build a "paste a LinkedIn post URL" feature where you manually flag hiring manager posts, or use JobSpy (open-source LinkedIn scraper) with caution.

---

## Suggested Build Order (if implementing)

| Phase | Features | Effort | Why this order |
|-------|----------|--------|----------------|
| **Phase 1** | Daily emails + Levels.fyi salary embeds | 1-2 days | Instant daily value with minimal code. Email is half-built already. |
| **Phase 2** | JD fetching + Claude analysis pipeline | 3-4 days | Foundation for all AI features. Fetch JDs, store them, run Claude to extract skills/requirements/match score. |
| **Phase 3** | Cover letter generation + CV customization | 3-5 days | The killer features. Requires user to upload master resume/writing samples once. |
| **Phase 4** | Application pipeline (Kanban) + Google Docs links | 3-4 days | Turns monitoring tool into daily-use CRM. |
| **Phase 5** | Auto-discover new companies + ghost job signals | 3-5 days | Expand beyond manually-added companies. Add quality signals. |

Total: ~2-3 weeks of focused building to transform this from a job monitor into a full PM job search command center.

---

## Key Research Findings

### Competitive Landscape
| Tool | Discovers Jobs | Tracks Apps | AI Resume | Company Intel | PM-Specific | Price |
|------|---------------|-------------|-----------|---------------|-------------|-------|
| **Your Tool** | Yes (scraped) | No | No | No | Partially | Free |
| Teal | No | Yes | Yes (best) | No | No | $29/mo |
| Huntr | No | Yes | Yes | No | No | $40/mo |
| Simplify | No | Yes | Yes (AI) | No | No | $40/mo |
| Jobscan | No | No | Yes (ATS) | No | No | $50/mo |
| Otta | Yes (curated) | Basic | No | Yes (best) | No | Free |

**Your unique advantage:** Only tool that proactively monitors specific companies' careers pages for new PM roles.

### Tech Feasibility Quick Reference
- **Levels.fyi:** Free embeddable iframes + free `.md` endpoints for salary data. No API key needed.
- **Daily emails (Resend):** Already installed in backend. Free tier = 100 emails/day. Just add API key.
- **Claude API for AI features:** Haiku ~$0.01-0.02 per job analysis. ~$18/month at 50 jobs/day.
- **Google Docs API:** Free, 300 read + 60 write requests/min. OAuth flow required.
- **YouTube Data API:** Free tier = 100 searches/day. No auth needed for public searches.
- **LinkedIn scraping:** Legally risky, technically hard, not recommended.
- **LangChain:** Overkill for this use case. Direct Claude SDK calls are simpler.
- **Productizing (multi-user):** Supabase Auth is free. Stripe billing via starter kit ~$299.

### PM Job Market Pain Points (2026)
1. **Ghost jobs** — 30% of postings are fake
2. **Volume vs. quality paradox** — hundreds of apps needed, but each must be tailored
3. **Brutal interview loops** — 4-12 weeks, up to 12 rounds, unpaid case studies
4. **Zero feedback** — employers ghost even after extensive interviews
5. **Title ambiguity** — "Product Manager" means different things everywhere
6. **Salary opacity** — ranges like "$40K-$120K" are meaningless
7. **No centralized discovery** — must check 10+ sources manually
