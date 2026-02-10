# Backlog

Items are worked incrementally. Any agent can pick up work.

---

## Roadmap: Newsletter Capture Refinement

Improve the quality and usability of newsletter notes in Obsidian.

- [ ] Evaluate excerpt quality across different newsletter formats (Substack, Buttondown, Mailchimp, custom)
- [ ] Improve boilerplate stripping — current regex approach (`Unsubscribe...`, `You're receiving...`) may miss format-specific footers or cut too aggressively
- [ ] Handle newsletters with no "view in browser" link — consider extracting key URLs from the body as fallback
- [ ] Test newsletter rendering in Obsidian — confirm markdown output reads well with Remotely Save sync
- [ ] Consider per-newsletter configuration (some may warrant full body, others just excerpt + link)

## Roadmap: Email Routes & Agent Inbox

Two distinct email routes serve different purposes:

### `email-to-obsidian@` — Task Capture (simple, no AI)

Emails flagged in Gmail/Outlook/iCloud get forwarded via mail rules. The worker parses them and drops a task note into `TASKS FROM EMAIL/`. No AI processing — just clean capture. User triages manually: promote to a project note or add as to-do within an existing note.

**Status:** Already implemented. The `task` route and `generateMarkdown()` handle this.

### `claude@` — Agent Inbox (two-tier intelligent processing)

A freeform "hey Claude, look at this" space. Forward brainstorming ideas, research topics, interesting articles, things to analyze. The worker captures the email as a `status: pending` agent message (already implemented). A local agent processes it in two tiers.

#### Tier 1: Light Analysis (automatic)

Runs on a schedule (launchd/cron). Picks up `status: pending` notes and enriches them:
- Search Obsidian vault for related notes (via `obsidian-vault` MCP: `search_notes` with PARA filtering)
- Search The Library for relevant research (via `the-library` MCP: `search_library`)
- Append a `## Related Context` section with wikilinks and library references
- Update `status: pending` → `status: triaged`

Implementation:
- [ ] Create light analysis script (Node.js or Python)
- [ ] Integrate obsidian-vault MCP for vault search (search by subject keywords, sender, content themes)
- [ ] Integrate the-library MCP for research matching
- [ ] Define output format for `## Related Context` section
- [ ] Set up launchd plist for scheduled runs
- [ ] Handle edge cases: no matches found, note already processed, etc.

#### Tier 2: Staff Meeting (on-demand via `/staff-meeting`)

A team of agent personas discusses each pending/triaged item like a staff meeting. Invoked manually when you want deep analysis.

**The Staff:**

| Persona | Role | Perspective |
|---------|------|-------------|
| **The Strategist** | Big-picture connector | Links to active projects/areas, asks "where does this fit?", identifies opportunities and patterns across your work |
| **The Researcher** | Deep material analysis | Library deep-dive, finds supporting/contradicting sources, surfaces things you've read before that connect |
| **The Pragmatist** | Next-action focus | What's actually actionable? What's the smallest useful step? Time/effort reality check |
| **The Skeptic** | Challenge assumptions | "Do we actually need this?", "What are we not seeing?", points out gaps, prevents shiny-object syndrome |

**Output format** (appended to the agent message note):

```markdown
---
## Staff Meeting — {date}

### Related Context
- [[Project Note]] — why it's relevant
- Library: "Document Title" — why it's relevant

### Discussion

**Strategist:** [analysis from big-picture perspective]

**Researcher:** [findings from vault and Library deep-dive]

**Pragmatist:** [actionable next steps, reality check]

**Skeptic:** [challenges, questions, alternative framing]

### Consensus
[Summary of what the team agreed on, recommended next steps]
```

**Status lifecycle:** `pending` → `triaged` (after Tier 1) → `discussed` (after Tier 2)

Implementation:
- [ ] Create `/staff-meeting` skill
- [ ] Define agent persona prompts with distinct analytical lenses
- [ ] Implement team spawn pattern (4 personas analyzing in parallel)
- [ ] Design consensus synthesis step (after personas report back)
- [ ] Append formatted output to agent message notes
- [ ] Update frontmatter status to `discussed`

---

## Deployment & Validation

- [ ] Deploy to Cloudflare and run manual E2E test with real emails
- [ ] Configure email routing in Cloudflare dashboard
- [ ] Verify Remotely Save sync to Obsidian works end-to-end

## Completed

### Initial Feature Set (F001-F008, completed 2025-12-23, 33 unit tests)

- [x] **F001** Email parsing with postal-mime
- [x] **F002** HTML to Markdown conversion (turndown)
- [x] **F003** Email source detection (Gmail/Outlook/iCloud)
- [x] **F004** Markdown note generation with YAML frontmatter
- [x] **F005** Filename generation and sanitization
- [x] **F006** R2 bucket write with deduplication
- [x] **F007** Error handling and logging (sanitized)
- [x] **F008** End-to-end integration tests

### Post-Initial Features (2026-01 through 2026-02)

- [x] Address-based email routing (4 routes: task, newsletter, agent, inbox)
- [x] Newsletter detection, routing, and summary+link markdown generation
- [x] Agent message pipeline (`claude@` route, `status: pending`)
- [x] Audit copy forwarding
- [x] Attachment handling (R2 storage + Obsidian wikilinks)
- [x] Email routing report (Cloudflare GraphQL Analytics, daily cron)
- [x] Newsletter excerpt expansion (HTML→MD, 2000-char limit)
- [x] Repository modernization (rename, conventions, security scrub)
- [x] Readwise archive protect/restore scripts
