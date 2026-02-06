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
  NEWSLETTER_FOLDER: string;
  AGENT_FOLDER: string;
  FORWARD_TO: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_IDS: string;
  CF_ZONE_NAMES: string;
}

export type EmailSource = 'gmail' | 'outlook' | 'icloud' | 'unknown';

/**
 * Route determined by the recipient address local part.
 * Each address maps to a distinct processing pipeline.
 */
export type EmailRoute = 'task' | 'newsletter' | 'agent' | 'inbox';

/**
 * Extract the email route from the recipient address.
 * The local part (before @) determines which pipeline to use:
 *   email-to-obsidian → task
 *   newsletters/newsletter → newsletter
 *   claude → agent
 *   anything else (including inbox) → inbox (catch-all)
 */
export function extractRoute(toAddress: string): EmailRoute {
  const localPart = toAddress.split('@')[0].toLowerCase();
  switch (localPart) {
    case 'email-to-obsidian': return 'task';
    case 'newsletters':
    case 'newsletter':        return 'newsletter';
    case 'claude':            return 'agent';
    default:                  return 'inbox';
  }
}

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
  isNewsletter: boolean;
  newsletterName: string;
}

// Initialize Turndown for HTML to Markdown conversion (regular emails)
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Newsletter-specific Turndown instance with rules for complex HTML layouts
const newsletterTurndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Newsletter HTML uses <table> for layout, not data.
// Override each table sub-element to strip layout formatting
// and extract content as plain paragraphs.
newsletterTurndownService.addRule('tableCell', {
  filter: ['td', 'th'],
  replacement: function (content) {
    return content.trim() ? content.trim() + '\n\n' : '';
  },
});

newsletterTurndownService.addRule('tableRow', {
  filter: 'tr',
  replacement: function (content) {
    return content.trim() + '\n';
  },
});

newsletterTurndownService.addRule('tableSection', {
  filter: ['thead', 'tbody', 'tfoot'],
  replacement: function (content) {
    return content;
  },
});

newsletterTurndownService.addRule('layoutTable', {
  filter: 'table',
  replacement: function (content) {
    return '\n\n' + content.trim() + '\n\n';
  },
});

// Strip tracking pixels (1x1 or very small images)
newsletterTurndownService.addRule('trackingPixel', {
  filter: function (node) {
    if (node.nodeName !== 'IMG') return false;
    const w = node.getAttribute('width');
    const h = node.getAttribute('height');
    return (w === '1' || h === '1' || w === '0' || h === '0');
  },
  replacement: function () { return ''; },
});

// Strip common tracking/spacer images by domain patterns
newsletterTurndownService.addRule('trackerImage', {
  filter: function (node) {
    if (node.nodeName !== 'IMG') return false;
    const src = (node.getAttribute('src') || '').toLowerCase();
    const trackerPatterns = [
      'open.substack.com', 'pixel.', 'track.', 'beacon.',
      'email.mg.', '/o.gif', '/t.gif', '/spacer',
      'list-manage.com/track',
    ];
    return trackerPatterns.some(p => src.includes(p));
  },
  replacement: function () { return ''; },
});

// Convert styled CTA buttons to plain links
newsletterTurndownService.addRule('ctaButton', {
  filter: function (node) {
    if (node.nodeName !== 'A') return false;
    // Buttons typically have background-color styling or contain block elements
    const style = node.getAttribute('style') || '';
    return style.includes('background-color') || style.includes('background:');
  },
  replacement: function (content, node) {
    const href = node.getAttribute('href') || '';
    const text = content.trim().replace(/\n/g, ' ') || 'Link';
    if (!href) return text;
    return `[${text}](${href})`;
  },
});

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(generateEmailRoutingReport(env));
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      // Forward unconditionally for audit trail (before any processing)
      if (env.FORWARD_TO) {
        try {
          await message.forward(env.FORWARD_TO);
          console.log(`Audit copy forwarded to ${env.FORWARD_TO}`);
        } catch (fwdError) {
          console.warn('Failed to forward audit copy:', fwdError);
        }
      }

      // Determine route from recipient address
      const route = extractRoute(message.to);
      console.log(`Processing email to ${message.to} — route: ${route}`);

      // Parse the incoming email (route determines which Turndown service to use)
      const parsed = await parseEmail(message, route);

      // Route to the correct pipeline
      let markdown: string;
      let filename: string;

      switch (route) {
        case 'newsletter':
          markdown = generateNewsletterMarkdown(parsed);
          filename = generateNewsletterFilename(parsed, env.NEWSLETTER_FOLDER || '0 - INBOX/NEWSLETTERS');
          break;
        case 'agent':
          markdown = generateAgentMessageMarkdown(parsed);
          filename = generateAgentMessageFilename(parsed, env.AGENT_FOLDER || '0 - INBOX/AGENT MESSAGES');
          break;
        case 'task':
          markdown = generateMarkdown(parsed);
          filename = generateFilename(parsed, env.INBOX_FOLDER || '0 - INBOX');
          break;
        case 'inbox':
        default:
          // Catch-all: fall back to header-based detection
          if (parsed.isNewsletter) {
            markdown = generateNewsletterMarkdown(parsed);
            filename = generateNewsletterFilename(parsed, env.NEWSLETTER_FOLDER || '0 - INBOX/NEWSLETTERS');
          } else {
            markdown = generateMarkdown(parsed);
            filename = generateFilename(parsed, env.INBOX_FOLDER || '0 - INBOX');
          }
          break;
      }

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
          'email-route': route,
          'email-type': parsed.isNewsletter ? 'newsletter' : (route === 'agent' ? 'agent' : 'email'),
          'created': new Date().toISOString(),
        },
      });

      console.log(`[${route}] Note created: ${parsed.messageId} → ${filename}`);

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
 * Parse email using postal-mime library.
 * The route parameter determines which Turndown service to use:
 *   - 'newsletter' route → always newsletter Turndown (layout tables, tracker removal)
 *   - 'inbox' route → detect via List-Unsubscribe header, then pick Turndown
 *   - 'task' / 'agent' → standard Turndown
 */
async function parseEmail(message: ForwardableEmailMessage, route: EmailRoute = 'inbox'): Promise<ParsedEmail> {
  // Parse with postal-mime - it handles ReadableStream directly
  const email: Email = await PostalMime.parse(message.raw);

  // Extract from address
  const fromAddr = extractFromAddress(email);

  // Get message ID from headers or generate one
  const messageId = email.messageId || generateMessageId();

  // Parse date
  const emailDate = email.date ? new Date(email.date) : new Date();

  // Determine newsletter status based on route:
  //   - 'newsletter' route → always a newsletter (address is the signal)
  //   - 'inbox' catch-all → detect via List-Unsubscribe header
  //   - other routes → not a newsletter
  const newsletter = route === 'newsletter' || (route === 'inbox' && isNewsletter(email));

  // Convert body to markdown — use newsletter Turndown for newsletter content
  const body = newsletter
    ? convertNewsletterBodyToMarkdown(email)
    : convertBodyToMarkdown(email);

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
    isNewsletter: newsletter,
    newsletterName: newsletter ? extractNewsletterName(email) : '',
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
 * Detect if an email is a newsletter via List-Unsubscribe header (RFC 2369).
 * This header is present in virtually all bulk email and is required by
 * Gmail/Yahoo for bulk senders since Feb 2024.
 */
export function isNewsletter(email: Email): boolean {
  return email.headers.some(h => h.key.toLowerCase() === 'list-unsubscribe');
}

/**
 * Extract a human-readable newsletter name from sender info.
 * Prefers the display name (e.g., "Design Weekly"), falls back to
 * the local part of the email address.
 */
export function extractNewsletterName(email: Email): string {
  if (email.from && 'name' in email.from && email.from.name) {
    return email.from.name;
  }
  if (email.from && 'address' in email.from && email.from.address) {
    return email.from.address.split('@')[0];
  }
  return 'Unknown Newsletter';
}

/**
 * Convert newsletter HTML body to Markdown using newsletter-specific
 * Turndown rules (layout table extraction, tracker stripping, etc.)
 */
function convertNewsletterBodyToMarkdown(email: Email): string {
  if (email.html) {
    try {
      let html = email.html;
      // Strip unsubscribe footer sections before conversion
      html = stripUnsubscribeFooter(html);
      return newsletterTurndownService.turndown(html);
    } catch (error) {
      console.warn('Failed to convert newsletter HTML to Markdown, using text fallback:', error);
    }
  }

  if (email.text) {
    return email.text;
  }

  return '*No newsletter content*';
}

/**
 * Strip common unsubscribe footer patterns from HTML.
 * Removes the footer section while preserving the main content.
 */
function stripUnsubscribeFooter(html: string): string {
  // Remove common footer patterns — these are heuristic and will improve over time
  const footerPatterns = [
    // Mailchimp/ConvertKit style footers
    /<div[^>]*class="?footer"?[^>]*>[\s\S]*$/i,
    // Common unsubscribe text blocks at the end
    /<p[^>]*>\s*(?:You(?:'re| are) receiving this|Unsubscribe|Update your preferences|View in browser)[\s\S]*$/i,
  ];

  let cleaned = html;
  for (const pattern of footerPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

/**
 * Generate newsletter-specific markdown (no tasks section, newsletter metadata)
 */
export function generateNewsletterMarkdown(email: ParsedEmail): string {
  const createdDate = formatDate(email.date);
  const fullDate = formatDateLong(email.date);
  const newsletterName = email.newsletterName || email.from.name;

  return `---
tags:
  - newsletter
created: ${createdDate}
from: ${email.from.email}
newsletter_name: ${escapeYaml(newsletterName)}
subject: ${escapeYaml(email.subject)}
email_id: ${email.messageId}
source: ${email.source}
status: unprocessed
---

## ${newsletterName} — ${email.subject}

**From:** ${email.from.name} <${email.from.email}>
**Date:** ${fullDate}

---

${email.body}
`;
}

/**
 * Generate filename for newsletter notes.
 * Uses newsletter name prefix for better sorting in Obsidian.
 */
export function generateNewsletterFilename(email: ParsedEmail, newsletterFolder: string): string {
  const date = formatDate(email.date);
  const newsletterName = email.newsletterName || email.from.name;

  // Clean newsletter name and subject for filename
  const safeName = newsletterName
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

  const safeSubject = email.subject
    .replace(/^(\[fwd:?\]|fwd:?)\s*/i, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return `${newsletterFolder}/${date} - ${safeName} - ${safeSubject}.md`;
}

/**
 * Generate agent message markdown (no tasks section, agent metadata).
 * Messages sent to claude@* are captured for Phase 2 agent processing.
 */
export function generateAgentMessageMarkdown(email: ParsedEmail): string {
  const createdDate = formatDate(email.date);
  const fullDate = formatDateLong(email.date);

  let attachmentsSection = '';
  if (email.attachments && email.attachments.length > 0) {
    const attachmentLinks = email.attachments
      .map(att => {
        const safeFilename = sanitizeAttachmentFilename(att.filename || 'untitled');
        const attachmentPath = `_attachments/${email.messageId}/${safeFilename}`;
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
  - agent-message
created: ${createdDate}
from: ${email.from.email}
subject: ${escapeYaml(email.subject)}
email_id: ${email.messageId}
source: ${email.source}
status: pending
---

## Agent Message

**From:** ${email.from.name} <${email.from.email}>
**Date:** ${fullDate}

---

${email.body}

${attachmentsSection}`;
}

/**
 * Generate filename for agent messages.
 * Pattern: {AGENT_FOLDER}/{date} - {subject}.md
 */
export function generateAgentMessageFilename(email: ParsedEmail, agentFolder: string): string {
  const date = formatDate(email.date);

  const safeSubject = email.subject
    .replace(/^(\[fwd:?\]|fwd:?)\s*/i, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

  return `${agentFolder}/${date} - ${safeSubject}.md`;
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

// --- Email Routing Report (Cron) ---

interface EmailRoutingEvent {
  datetime: string;
  eventType: string;
  action: string;
  status: string;
  subject: string;
  errorDetail: string;
  from: string;
  to: string;
  isNDR: number;
  isSpam: number;
  spf: string;
  dkim: string;
  dmarc: string;
}

interface GraphQLResponse {
  data: {
    viewer: {
      zones: Array<{
        emailRoutingAdaptive: EmailRoutingEvent[];
      }>;
    };
  } | null;
  errors: Array<{ message: string }> | null;
}

/**
 * Query the Cloudflare GraphQL Analytics API for email routing events
 * across all configured zones and write a daily digest to R2.
 */
async function generateEmailRoutingReport(env: Env): Promise<void> {
  if (!env.CF_API_TOKEN || !env.CF_ZONE_IDS) {
    console.error('Email routing report: missing CF_API_TOKEN or CF_ZONE_IDS');
    return;
  }

  const zoneIds = env.CF_ZONE_IDS.split(',');
  const zoneNames = (env.CF_ZONE_NAMES || '').split(',');
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dateStr = formatDate(now);

  const allEvents: Array<{ zone: string; events: EmailRoutingEvent[] }> = [];

  for (let i = 0; i < zoneIds.length; i++) {
    const zoneId = zoneIds[i].trim();
    const zoneName = zoneNames[i]?.trim() || zoneId;

    try {
      const events = await queryEmailRoutingLogs(env, zoneId, yesterday, now);
      allEvents.push({ zone: zoneName, events });
    } catch (err) {
      console.error(`Failed to query zone ${zoneName}:`, err);
      allEvents.push({ zone: zoneName, events: [] });
    }
  }

  const markdown = buildReportMarkdown(allEvents, dateStr, yesterday, now);

  const filename = `0 - INBOX/EMAIL ROUTING REPORTS/${dateStr} - Email Routing Report.md`;
  await env.OBSIDIAN_BUCKET.put(filename, markdown, {
    httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
    customMetadata: { 'report-type': 'email-routing', 'created': now.toISOString() },
  });

  console.log(`Email routing report written: ${filename}`);
}

async function queryEmailRoutingLogs(
  env: Env,
  zoneId: string,
  since: Date,
  until: Date,
): Promise<EmailRoutingEvent[]> {
  const query = `{
    viewer {
      zones(filter: { zoneTag: "${zoneId}" }) {
        emailRoutingAdaptive(
          limit: 200,
          orderBy: [datetime_DESC],
          filter: {
            datetime_gt: "${since.toISOString()}",
            datetime_lt: "${until.toISOString()}"
          }
        ) {
          datetime eventType action status subject errorDetail
          from to isNDR isSpam spf dkim dmarc
        }
      }
    }
  }`;

  const resp = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const json = await resp.json() as GraphQLResponse;

  if (json.errors) {
    throw new Error(json.errors.map(e => e.message).join('; '));
  }

  return json.data?.viewer?.zones?.[0]?.emailRoutingAdaptive ?? [];
}

function buildReportMarkdown(
  allEvents: Array<{ zone: string; events: EmailRoutingEvent[] }>,
  dateStr: string,
  since: Date,
  until: Date,
): string {
  const totalEvents = allEvents.reduce((sum, z) => sum + z.events.length, 0);
  const totalFailures = allEvents.reduce(
    (sum, z) => sum + z.events.filter(e => e.status !== 'delivered').length, 0,
  );
  const totalDelivered = totalEvents - totalFailures;

  let md = `---
tags:
  - email-routing
  - report
created: ${dateStr}
report_period: ${formatDate(since)} to ${formatDate(until)}
total_events: ${totalEvents}
total_delivered: ${totalDelivered}
total_failures: ${totalFailures}
---

# Email Routing Report — ${dateStr}

**Period:** ${since.toISOString().slice(0, 16)}Z to ${until.toISOString().slice(0, 16)}Z
**Total:** ${totalEvents} events | ${totalDelivered} delivered | ${totalFailures} failed

`;

  for (const { zone, events } of allEvents) {
    const failures = events.filter(e => e.status !== 'delivered');
    const delivered = events.length - failures.length;

    md += `## ${zone}\n\n`;
    md += `${events.length} events — ${delivered} delivered, ${failures.length} failed\n\n`;

    if (failures.length > 0) {
      md += `### Failures\n\n`;
      md += `| Time | From | To | Subject | Error |\n`;
      md += `|------|------|----|---------|-------|\n`;

      for (const f of failures) {
        const time = f.datetime.slice(11, 16);
        const from = f.from.replace(/\|/g, '/');
        const subj = f.subject.slice(0, 50).replace(/\|/g, '/');
        // Extract the key reason from the verbose error
        const errorBrief = extractErrorBrief(f.errorDetail);
        md += `| ${time} | ${from} | ${f.to} | ${subj} | ${errorBrief} |\n`;
      }
      md += '\n';
    }

    if (events.length > 0 && delivered > 0) {
      md += `### Delivered\n\n`;
      for (const e of events.filter(ev => ev.status === 'delivered').slice(0, 20)) {
        const time = e.datetime.slice(11, 16);
        md += `- **${time}** ${e.from} → ${e.to} — ${e.subject}\n`;
      }
      if (delivered > 20) {
        md += `- ... and ${delivered - 20} more\n`;
      }
      md += '\n';
    }
  }

  return md;
}

/**
 * Extract a short, readable reason from verbose SMTP error details.
 */
function extractErrorBrief(detail: string): string {
  if (!detail) return 'Unknown';
  if (detail.includes('low reputation')) return 'Low domain reputation';
  if (detail.includes('rate limited') || detail.includes('RateLimitError')) return 'Rate limited (spam)';
  if (detail.includes('exceeded its quota')) return 'Message-ID quota exceeded';
  if (detail.includes('suspicious')) return 'Suspicious message';
  if (detail.includes('rejected')) return 'Rejected by upstream';
  // Fallback: first 60 chars
  return detail.slice(0, 60).replace(/\|/g, '/');
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
