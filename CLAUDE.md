# Obsidian Inbox

## Project Overview

A Cloudflare Email Worker that receives forwarded emails and creates markdown notes in an R2 bucket for sync to Obsidian via the Remotely Save plugin.

**Architecture:**
```
Gmail/Outlook/iCloud -> Forward Rules -> inbox@yourdomain.com
                                              |
                              Cloudflare Email Worker (this project)
                                              |
                                    Cloudflare R2 Bucket
                                              |
                              Remotely Save Plugin -> Obsidian
```

## Technical Stack

- **Runtime:** Cloudflare Workers (Email Workers)
- **Storage:** Cloudflare R2 (S3-compatible)
- **Email Parsing:** `postal-mime` - parses RFC822 emails in Workers
- **HTML to Markdown:** `turndown` - converts HTML email bodies
- **Sync:** Remotely Save plugin (external, not part of this project)
- **Testing:** Vitest + @cloudflare/vitest-pool-workers

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Local development with wrangler
npm run deploy       # Deploy to Cloudflare
npm run tail         # Stream live logs
npm run typecheck    # TypeScript type checking
npm test             # Run tests once
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run with coverage report
```

## Key Files

| File | Purpose |
|------|---------|
| `src/worker.ts` | Main Email Worker - receives emails, parses, writes to R2 |
| `wrangler.toml` | Cloudflare configuration - R2 bindings, env vars |
| `templates/email-task-template.md` | Reference note format |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INBOX_FOLDER` | Target folder in vault | `0 - INBOX` |
| `OBSIDIAN_BUCKET` | R2 bucket binding | (required) |

## Conventions

### Note Format
Notes are created with YAML frontmatter:
```markdown
---
tags:
  - all
  - email-task
created: YYYY-MM-DD
from: sender@example.com
subject: Email subject
email_id: unique-message-id
source: gmail|outlook|icloud|unknown
---

## Tasks in this note
- [ ] Review and process this email

---
## Email
**From:** Name <email@example.com>
**Date:** Full date string
**Subject:** Subject line

[Markdown-converted email body]

---
## Notes
```

### File Naming
`{INBOX_FOLDER}/{YYYY-MM-DD} - {sanitized subject}.md`

Subject sanitization: Replace `/\?%*:|"<>` with `-`, limit to 100 chars.

### Email Source Detection
- Gmail: `x-gm-message-state` header present
- Outlook: `x-ms-exchange-organization-authas` header present
- iCloud: `received` header contains `apple.com` or `icloud.com`

### Git Commits
Follow workspace commit conventions. See `~/Developer/the-lodge/conventions/COMMIT_CONVENTIONS.md`.

## Guardrails

### Must Do
- Parse emails with `postal-mime` (don't write custom MIME parsing)
- Convert HTML to Markdown with `turndown`
- Check for existing file before writing (deduplication)
- Sanitize filenames for cross-platform compatibility

### Must Not
- Store sensitive data in logs (use messageId only, no email addresses/subjects)
- Fail silently - log errors for debugging
- Create duplicate notes for same email
- Modify R2 bucket structure outside INBOX_FOLDER

## Testing

- **Unit tests:** Vitest with Cloudflare Workers pool (33 tests covering all pure functions)
- **Manual E2E:** Deploy to Cloudflare, send test emails, verify notes in R2

## Planning

Session progress, backlog, and planning artifacts are in `planning/`.

- Progress log: `planning/progress.md`
- Backlog: `planning/backlog.md`

## Knowledge Resources

Documentation in `knowledge/` folder:
- `cloudflare/` - Email Workers, R2 API, Wrangler CLI
- `postal-mime.md` - Email parsing library
- `turndown.md` - HTML to Markdown conversion
- `remotely-save.md` - Obsidian sync plugin
