# Progress Log

Session-by-session record of work completed.

---

## 2025-12-23 - Project Setup (Session 1)

### What was done
- Created new repo from deprecated obsidian-email-to-para OAuth approach
- Set up project structure with src/, templates/, knowledge/ folders
- Created initial worker.ts skeleton with manual MIME parsing (to be replaced)
- Scraped documentation for Cloudflare Email Workers, R2 API, postal-mime, turndown
- Added dependencies: postal-mime (email parsing), turndown (HTML to MD)
- Created CLAUDE.md with project context and conventions
- Set up long-running agent infrastructure (init.sh, feature_list.json, progress tracking)

### Current state
- Dependencies defined in package.json but not yet installed
- worker.ts has skeleton code with TODOs - needs update to use postal-mime
- 8 features defined, all pending
- Ready to begin F001: Email parsing with postal-mime

---

## 2025-12-23 - Code Review & Bug Fixes (Session 2)

### What was done
- Installed dependencies (npm install)
- Ran typecheck - code compiles clean
- Audited npm vulnerabilities (2 moderate in dev deps - esbuild/wrangler, not production concern)
- Code review agent identified 4 bugs:
  1. Outlook header detection used prefix match instead of exact match
  2. Missing INBOX_FOLDER default fallback
  3. Incomplete YAML escaping (didn't handle reserved words, leading chars)
  4. Sensitive data (email addresses, subjects) exposed in logs
- Bug fixer agent applied all 4 fixes
- Typecheck verified after fixes
- Code architect designed E2E testing strategy

### Bugs fixed
1. `detectEmailSource()` - Changed `key.startsWith('x-ms-exchange')` to exact match
2. Added `const inboxFolder = env.INBOX_FOLDER || '0 - INBOX'` fallback
3. Enhanced `escapeYaml()` to handle YAML reserved words, leading special chars, whitespace
4. Sanitized logs to use messageId instead of email addresses/subjects

---

## 2025-12-23 - Testing Infrastructure (Session 3)

### What was done
- Re-applied 4 bug fixes that weren't persisted from previous session
- Installed test dependencies: vitest, @cloudflare/vitest-pool-workers, @vitest/coverage-v8
- Created vitest.config.ts with Cloudflare Workers pool
- Exported pure functions from worker.ts for testability
- Created test utilities: src/test-utils/email-fixtures.ts
- Wrote 33 unit tests covering all pure functions
- All tests passing

### Files created
- `vitest.config.ts` - Vitest configuration with Cloudflare Workers pool
- `src/test-utils/email-fixtures.ts` - Mock email factories for testing

### Current state
- All 8 features complete and tested (passes: true)
- 33 unit tests passing
- TypeScript compiles clean
- Ready for deployment and real-world E2E testing

---

## 2026-01 - Address-Based Routing & Email Pipelines

### What was done
- Implemented address-based email routing (`extractRoute()`) with 4 routes:
  - `email-to-obsidian@` → task pipeline (original behavior)
  - `newsletter@` / `newsletters@` → newsletter pipeline
  - `claude@` → agent message pipeline (Phase 2 hook)
  - catch-all → inbox with header-based newsletter detection fallback
- Newsletter detection via `List-Unsubscribe` header (RFC 2369)
- Newsletter-specific markdown generation with excerpt + "view in browser" link
- Newsletter name extraction from sender display name
- "View in browser" URL extraction from newsletter HTML
- Agent message pipeline with `status: pending` for future AI processing
- Separate folder routing: `NEWSLETTERS/`, `AGENT MESSAGES/`, `TASKS FROM EMAIL/`
- Audit copy forwarding (unconditional forward to `FORWARD_TO` address)
- Attachment handling: save to R2, wikilink in markdown notes
- Email routing report via Cloudflare GraphQL Analytics (daily cron)

---

## 2026-02-03 - Repository Modernization

### What was done
- Renamed project references from "cloudflare-email-to-obsidian" to "obsidian-inbox"
- Consolidated AGENTS.md into CLAUDE.md as primary agent instruction file
- Migrated progress tracking from claude-progress.txt to planning/progress.md
- Migrated feature tracking from feature_list.json to planning/backlog.md
- Set up git hooks (.githooks/commit-msg)
- Created knowledge/sources.json for provenance tracking
- Removed deprecated root files
- Migrated knowledge docs to external Library
- Security scrub of personal data from source and config
- README rewrite for address-based routing and full project scope

---

## 2026-02 - Newsletter & Attachment Refinements

### What was done (merged via PRs)
- **PR #10**: Replaced full HTML newsletter conversion with summary + link approach
  - Newsletter notes now show an excerpt (stripped boilerplate) + prominent browser link
  - Better rendering in Obsidian vs full HTML-to-markdown dumps
- **PR #12**: Added Readwise archive protect/restore scripts
  - `scripts/readwise-protect.mjs` - snapshot items before bulk purge
  - `scripts/readwise-restore.mjs` - restore protected items from manifest
- **PR #13**: Refactored test fixture to use `Partial<ParsedEmail>` type
- **PR #11**: Added attachment wikilinks (`![[...]]`) to agent message notes
- **PR #14**: Expanded newsletter summaries — HTML→Markdown via Turndown before excerpting, 2000-char limit

### Current state
- 87 tests passing, typecheck clean
- 4 email routes operational (task, newsletter, agent, inbox)
- All feature branches consolidated into dev
- Dependabot vitest 4.x PRs closed (blocked by @cloudflare/vitest-pool-workers peer dep)
