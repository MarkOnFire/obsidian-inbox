# Maintenance Backlog

Items are worked incrementally. Any agent can pick up work.

## High Priority

(none)

## Normal Priority

- [ ] Deploy to Cloudflare and run manual E2E test with real emails
- [ ] Configure email routing in Cloudflare dashboard
- [ ] Verify Remotely Save sync to Obsidian works end-to-end

## Low Priority / Nice to Have

(none)

## Completed (Recent)

### Initial Feature Set (all complete, tested 2025-12-23)

- [x] **F001** Email parsing with postal-mime - Parse incoming emails, extract from/to/subject/date/messageId/html/text
- [x] **F002** HTML to Markdown conversion - Convert HTML email bodies via turndown with text fallback
- [x] **F003** Email source detection - Detect Gmail/Outlook/iCloud from headers, set source in frontmatter
- [x] **F004** Markdown note generation - Generate complete notes with YAML frontmatter, tasks, email content, notes section
- [x] **F005** Filename generation and sanitization - Safe filenames from date+subject, handle special chars, length limits
- [x] **F006** R2 bucket write with deduplication - Write to R2, check for existing files to prevent duplicates
- [x] **F007** Error handling and logging - Comprehensive error handling, sanitized logs (messageId only)
- [x] **F008** End-to-end integration test - 33 unit tests via Vitest + Cloudflare Workers pool
