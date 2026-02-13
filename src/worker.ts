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
  WORKER_URL: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_IDS: string;
  CF_ZONE_NAMES: string;
  ATTACHMENT_RETENTION_DAYS: string;
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
  body: string; // Markdown-converted body (or excerpt for newsletters)
  rawHtml?: string; // Original HTML for newsletters (used for R2-hosted fallback)
  source: EmailSource;
  attachments: Email['attachments'];
  attachmentUrls: string[];
  isNewsletter: boolean;
  newsletterName: string;
  viewInBrowserUrl: string | null;
  topic?: string;
}

// Initialize Turndown for HTML to Markdown conversion (regular emails)
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// --- Newsletter Topic Classification ---

const NEWSLETTER_TOPIC_MAP: Record<string, string> = {
  // Lowercase newsletter name or email → topic.
  // Static mapping takes priority over keyword detection.
  // 'dense discovery': 'Design',
  // 'tldr': 'Tech',
};

const TOPIC_EMOJI: Record<string, string> = {
  'Tech': '💻',
  'Design': '🎨',
  'News': '📰',
  'Business': '💼',
  'Culture': '🌍',
  'General': '📬',
};

const TOPIC_KEYWORDS: [RegExp, string][] = [
  [/\b(css|design|ux|ui|typography|figma|font|layout|visual)\b/i, 'Design'],
  [/\b(ai|startup|developer|engineer|code|programming|tech|software|api|cloud|saas)\b/i, 'Tech'],
  [/\b(market|financ|econom|invest|revenue|business|strateg)\b/i, 'Business'],
  [/\b(breaking|politic|world|daily briefing|headline|report)\b/i, 'News'],
  [/\b(culture|media|social|community|internet|meme|podcast)\b/i, 'Culture'],
];

const DEFAULT_TOPIC = 'General';
const TOPIC_ORDER = ['Tech', 'Design', 'Business', 'News', 'Culture', 'General'];

/**
 * Detect topic for a newsletter based on static map, then keyword fallback.
 */
export function detectNewsletterTopic(name: string, subject: string): string {
  // Check static map (lowercase name)
  const mapped = NEWSLETTER_TOPIC_MAP[name.toLowerCase()];
  if (mapped) return mapped;

  // Keyword detection on subject
  for (const [pattern, topic] of TOPIC_KEYWORDS) {
    if (pattern.test(subject)) return topic;
  }

  return DEFAULT_TOPIC;
}

/**
 * Get the emoji marker for a topic.
 */
export function getTopicEmoji(topic: string): string {
  return TOPIC_EMOJI[topic] || '📬';
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve newsletter HTML from R2: GET /newsletter/{YYYY-MM-DD}/{slug}.html
    const newsletterMatch = url.pathname.match(/^\/newsletter\/(\d{4}-\d{2}-\d{2})\/(.+\.html)$/);
    if (newsletterMatch && request.method === 'GET') {
      const [, date, filename] = newsletterMatch;
      const r2Key = `_newsletter-html/${date}/${filename}`;
      const object = await env.OBSIDIAN_BUCKET.get(r2Key);
      if (!object) {
        return new Response('Newsletter not found', { status: 404 });
      }
      return new Response(object.body, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Serve attachments from R2: GET /attachment/{messageId}/{filename}
    const attachmentMatch = url.pathname.match(/^\/attachment\/([^/]+)\/(.+)$/);
    if (attachmentMatch && request.method === 'GET') {
      const [, messageId, filename] = attachmentMatch;
      const r2Key = `_attachments/${messageId}/${filename}`;
      const object = await env.OBSIDIAN_BUCKET.get(r2Key);
      if (!object) {
        return new Response('Attachment not found', { status: 404 });
      }
      return new Response(object.body, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
          'Content-Disposition': 'inline',
        },
      });
    }

    return new Response('OK', { status: 200 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(generateEmailRoutingReport(env));
    ctx.waitUntil(purgeOldAttachments(env));
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

      // Newsletter route → digest pipeline (both explicit and header-detected)
      if (route === 'newsletter' || (route === 'inbox' && parsed.isNewsletter)) {
        const readUrl = await saveNewsletterHtml(env, parsed);
        await appendToDigest(env, parsed, readUrl);
        return;
      }

      // Construct attachment URLs before markdown generation (URLs are deterministic)
      if (parsed.attachments && parsed.attachments.length > 0) {
        parsed.attachmentUrls = parsed.attachments.map(att => {
          const safeFilename = sanitizeAttachmentFilename(att.filename || 'untitled');
          return buildAttachmentUrl(env.WORKER_URL, parsed.messageId, safeFilename);
        });
      }

      // Non-newsletter routes: individual file per email
      let markdown: string;
      let filename: string;

      switch (route) {
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
          markdown = generateMarkdown(parsed);
          filename = generateFilename(parsed, env.INBOX_FOLDER || '0 - INBOX');
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
          'email-type': route === 'agent' ? 'agent' : 'email',
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
async function saveAttachment(env: Env, messageId: string, attachment: Email['attachments'][0]): Promise<string> {
  const safeFilename = sanitizeAttachmentFilename(attachment.filename || 'untitled');
  const attachmentPath = `_attachments/${messageId}/${safeFilename}`;

  await env.OBSIDIAN_BUCKET.put(attachmentPath, attachment.content, {
    httpMetadata: {
      contentType: attachment.mimeType,
    },
  });
  console.log(`Saved attachment: ${attachmentPath}`);

  const workerUrl = env.WORKER_URL?.replace(/\/$/, '');
  if (!workerUrl) return attachmentPath;
  return `${workerUrl}/attachment/${messageId}/${safeFilename}`;
}

/**
 * Check if a MIME type is an image type
 */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Build an attachment URL for a given messageId and filename.
 * Returns an HTTP URL if WORKER_URL is set, otherwise a relative path.
 */
export function buildAttachmentUrl(workerUrl: string | undefined, messageId: string, safeFilename: string): string {
  const base = workerUrl?.replace(/\/$/, '');
  if (!base) return `_attachments/${messageId}/${safeFilename}`;
  return `${base}/attachment/${messageId}/${safeFilename}`;
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

  // For newsletters: convert HTML to Markdown via Turndown then extract a
  // short excerpt (~500 chars) for digest entries, and stash rawHtml for
  // the R2-hosted fallback viewer.
  // For other emails: full Turndown conversion as before.
  let body: string;
  let rawHtml: string | undefined;
  let viewInBrowserUrl: string | null = null;

  if (newsletter) {
    viewInBrowserUrl = email.html ? extractViewInBrowserUrl(email.html) : null;
    rawHtml = email.html || undefined;
    const fullBody = convertBodyToMarkdown(email);
    body = extractNewsletterExcerpt(fullBody, 500);
  } else {
    body = convertBodyToMarkdown(email);
  }

  // Detect source from headers
  const source = detectEmailSource(email);

  const newsletterName = newsletter ? extractNewsletterName(email) : '';

  return {
    messageId: sanitizeMessageId(messageId),
    from: fromAddr,
    subject: email.subject || 'No Subject',
    date: emailDate,
    body,
    rawHtml,
    source,
    attachments: email.attachments,
    attachmentUrls: [],
    isNewsletter: newsletter,
    newsletterName,
    viewInBrowserUrl,
    topic: newsletter ? detectNewsletterTopic(newsletterName, email.subject || '') : undefined,
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
 * Extract "view in browser" URL from newsletter HTML.
 * Looks for common link text patterns like "View in browser",
 * "View online", "Read online", "Open in browser", etc.
 */
export function extractViewInBrowserUrl(html: string): string | null {
  const linkPattern = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const textPatterns = /view\s+(this\s+)?(email\s+)?(in\s+)?(your\s+)?(web\s+)?browser|view\s+online|read\s+online|open\s+in\s+browser|view\s+as\s+a?\s*web\s*page/i;

  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]*>/g, '').trim();
    if (textPatterns.test(text)) {
      return href;
    }
  }
  return null;
}

/**
 * Extract a comprehensive excerpt from the newsletter body.
 * Strips footer/unsubscribe boilerplate and truncates at a sentence boundary.
 */
export function extractNewsletterExcerpt(text: string, maxLength: number = 2000): string {
  if (!text) return '';

  // Strip common footer/unsubscribe boilerplate
  let cleaned = text
    .replace(/You(?:'re| are) receiving this[\s\S]*/i, '')
    .replace(/Unsubscribe[\s\S]*/i, '')
    .replace(/Update your preferences[\s\S]*/i, '');

  // Normalize whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  if (cleaned.length <= maxLength) return cleaned;

  // Truncate at a sentence boundary
  const truncated = cleaned.slice(0, maxLength);
  const lastSentence = truncated.lastIndexOf('. ');
  if (lastSentence > maxLength * 0.5) {
    return truncated.slice(0, lastSentence + 1);
  }
  return truncated + '...';
}


// --- Newsletter Digest Functions ---

/**
 * Generate the R2 path for a daily newsletter digest file.
 */
export function generateDigestFilename(date: Date, newsletterFolder: string): string {
  return `${newsletterFolder}/${formatDate(date)} - Newsletter Digest.md`;
}

/**
 * Generate the R2 path for storing a newsletter's raw HTML.
 * Uses `_newsletter-html/` prefix so Remotely Save skips syncing these.
 */
export function generateNewsletterHtmlPath(date: Date, newsletterName: string, subject: string): string {
  const dateStr = formatDate(date);
  const slug = `${newsletterName}-${subject}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `_newsletter-html/${dateStr}/${slug}.html`;
}

/**
 * Render one newsletter section for the daily digest.
 */
export function generateDigestEntry(parsed: ParsedEmail, readUrl: string | null): string {
  const newsletterName = parsed.newsletterName || parsed.from.name;
  const linkLine = readUrl
    ? `[Read full newsletter →](${readUrl})`
    : '';
  const excerptBlock = parsed.body
    ? parsed.body.split('\n').map(line => `> ${line}`).join('\n')
    : '';

  let entry = `### ${newsletterName} — ${parsed.subject}\n**From:** ${parsed.from.email}`;
  if (linkLine) entry += `\n${linkLine}`;
  if (excerptBlock) entry += `\n\n${excerptBlock}`;
  return entry;
}

/**
 * Create the full digest markdown with frontmatter and topic-grouped entries.
 */
export function generateDigestMarkdown(date: Date, entries: string[], emailIds: string[], topics: string[] = []): string {
  const dateStr = formatDate(date);

  // Normalize topics: ensure same length as entries, default to 'General'
  const normalizedTopics = entries.map((_, i) => topics[i] || DEFAULT_TOPIC);

  // Sort all parallel arrays by TOPIC_ORDER so frontmatter and body stay in sync
  const indices = entries.map((_, i) => i);
  indices.sort((a, b) => {
    const orderA = TOPIC_ORDER.indexOf(normalizedTopics[a]);
    const orderB = TOPIC_ORDER.indexOf(normalizedTopics[b]);
    return (orderA === -1 ? TOPIC_ORDER.length : orderA) - (orderB === -1 ? TOPIC_ORDER.length : orderB);
  });

  const sortedEntries = indices.map(i => entries[i]);
  const sortedEmailIds = indices.map(i => emailIds[i]);
  const sortedTopics = indices.map(i => normalizedTopics[i]);

  const frontmatter = `---
tags:
  - newsletter
  - digest
created: ${dateStr}
newsletter_count: ${sortedEntries.length}
email_ids:
${sortedEmailIds.map(id => `  - ${id}`).join('\n')}
email_topics:
${sortedTopics.map(t => `  - ${t}`).join('\n')}
---`;

  // Group sorted entries by topic
  const grouped = new Map<string, string[]>();
  for (let i = 0; i < sortedEntries.length; i++) {
    const topic = sortedTopics[i];
    if (!grouped.has(topic)) grouped.set(topic, []);
    grouped.get(topic)!.push(sortedEntries[i]);
  }

  // Render sections in TOPIC_ORDER, skip empty topics
  const sections: string[] = [];
  for (const topic of TOPIC_ORDER) {
    const topicEntries = grouped.get(topic);
    if (!topicEntries || topicEntries.length === 0) continue;
    const emoji = getTopicEmoji(topic);
    const header = `## ${emoji} ${topic}`;
    const body = topicEntries.join('\n\n---\n\n');
    sections.push(`${header}\n\n${body}`);
  }

  return `${frontmatter}

# Newsletter Digest — ${dateStr}

${sections.join('\n\n')}
`;
}

/**
 * Parse an existing digest to extract entries, email IDs, and topics.
 */
export function parseDigestMarkdown(content: string): { entries: string[]; emailIds: string[]; topics: string[] } {
  // Extract email_ids and email_topics from frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const emailIds: string[] = [];
  const topics: string[] = [];
  if (frontmatterMatch) {
    let currentList: string[] | null = null;
    for (const line of frontmatterMatch[1].split('\n')) {
      if (line.trim() === 'email_ids:') {
        currentList = emailIds;
        continue;
      }
      if (line.trim() === 'email_topics:') {
        currentList = topics;
        continue;
      }
      if (currentList) {
        const itemMatch = line.match(/^\s+-\s+(.+)$/);
        if (itemMatch) {
          currentList.push(itemMatch[1]);
        } else {
          currentList = null;
        }
      }
    }
  }

  // Extract entries from topic-grouped body
  const bodyMatch = content.match(/^# Newsletter Digest — .+\n\n([\s\S]*)$/m);
  const entries: string[] = [];
  const parsedTopics: string[] = [];

  if (bodyMatch) {
    const body = bodyMatch[1];

    // Check if the body uses topic sections (## emoji Topic)
    const hasTopicSections = /^## .+ \S+$/m.test(body);

    if (hasTopicSections) {
      // Parse topic-grouped format: split by ## headers, then by ### entries
      const sectionPattern = /^## .+ (.+)$/gm;
      let match;
      const sectionStarts: { topic: string; index: number }[] = [];

      while ((match = sectionPattern.exec(body)) !== null) {
        sectionStarts.push({ topic: match[1], index: match.index });
      }

      for (let i = 0; i < sectionStarts.length; i++) {
        const start = sectionStarts[i].index;
        const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : body.length;
        const sectionBody = body.slice(start, end);
        const topic = sectionStarts[i].topic;

        // Remove the ## header line, then split entries by ---
        const withoutHeader = sectionBody.replace(/^## .+\n\n/, '');
        const rawEntries = withoutHeader.split('\n\n---\n\n');
        for (const entry of rawEntries) {
          const trimmed = entry.trim();
          if (trimmed) {
            entries.push(trimmed);
            parsedTopics.push(topic);
          }
        }
      }
    } else {
      // Legacy flat format: split by ---
      const rawEntries = body.split('\n\n---\n\n');
      for (const entry of rawEntries) {
        const trimmed = entry.trim();
        if (trimmed) entries.push(trimmed);
      }
    }
  }

  // Use frontmatter topics if available, then parsed topics, then default
  const finalTopics = topics.length > 0
    ? topics
    : parsedTopics.length > 0
      ? parsedTopics
      : entries.map(() => DEFAULT_TOPIC);

  return { entries, emailIds, topics: finalTopics };
}

/**
 * Save the newsletter's full HTML to R2 and return a URL for reading it.
 * If the newsletter already has a "view in browser" URL, returns that directly.
 */
export async function saveNewsletterHtml(env: Env, parsed: ParsedEmail): Promise<string | null> {
  if (parsed.viewInBrowserUrl) {
    return parsed.viewInBrowserUrl;
  }
  if (!parsed.rawHtml) {
    return null;
  }

  const htmlPath = generateNewsletterHtmlPath(parsed.date, parsed.newsletterName || parsed.from.name, parsed.subject);
  await env.OBSIDIAN_BUCKET.put(htmlPath, parsed.rawHtml, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  const workerUrl = env.WORKER_URL?.replace(/\/$/, '');
  if (!workerUrl) return null;
  return `${workerUrl}/newsletter/${formatDate(parsed.date)}/${htmlPath.split('/').pop()}`;
}

/**
 * Append a newsletter entry to the daily digest (read-modify-write).
 * Creates the digest if it doesn't exist yet; deduplicates by email ID.
 */
export async function appendToDigest(env: Env, parsed: ParsedEmail, readUrl: string | null): Promise<void> {
  const newsletterFolder = env.NEWSLETTER_FOLDER || '0 - INBOX/NEWSLETTERS';
  const digestPath = generateDigestFilename(parsed.date, newsletterFolder);

  // Read existing digest (or start fresh)
  const existing = await env.OBSIDIAN_BUCKET.get(digestPath);
  let entries: string[] = [];
  let emailIds: string[] = [];
  let topics: string[] = [];

  if (existing) {
    const content = await existing.text();
    const parsed_digest = parseDigestMarkdown(content);
    entries = parsed_digest.entries;
    emailIds = parsed_digest.emailIds;
    topics = parsed_digest.topics;
  }

  // Dedup check
  if (emailIds.includes(parsed.messageId)) {
    console.log(`Digest dedup: ${parsed.messageId} already in digest`);
    return;
  }

  // Append new entry
  const newEntry = generateDigestEntry(parsed, readUrl);
  entries.push(newEntry);
  emailIds.push(parsed.messageId);
  topics.push(parsed.topic || DEFAULT_TOPIC);

  // Write back
  const markdown = generateDigestMarkdown(parsed.date, entries, emailIds, topics);
  await env.OBSIDIAN_BUCKET.put(digestPath, markdown, {
    httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
    customMetadata: {
      'report-type': 'newsletter-digest',
      'newsletter-count': String(entries.length),
      'created': new Date().toISOString(),
    },
  });

  console.log(`Digest updated: ${parsed.messageId} → ${digestPath} (${entries.length} entries)`);
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
      .map((att, i) => {
        const filename = att.filename || 'untitled';
        const url = email.attachmentUrls[i] || `_attachments/${email.messageId}/${sanitizeAttachmentFilename(filename)}`;
        if (isImageMimeType(att.mimeType)) {
          return `- ![${filename}](${url})`;
        }
        return `- [${filename}](${url})`;
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
      .map((att, i) => {
        const filename = att.filename || 'untitled';
        const url = email.attachmentUrls[i] || `_attachments/${email.messageId}/${sanitizeAttachmentFilename(filename)}`;
        if (isImageMimeType(att.mimeType)) {
          return `- ![${filename}](${url})`;
        }
        return `- [${filename}](${url})`;
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

// --- Attachment Purge (Cron) ---

/**
 * Purge attachments older than ATTACHMENT_RETENTION_DAYS.
 * Lists all objects under `_attachments/`, groups by messageId folder,
 * and deletes folders where all objects are older than the retention period.
 */
async function purgeOldAttachments(env: Env): Promise<void> {
  const retentionDays = parseInt(env.ATTACHMENT_RETENTION_DAYS || '90', 10);
  if (retentionDays <= 0) {
    console.log('Attachment purge: disabled (retention days <= 0)');
    return;
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  console.log(`Attachment purge: removing attachments older than ${retentionDays} days (before ${cutoff.toISOString()})`);

  let cursor: string | undefined;
  let totalDeleted = 0;
  const keysToDelete: string[] = [];

  // Paginate through all _attachments/ objects
  do {
    const listResult = await env.OBSIDIAN_BUCKET.list({
      prefix: '_attachments/',
      cursor,
    });

    for (const object of listResult.objects) {
      if (object.uploaded < cutoff) {
        keysToDelete.push(object.key);
      }
    }

    cursor = listResult.truncated ? listResult.cursor : undefined;
  } while (cursor);

  // Delete in batches (R2 delete supports single keys)
  for (const key of keysToDelete) {
    await env.OBSIDIAN_BUCKET.delete(key);
    totalDeleted++;
  }

  if (totalDeleted > 0) {
    console.log(`Attachment purge: deleted ${totalDeleted} expired attachments`);
  } else {
    console.log('Attachment purge: no expired attachments found');
  }
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

  const totalEvents = allEvents.reduce((sum, z) => sum + z.events.length, 0);
  const totalFailures = allEvents.reduce(
    (sum, z) => sum + z.events.filter(e => e.status !== 'delivered').length, 0,
  );

  if (totalEvents === 0 && totalFailures === 0) {
    console.log('Email routing report: no events in the last 24h, skipping write');
    return;
  }

  if (totalFailures === 0) {
    console.log(`Email routing report: ${totalEvents} events, all delivered, skipping write`);
    return;
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
