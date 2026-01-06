# Cloudflare Email to Obsidian

## Project Overview

A Cloudflare Email Worker that receives forwarded emails and creates markdown notes in an R2 bucket for sync to Obsidian via the Remotely Save plugin.

**Architecture:**
```
Gmail/Outlook/iCloud → Forward Rules → inbox@yourdomain.com
                                              ↓
                              Cloudflare Email Worker (this project)
                                              ↓
                                    Cloudflare R2 Bucket
                                              ↓
                              Remotely Save Plugin → Obsidian
```

## Key Files

| File | Purpose |
|------|---------|
| `src/worker.ts` | Main Email Worker - receives emails, parses, writes to R2 |
| `wrangler.toml` | Cloudflare configuration - R2 bindings, env vars |
| `templates/email-task-template.md` | Reference note format |
| `feature_list.json` | Work queue for long-running development |
| `claude-progress.txt` | Session log for context preservation |

## Tech Stack

- **Runtime:** Cloudflare Workers (Email Workers)
- **Storage:** Cloudflare R2 (S3-compatible)
- **Email Parsing:** `postal-mime` - parses RFC822 emails in Workers
- **HTML→Markdown:** `turndown` - converts HTML email bodies to markdown
- **Sync:** Remotely Save plugin (external, not part of this project)

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Local development with wrangler
npm run deploy       # Deploy to Cloudflare
npm run tail         # Stream live logs
npm run typecheck    # TypeScript type checking
```

## Development Workflow

### Session Start
1. Run `./init.sh` to set up environment
2. Read `claude-progress.txt` for context from previous sessions
3. Check `feature_list.json` for next pending feature

### Session End
1. Update `feature_list.json` - mark feature status, set `passes: true` if tested
2. Update `claude-progress.txt` with session summary
3. Commit changes with clear message
4. Leave working tree clean

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

All AI agents working in this repository must follow the workspace commit convention:

**See**: `/Users/mriechers/Developer/the-lodge/conventions/COMMIT_CONVENTIONS.md`

**Quick Reference**: AI commits should include `[Agent: <name>]` after the subject line for tracking purposes.

Example:
```
feat: Add email deduplication check

[Agent: Main Assistant]

Check for existing file by email_id before writing to R2
to prevent duplicate notes from the same email.
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INBOX_FOLDER` | Target folder in vault | `0 - INBOX` |
| `OBSIDIAN_BUCKET` | R2 bucket binding | (required) |

## Testing

### Local Testing
```bash
npm run dev
# Use wrangler's email testing capabilities
```

### Manual Verification
1. Deploy to Cloudflare
2. Send test email to configured address
3. Check R2 bucket for created note
4. Verify note syncs to Obsidian via Remotely Save

## Knowledge Resources

Documentation in `knowledge/` folder:
- `cloudflare/` - Email Workers, R2 API, Wrangler CLI
- `postal-mime.md` - Email parsing library
- `turndown.md` - HTML to Markdown conversion
- `remotely-save.md` - Obsidian sync plugin

## Guardrails

### Must Do
- Parse emails with `postal-mime` (don't write custom MIME parsing)
- Convert HTML to Markdown with `turndown`
- Check for existing file before writing (deduplication)
- Include source URL in generated docs
- Sanitize filenames for cross-platform compatibility

### Must Not
- Store sensitive data in logs
- Fail silently - log errors for debugging
- Create duplicate notes for same email
- Modify R2 bucket structure outside INBOX_FOLDER
