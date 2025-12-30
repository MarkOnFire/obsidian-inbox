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

export type EmailSource = 'gmail' | 'outlook' | 'icloud' | 'unknown';

export interface ParsedEmail {
  messageId: string;
  from: {
    name: string;
    email: string;
  };
  subject: string;
  date: Date;
  body: string; // Markdown-converted body
  source: EmailSource;
  attachments: Email['attachments'];
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
      console.log('Processing email, message ID will be assigned');

      // Parse the incoming email with postal-mime
      const parsed = await parseEmail(message);

      // Generate markdown note
      const markdown = generateMarkdown(parsed);

      // Generate filename
      const inboxFolder = env.INBOX_FOLDER || '0 - INBOX';
      const filename = generateFilename(parsed, inboxFolder);

      // Check if note already exists (deduplication)
      const existing = await env.OBSIDIAN_BUCKET.head(filename);
      if (existing) {
        console.log(`Duplicate detected, skipping: ${parsed.messageId}`);
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

      console.log(`Note created: ${parsed.messageId}`);

      // Handle attachments
      if (parsed.attachments && parsed.attachments.length > 0) {
        console.log(`Saving ${parsed.attachments.length} attachments...`);
        const attachmentPromises = parsed.attachments.map(attachment =>
          saveAttachment(env, parsed.messageId, attachment)
        );
        await Promise.all(attachmentPromises);
        console.log('All attachments saved.');
      }

    } catch (error) {
      console.error('Failed to process email:', error);
      // Don't throw - we don't want to bounce the email
    }
  },
};

/**
 * Save an attachment to R2
 */
async function saveAttachment(env: Env, messageId: string, attachment: Email['attachments'][0]): Promise<void> {
  const safeFilename = sanitizeAttachmentFilename(attachment.filename || 'untitled');
  const attachmentPath = `_attachments/${messageId}/${safeFilename}`;

  await env.OBSIDIAN_BUCKET.put(attachmentPath, attachment.content, {
    httpMetadata: {
      contentType: attachment.mimeType,
    },
  });
  console.log(`Saved attachment: ${attachmentPath}`);
}

/**
 * Sanitize attachment filename
 */
function sanitizeAttachmentFilename(filename: string): string {
  // Remove path-related characters and other unsafe characters
  return filename.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_');
}

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
    attachments: email.attachments,
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
export function detectEmailSource(email: Email): EmailSource {
  // Check headers array for source indicators
  for (const header of email.headers) {
    const key = header.key.toLowerCase();
    const value = header.value.toLowerCase();

    // Gmail indicator
    if (key === 'x-gm-message-state') {
      return 'gmail';
    }

    // Outlook/Microsoft indicators
    if (key === 'x-ms-exchange-organization-authas' || key === 'x-microsoft-antispam') {
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
export function generateMarkdown(email: ParsedEmail): string {
  const createdDate = formatDate(email.date);
  const fullDate = formatDateLong(email.date);

  let attachmentsSection = '';
  if (email.attachments && email.attachments.length > 0) {
    const attachmentLinks = email.attachments
      .map(att => {
        const safeFilename = sanitizeAttachmentFilename(att.filename || 'untitled');
        const attachmentPath = `_attachments/${email.messageId}/${safeFilename}`;
        // Use Obsidian's wikilink format for attachments
        return `- ![[${attachmentPath}]]`;
      })
      .join('\n');
    attachmentsSection = `---
## Attachments

${attachmentLinks}

`;
  }

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

${attachmentsSection}---
## Notes

`;
}

/**
 * Generate safe filename from email
 */
export function generateFilename(email: ParsedEmail, inboxFolder: string): string {
  const date = formatDate(email.date);

  // Clean and sanitize subject for filename
  const cleanedSubject = email.subject.replace(/^(\[fwd:?\]|fwd:?)\s*/i, '');
  const safeSubject = cleanedSubject
    .replace(/[/\\?%*:|"<>]/g, '-') // Replace unsafe chars
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .trim()
    .slice(0, 100);                 // Limit length

  return `${inboxFolder}/TASKS FROM EMAIL/${date} - ${safeSubject}.md`;
}

// Utility functions - exported for testing

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function formatDateLong(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function escapeYaml(str: string): string {
  if (!str || str.length === 0) {
    return '""';
  }
  // Check for YAML-problematic patterns
  const needsQuoting =
    /[:#{}[\],&*?|<>=!%@`]/.test(str) ||
    str.includes('\n') ||
    str.includes('"') ||
    str.includes("'") ||
    /^[-|>!&*]/.test(str) ||
    /^(true|false|null|yes|no|on|off)$/i.test(str) ||
    str !== str.trim();

  if (needsQuoting) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return str;
}

export function sanitizeMessageId(id: string): string {
  return id.replace(/[<>]/g, '').replace(/[^a-zA-Z0-9@._-]/g, '_');
}

export function generateMessageId(): string {
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
