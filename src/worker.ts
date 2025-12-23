/**
 * Cloudflare Email Worker
 *
 * Receives forwarded emails and creates markdown notes in R2 bucket
 * for sync to Obsidian via Remotely Save plugin.
 */

import PostalMime from 'postal-mime';
import type { Email, Address } from 'postal-mime';
import TurndownService from 'turndown';

export interface Env {
  OBSIDIAN_BUCKET: R2Bucket;
  INBOX_FOLDER: string;
}

type EmailSource = 'gmail' | 'outlook' | 'icloud' | 'unknown';

interface ParsedEmail {
  messageId: string;
  from: {
    name: string;
    email: string;
  };
  subject: string;
  date: Date;
  body: string; // Markdown-converted body
  source: EmailSource;
}

// Initialize Turndown for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      console.log(`Processing email from: ${message.from}`);

      // Parse the incoming email with postal-mime
      const parsed = await parseEmail(message);

      // Generate markdown note
      const markdown = generateMarkdown(parsed);

      // Generate filename
      const filename = generateFilename(parsed, env.INBOX_FOLDER);

      // Check if note already exists (deduplication)
      const existing = await env.OBSIDIAN_BUCKET.head(filename);
      if (existing) {
        console.log(`Note already exists: ${filename}`);
        return;
      }

      // Write to R2 bucket
      await env.OBSIDIAN_BUCKET.put(filename, markdown, {
        httpMetadata: {
          contentType: 'text/markdown; charset=utf-8',
        },
        customMetadata: {
          'email-id': parsed.messageId,
          'email-from': parsed.from.email,
          'email-source': parsed.source,
          'created': new Date().toISOString(),
        },
      });

      console.log(`Created note: ${filename}`);
    } catch (error) {
      console.error('Failed to process email:', error);
      // Don't throw - we don't want to bounce the email
    }
  },
};

/**
 * Parse email using postal-mime library
 */
async function parseEmail(message: ForwardableEmailMessage): Promise<ParsedEmail> {
  // Parse with postal-mime - it handles ReadableStream directly
  const email: Email = await PostalMime.parse(message.raw);

  // Extract from address
  const fromAddr = extractFromAddress(email);

  // Get message ID from headers or generate one
  const messageId = email.messageId || generateMessageId();

  // Parse date
  const emailDate = email.date ? new Date(email.date) : new Date();

  // Convert body to markdown
  const body = convertBodyToMarkdown(email);

  // Detect source from headers
  const source = detectEmailSource(email);

  return {
    messageId: sanitizeMessageId(messageId),
    from: fromAddr,
    subject: email.subject || 'No Subject',
    date: emailDate,
    body,
    source,
  };
}

/**
 * Extract from address from parsed email
 */
function extractFromAddress(email: Email): { name: string; email: string } {
  if (email.from) {
    // Check if it's a mailbox (has address property)
    if ('address' in email.from && email.from.address) {
      return {
        name: email.from.name || email.from.address,
        email: email.from.address,
      };
    }
    // It's a group - use first member or fallback
    if ('group' in email.from && email.from.group && email.from.group.length > 0) {
      const first = email.from.group[0];
      return {
        name: first.name || first.address,
        email: first.address,
      };
    }
  }

  return {
    name: 'Unknown',
    email: 'unknown@unknown.com',
  };
}

/**
 * Convert email body to Markdown
 * Prefer HTML (converted to MD), fallback to plain text
 */
function convertBodyToMarkdown(email: Email): string {
  if (email.html) {
    try {
      return turndownService.turndown(email.html);
    } catch (error) {
      console.warn('Failed to convert HTML to Markdown, using text fallback:', error);
    }
  }

  if (email.text) {
    return email.text;
  }

  return '*No email content*';
}

/**
 * Detect email source from headers
 */
function detectEmailSource(email: Email): EmailSource {
  // Check headers array for source indicators
  for (const header of email.headers) {
    const key = header.key.toLowerCase();
    const value = header.value.toLowerCase();

    // Gmail indicator
    if (key === 'x-gm-message-state') {
      return 'gmail';
    }

    // Outlook/Microsoft indicators
    if (key.startsWith('x-ms-exchange') || key === 'x-microsoft-antispam') {
      return 'outlook';
    }

    // iCloud indicators
    if (key === 'received' && (value.includes('apple.com') || value.includes('icloud.com'))) {
      return 'icloud';
    }
  }

  return 'unknown';
}

/**
 * Generate markdown note content
 */
function generateMarkdown(email: ParsedEmail): string {
  const createdDate = formatDate(email.date);
  const fullDate = formatDateLong(email.date);

  return `---
tags:
  - all
  - email-task
created: ${createdDate}
from: ${email.from.email}
subject: ${escapeYaml(email.subject)}
email_id: ${email.messageId}
source: ${email.source}
---

## Tasks in this note

- [ ] Review and process this email

---
## Email
**From:** ${email.from.name} <${email.from.email}>
**Date:** ${fullDate}
**Subject:** ${email.subject}

${email.body}

---
## Notes

`;
}

/**
 * Generate safe filename from email
 */
function generateFilename(email: ParsedEmail, inboxFolder: string): string {
  const date = formatDate(email.date);

  // Sanitize subject for filename
  const safeSubject = email.subject
    .replace(/[/\\?%*:|"<>]/g, '-') // Replace unsafe chars
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .trim()
    .slice(0, 100);                 // Limit length

  return `${inboxFolder}/${date} - ${safeSubject}.md`;
}

// Utility functions

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatDateLong(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeYaml(str: string): string {
  // Escape strings that need quoting in YAML
  if (/[:#{}[\],&*?|<>=!%@`]/.test(str) || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return str;
}

function sanitizeMessageId(id: string): string {
  return id.replace(/[<>]/g, '').replace(/[^a-zA-Z0-9@._-]/g, '_');
}

function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Type declaration for Cloudflare Email Workers
interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}
