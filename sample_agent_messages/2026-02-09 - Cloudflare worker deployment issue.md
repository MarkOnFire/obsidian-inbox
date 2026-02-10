---
tags:
  - agent-message
created: 2026-02-09
from: alerts@cloudflare.com
subject: Cloudflare worker deployment issue
email_id: msg-sample-001
source: gmail
status: pending
---

## Agent Message
**From:** Cloudflare Alerts <alerts@cloudflare.com>
**Date:** Sun, 9 Feb 2026 10:30:00 -0600

---
There was an issue deploying your email worker. The R2 bucket binding
failed to resolve during the latest wrangler deploy. Check your
wrangler.toml configuration and ensure the bucket name matches.

Steps to reproduce:
1. Run `npx wrangler deploy`
2. Observe binding error for OBSIDIAN_BUCKET

This may be related to recent changes in the Cloudflare Workers runtime.
