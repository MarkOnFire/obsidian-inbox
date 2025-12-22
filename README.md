# Cloudflare Email to Obsidian

Forward starred/flagged emails from Gmail, Outlook, or iCloud Mail to automatically create task notes in your Obsidian PARA inbox.

## Overview

**The Problem:** You receive important emails that need action, but they get lost in your inbox. You want them in your Obsidian vault as actionable notes.

**The Solution:** Set up email forwarding rules to send starred/flagged emails to a Cloudflare Email Worker, which parses the email and writes a markdown note directly to a Cloudflare R2 bucket. The [Remotely Save](https://github.com/remotely-save/remotely-save) Obsidian plugin syncs R2 to your vault.

```
Gmail/Outlook/iCloud → Forward Rules → inbox@yourdomain.com
                                              ↓
                              Cloudflare Email Worker (parse, format)
                                              ↓
                                    Cloudflare R2 Bucket
                                              ↓
                              Remotely Save Plugin (existing)
                                              ↓
                            Obsidian (Desktop, iOS, Android)
```

## Why This Approach?

- **No OAuth complexity** - emails arrive via simple forwarding rules
- **Free tier is generous** - 100K emails/day, 10GB R2 storage
- **Works on mobile** - Remotely Save plugin supports iOS/Android
- **Real-time** - emails processed in seconds
- **Simple** - only one component to build: the Email Worker (~100-150 lines)

## Prerequisites

- Custom domain with DNS on Cloudflare (e.g., `yourdomain.com`)
- Cloudflare account (free tier works)
- Obsidian with [Remotely Save](https://github.com/remotely-save/remotely-save) plugin
- Email accounts you want to forward from (Gmail, Outlook, iCloud, etc.)

## Setup

### 1. Create R2 Bucket

1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to **R2 Object Storage** → **Create bucket**
3. Name: `obsidian-inbox` (or your preference)
4. Click **Create bucket**

### 2. Enable Email Routing

1. Go to **Email** → **Email Routing**
2. Add your domain if not already configured
3. Under **Routing Rules**, you'll add a rule after deploying the worker

### 3. Deploy the Email Worker

```bash
# Clone this repo
git clone https://github.com/MarkOnFire/cloudflare-email-to-obsidian.git
cd cloudflare-email-to-obsidian

# Install dependencies
npm install

# Configure wrangler.toml with your R2 bucket name
# Edit wrangler.toml and update the bucket_name

# Deploy
npx wrangler deploy
```

### 4. Configure Email Routing Rule

1. Go to **Email** → **Email Routing** → **Routing Rules**
2. Click **Create address**
3. Custom address: `inbox` (or your preference)
4. Action: **Send to a Worker**
5. Select your deployed worker
6. Click **Save**

### 5. Set Up Remotely Save in Obsidian

1. Install [Remotely Save](https://github.com/remotely-save/remotely-save) from Community Plugins
2. Configure with your R2 bucket:
   - Service: **S3 or S3-compatible**
   - Endpoint: Your R2 endpoint (from R2 dashboard)
   - Access Key ID: Create in R2 → Manage R2 API Tokens
   - Secret Access Key: From the API token
   - Bucket: `obsidian-inbox`
   - Region: `auto`
3. Set sync folder to `0 - INBOX/` (or your inbox folder)

### 6. Configure Email Forwarding Rules

#### Gmail
1. Go to Gmail Settings → **See all settings** → **Forwarding and POP/IMAP**
2. Add forwarding address: `inbox@yourdomain.com`
3. Verify the forwarding address
4. Create a filter:
   - From Settings → **Filters and Blocked Addresses** → **Create a new filter**
   - Condition: `is:starred`
   - Action: **Forward to** `inbox@yourdomain.com`

#### Outlook
1. Go to Settings → **Mail** → **Rules**
2. Create new rule:
   - Condition: **Message is flagged**
   - Action: **Forward to** `inbox@yourdomain.com`

#### iCloud Mail
1. Go to iCloud.com → Mail → Settings (gear icon)
2. **Rules** → **Add a Rule**
3. Condition: Based on your preference (e.g., specific sender, subject contains)
4. Action: **Forward to** `inbox@yourdomain.com`

## Note Format

Each email creates a note like:

**Filename:** `2025-12-13 - Follow up on Q4 budget review.md`

**Content:**
```markdown
---
tags:
  - all
  - email-task
created: 2025-12-13
from: sender@example.com
subject: Follow up on Q4 budget review
email_id: abc123
source: gmail
---

## Tasks in this note
- [ ] Review and process this email

---
## Email
**From:** Manager Name <manager@example.com>
**Date:** December 13, 2025
**Subject:** Follow up on Q4 budget review

Hi Mark,

Can you review the Q4 budget projections and send feedback by Friday?

---
## Notes
```

## Configuration

Edit `wrangler.toml` to customize:

```toml
[vars]
INBOX_FOLDER = "0 - INBOX"  # Target folder in vault
```

## Development

```bash
# Install dependencies
npm install

# Run locally
npx wrangler dev

# Deploy
npx wrangler deploy
```

## Cost

| Component | Cost |
|-----------|------|
| Cloudflare Email Routing | Free (100K emails/day) |
| Cloudflare Workers | Free (100K requests/day) |
| Cloudflare R2 | Free (10GB storage, 1M Class A ops/month) |
| **Total** | **$0** |

Your typical Obsidian vault is well under 10GB. Email notes are tiny.

## Limitations

- **One-way sync:** Email → Obsidian only. Completing a task in Obsidian doesn't update the email.
- **No attachments:** Attachment names are listed but files aren't downloaded. Use the original email link.
- **Forwarding required:** You must set up forwarding rules in each email client.

## Troubleshooting

### Emails not arriving
1. Check Cloudflare Email Routing is enabled for your domain
2. Verify the routing rule points to your worker
3. Check worker logs in Cloudflare dashboard

### Notes not syncing to Obsidian
1. Verify Remotely Save is configured correctly
2. Check R2 bucket has the files (view in Cloudflare dashboard)
3. Ensure sync folder matches where worker writes notes

### Duplicate notes
- Each email has a unique ID in frontmatter
- Worker checks for existing files before writing
- If duplicates occur, check R2 bucket directly

## Prior Art

This project evolved from an OAuth-based Obsidian plugin approach (see [obsidian-email-to-para](https://github.com/MarkOnFire/obsidian-email-to-para) - archived). The OAuth approach required complex setup with Google Cloud Console and Azure Portal. This Cloudflare approach is simpler and works on mobile.

## License

MIT
