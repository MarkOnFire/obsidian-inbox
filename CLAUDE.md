# Obsidian Inbox

> **See [AGENTS.md](./AGENTS.md)** for complete project instructions.

## Claude-Specific Notes

This file provides Claude Code-specific guidance when working with this repository. All shared project documentation, commands, conventions, and guardrails are in AGENTS.md.

### Important Reminders

1. **Session context preservation**: Always read `claude-progress.txt` at session start to understand previous work. Update it at session end with a summary of what was accomplished.

2. **Feature tracking**: Check `feature_list.json` for pending work. Mark features complete with `passes: true` only after testing.

3. **Testing workflow**: Since this is a Cloudflare Email Worker, local testing requires wrangler email simulation. For real validation, deploy and send test emails.

4. **R2 API familiarity**: The worker uses Cloudflare R2 bucket bindings. R2 is S3-compatible but has Workers-specific APIs. Reference `knowledge/cloudflare/` for API details.

5. **Email parsing**: Use `postal-mime` for parsing RFC822 format - don't attempt to write custom MIME parsers. See `knowledge/postal-mime.md` for library documentation.

6. **Commit conventions**: Include agent attribution in commits following workspace standards (see AGENTS.md for reference to conventions).

7. **Environment safety**: This project processes email content. Be careful with logging to avoid exposing sensitive data in Cloudflare logs.
