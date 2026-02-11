/**
 * Unit tests for Email Worker pure functions
 */

import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatDateLong,
  escapeYaml,
  sanitizeMessageId,
  generateMessageId,
  generateFilename,
  generateMarkdown,
  detectEmailSource,
  isNewsletter,
  isImageMimeType,
  buildAttachmentUrl,
  extractNewsletterName,
  extractViewInBrowserUrl,
  extractNewsletterExcerpt,
  generateDigestFilename,
  generateNewsletterHtmlPath,
  generateDigestEntry,
  generateDigestMarkdown,
  parseDigestMarkdown,
  extractRoute,
  generateAgentMessageMarkdown,
  generateAgentMessageFilename,
  type ParsedEmail,
  type EmailSource,
  type EmailRoute,
} from './worker';
import {
  createMockEmail,
  createGmailEmail,
  createOutlookEmail,
  createICloudEmail,
  createNewsletterEmail,
  createAgentMessageEmail,
  createParsedEmail,
} from './test-utils/email-fixtures';

describe('formatDate', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date('2025-01-15T10:30:00Z');
    expect(formatDate(date)).toBe('2025-01-15');
  });

  it('handles different dates correctly', () => {
    expect(formatDate(new Date('2024-12-01T00:00:00Z'))).toBe('2024-12-01');
    expect(formatDate(new Date('2023-06-30T23:59:59Z'))).toBe('2023-06-30');
  });
});

describe('formatDateLong', () => {
  it('formats date in long format', () => {
    const date = new Date('2025-01-15T10:30:00Z');
    const result = formatDateLong(date);
    expect(result).toContain('2025');
    expect(result).toContain('January');
    expect(result).toContain('15');
  });
});

describe('escapeYaml', () => {
  it('returns empty string quoted', () => {
    expect(escapeYaml('')).toBe('""');
  });

  it('returns plain strings unchanged', () => {
    expect(escapeYaml('Hello World')).toBe('Hello World');
    expect(escapeYaml('Simple subject line')).toBe('Simple subject line');
  });

  it('quotes strings with special characters', () => {
    expect(escapeYaml('Meeting: Tomorrow')).toBe('"Meeting: Tomorrow"');
    expect(escapeYaml('Question? Answer!')).toBe('"Question? Answer!"');
    expect(escapeYaml('Price: $100')).toBe('"Price: $100"');
  });

  it('handles YAML reserved words', () => {
    expect(escapeYaml('true')).toBe('"true"');
    expect(escapeYaml('false')).toBe('"false"');
    expect(escapeYaml('null')).toBe('"null"');
    expect(escapeYaml('yes')).toBe('"yes"');
    expect(escapeYaml('no')).toBe('"no"');
    expect(escapeYaml('on')).toBe('"on"');
    expect(escapeYaml('off')).toBe('"off"');
  });

  it('handles leading special characters', () => {
    expect(escapeYaml('- List item')).toBe('"- List item"');
    expect(escapeYaml('> Quote')).toBe('"> Quote"');
    expect(escapeYaml('| Pipe')).toBe('"| Pipe"');
    expect(escapeYaml('* Star')).toBe('"* Star"');
  });

  it('handles whitespace issues', () => {
    expect(escapeYaml(' leading space')).toBe('" leading space"');
    expect(escapeYaml('trailing space ')).toBe('"trailing space "');
  });

  it('escapes quotes within strings', () => {
    expect(escapeYaml('He said "hello"')).toBe('"He said \\"hello\\""');
  });

  it('escapes backslashes when string needs quoting', () => {
    // Backslashes alone don't trigger quoting, but when combined with
    // a character that does (like colon), they get escaped
    expect(escapeYaml('path: c:\\temp')).toBe('"path: c:\\\\temp"');
  });

  it('leaves backslashes alone in simple strings', () => {
    // Backslashes by themselves don't need quoting in YAML
    expect(escapeYaml('path\\to\\file')).toBe('path\\to\\file');
  });
});

describe('sanitizeMessageId', () => {
  it('removes angle brackets', () => {
    expect(sanitizeMessageId('<abc@example.com>')).toBe('abc@example.com');
  });

  it('replaces invalid characters with underscores', () => {
    expect(sanitizeMessageId('abc/def')).toBe('abc_def');
    expect(sanitizeMessageId('abc def')).toBe('abc_def');
    expect(sanitizeMessageId('abc+def')).toBe('abc_def');
  });

  it('preserves valid characters', () => {
    expect(sanitizeMessageId('abc123@example.com')).toBe('abc123@example.com');
    expect(sanitizeMessageId('test-id_123.abc')).toBe('test-id_123.abc');
  });
});

describe('generateMessageId', () => {
  it('generates unique IDs', () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();
    expect(id1).not.toBe(id2);
  });

  it('generates IDs with timestamp prefix', () => {
    const id = generateMessageId();
    const parts = id.split('-');
    expect(parts.length).toBe(2);
    expect(Number(parts[0])).toBeGreaterThan(0);
  });
});

describe('generateFilename', () => {
  it('generates correct filename format with TASKS FROM EMAIL subfolder', () => {
    const email = createParsedEmail({
      subject: 'Test Subject',
      date: new Date('2025-01-15T10:30:00Z'),
    });
    const filename = generateFilename(email, '0 - INBOX');
    expect(filename).toBe('0 - INBOX/TASKS FROM EMAIL/2025-01-15 - Test Subject.md');
  });

  it('sanitizes unsafe characters in subject', () => {
    const email = createParsedEmail({
      subject: 'Test/Subject:With<Special>Chars',
      date: new Date('2025-01-15T10:30:00Z'),
    });
    const filename = generateFilename(email, 'INBOX');
    expect(filename).toBe('INBOX/TASKS FROM EMAIL/2025-01-15 - Test-Subject-With-Special-Chars.md');
  });

  it('normalizes whitespace', () => {
    const email = createParsedEmail({
      subject: 'Too   many   spaces',
      date: new Date('2025-01-15T10:30:00Z'),
    });
    const filename = generateFilename(email, 'INBOX');
    expect(filename).toBe('INBOX/TASKS FROM EMAIL/2025-01-15 - Too many spaces.md');
  });

  it('truncates long subjects to 100 chars', () => {
    const longSubject = 'A'.repeat(150);
    const email = createParsedEmail({
      subject: longSubject,
      date: new Date('2025-01-15T10:30:00Z'),
    });
    const filename = generateFilename(email, 'INBOX');
    // folder/ + TASKS FROM EMAIL/ + date + " - " + subject (max 100) + .md
    const expectedMax = 'INBOX/'.length + 'TASKS FROM EMAIL/'.length + 10 + 3 + 100 + 3;
    expect(filename.length).toBeLessThanOrEqual(expectedMax);
  });
});

describe('generateMarkdown', () => {
  it('generates markdown with YAML frontmatter', () => {
    const email = createParsedEmail({
      messageId: 'test-123',
      from: { name: 'John Doe', email: 'john@example.com' },
      subject: 'Test Email',
      date: new Date('2025-01-15T10:30:00Z'),
      body: 'Email body content',
      source: 'gmail',
    });

    const markdown = generateMarkdown(email);

    expect(markdown).toContain('---');
    expect(markdown).toContain('tags:');
    expect(markdown).toContain('- all');
    expect(markdown).toContain('- email-task');
    expect(markdown).toContain('created: 2025-01-15');
    expect(markdown).toContain('from: john@example.com');
    expect(markdown).toContain('subject: Test Email');
    expect(markdown).toContain('email_id: test-123');
    expect(markdown).toContain('source: gmail');
  });

  it('includes task section', () => {
    const email = createParsedEmail();
    const markdown = generateMarkdown(email);

    expect(markdown).toContain('## Tasks in this note');
    expect(markdown).toContain('- [ ] Review and process this email');
  });

  it('includes email content section', () => {
    const email = createParsedEmail({
      from: { name: 'Jane Smith', email: 'jane@test.com' },
      subject: 'Important Meeting',
      body: 'Please attend the meeting.',
    });

    const markdown = generateMarkdown(email);

    expect(markdown).toContain('## Email');
    expect(markdown).toContain('**From:** Jane Smith <jane@test.com>');
    expect(markdown).toContain('**Subject:** Important Meeting');
    expect(markdown).toContain('Please attend the meeting.');
  });

  it('includes notes section', () => {
    const email = createParsedEmail();
    const markdown = generateMarkdown(email);

    expect(markdown).toContain('## Notes');
  });

  it('escapes YAML-problematic subjects', () => {
    const email = createParsedEmail({
      subject: 'Meeting: Tomorrow at 3pm',
    });

    const markdown = generateMarkdown(email);
    expect(markdown).toContain('subject: "Meeting: Tomorrow at 3pm"');
  });
});

describe('detectEmailSource', () => {
  it('detects Gmail from x-gm-message-state header', () => {
    const email = createGmailEmail();
    expect(detectEmailSource(email)).toBe('gmail');
  });

  it('detects Outlook from x-ms-exchange-organization-authas header', () => {
    const email = createOutlookEmail();
    expect(detectEmailSource(email)).toBe('outlook');
  });

  it('detects Outlook from x-microsoft-antispam header', () => {
    const email = createMockEmail({
      headers: [{ key: 'x-microsoft-antispam', value: 'BCL:0' }],
    });
    expect(detectEmailSource(email)).toBe('outlook');
  });

  it('detects iCloud from received header containing apple.com', () => {
    const email = createICloudEmail();
    expect(detectEmailSource(email)).toBe('icloud');
  });

  it('detects iCloud from received header containing icloud.com', () => {
    const email = createMockEmail({
      headers: [{ key: 'received', value: 'from p01-smtp.mail.icloud.com' }],
    });
    expect(detectEmailSource(email)).toBe('icloud');
  });

  it('returns unknown for unrecognized sources', () => {
    const email = createMockEmail({
      headers: [{ key: 'x-custom-header', value: 'some-value' }],
    });
    expect(detectEmailSource(email)).toBe('unknown');
  });

  it('does NOT match other x-ms-exchange headers (exact match only)', () => {
    const email = createMockEmail({
      headers: [{ key: 'x-ms-exchange-something-else', value: 'value' }],
    });
    // Should NOT detect as Outlook because we only match the exact header
    expect(detectEmailSource(email)).toBe('unknown');
  });
});

// --- Newsletter Detection ---

describe('isNewsletter', () => {
  it('detects newsletter via List-Unsubscribe header', () => {
    const email = createNewsletterEmail();
    expect(isNewsletter(email)).toBe(true);
  });

  it('detects newsletter with case-insensitive header matching', () => {
    const email = createMockEmail({
      headers: [{ key: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
    });
    expect(isNewsletter(email)).toBe(true);
  });

  it('returns false for regular emails without List-Unsubscribe', () => {
    const email = createMockEmail();
    expect(isNewsletter(email)).toBe(false);
  });

  it('returns false for Gmail emails without List-Unsubscribe', () => {
    const email = createGmailEmail();
    expect(isNewsletter(email)).toBe(false);
  });
});

describe('extractNewsletterName', () => {
  it('extracts name from sender display name', () => {
    const email = createNewsletterEmail({
      from: { name: 'Design Weekly', address: 'hello@designweekly.com' },
    });
    expect(extractNewsletterName(email)).toBe('Design Weekly');
  });

  it('falls back to email local part when no display name', () => {
    const email = createNewsletterEmail({
      from: { address: 'newsletter@substack.com' },
    });
    expect(extractNewsletterName(email)).toBe('newsletter');
  });

  it('handles various newsletter sender formats', () => {
    const email = createNewsletterEmail({
      from: { name: 'The Morning Brew ☕', address: 'crew@morningbrew.com' },
    });
    expect(extractNewsletterName(email)).toBe('The Morning Brew ☕');
  });
});

describe('extractViewInBrowserUrl', () => {
  it('extracts URL from "View in browser" link', () => {
    const html = '<p><a href="https://example.com/view/123">View in browser</a></p><p>Content</p>';
    expect(extractViewInBrowserUrl(html)).toBe('https://example.com/view/123');
  });

  it('extracts URL from "View this email in your browser" link', () => {
    const html = '<a href="https://example.com/view/456">View this email in your browser</a>';
    expect(extractViewInBrowserUrl(html)).toBe('https://example.com/view/456');
  });

  it('extracts URL from "View online" link', () => {
    const html = '<a href="https://example.com/online">View online</a>';
    expect(extractViewInBrowserUrl(html)).toBe('https://example.com/online');
  });

  it('extracts URL from "Read online" link', () => {
    const html = '<a href="https://example.com/read">Read online</a>';
    expect(extractViewInBrowserUrl(html)).toBe('https://example.com/read');
  });

  it('extracts URL from "Open in browser" link', () => {
    const html = '<a href="https://example.com/open">Open in browser</a>';
    expect(extractViewInBrowserUrl(html)).toBe('https://example.com/open');
  });

  it('is case-insensitive', () => {
    const html = '<a href="https://example.com/view">VIEW IN BROWSER</a>';
    expect(extractViewInBrowserUrl(html)).toBe('https://example.com/view');
  });

  it('handles nested HTML inside the link', () => {
    const html = '<a href="https://example.com/view"><span style="color:blue">View in browser</span></a>';
    expect(extractViewInBrowserUrl(html)).toBe('https://example.com/view');
  });

  it('returns null when no matching link exists', () => {
    const html = '<a href="https://example.com">Click here</a>';
    expect(extractViewInBrowserUrl(html)).toBeNull();
  });

  it('returns null for empty HTML', () => {
    expect(extractViewInBrowserUrl('')).toBeNull();
  });
});

describe('extractNewsletterExcerpt', () => {
  it('returns full text when under maxLength', () => {
    expect(extractNewsletterExcerpt('Short text.')).toBe('Short text.');
  });

  it('truncates long text at sentence boundary', () => {
    const text = 'First sentence. Second sentence. ' + 'A'.repeat(500);
    const excerpt = extractNewsletterExcerpt(text, 50);
    expect(excerpt).toBe('First sentence. Second sentence.');
  });

  it('adds ellipsis when no sentence boundary found', () => {
    const text = 'A'.repeat(600);
    const excerpt = extractNewsletterExcerpt(text, 500);
    expect(excerpt).toBe('A'.repeat(500) + '...');
  });

  it('strips unsubscribe footer boilerplate', () => {
    const text = 'Real content here.\n\nUnsubscribe from this list.';
    expect(extractNewsletterExcerpt(text)).toBe('Real content here.');
  });

  it('strips "you are receiving this" footer', () => {
    const text = "Content.\n\nYou're receiving this because you signed up.";
    expect(extractNewsletterExcerpt(text)).toBe('Content.');
  });

  it('returns empty string for empty input', () => {
    expect(extractNewsletterExcerpt('')).toBe('');
  });

  it('normalizes excessive newlines', () => {
    const text = 'Paragraph one.\n\n\n\n\nParagraph two.';
    expect(extractNewsletterExcerpt(text)).toBe('Paragraph one.\n\nParagraph two.');
  });

  it('uses 2000 char default limit for comprehensive excerpts', () => {
    // A 1500-char text should be kept in full with the new default
    const text = 'A'.repeat(1500);
    expect(extractNewsletterExcerpt(text)).toBe(text);
  });

  it('truncates text over 2000 chars by default', () => {
    const text = 'A'.repeat(2500);
    expect(extractNewsletterExcerpt(text)).toBe('A'.repeat(2000) + '...');
  });

  it('preserves "View in browser" text (not stripped as boilerplate)', () => {
    const text = 'View in browser\n\nHere is the newsletter content.';
    expect(extractNewsletterExcerpt(text)).toBe(text);
  });
});

// --- Newsletter Digest ---

describe('generateDigestFilename', () => {
  it('generates correct path format', () => {
    const date = new Date('2026-02-03T10:00:00Z');
    expect(generateDigestFilename(date, '0 - INBOX/NEWSLETTERS'))
      .toBe('0 - INBOX/NEWSLETTERS/2026-02-03 - Newsletter Digest.md');
  });

  it('uses provided folder', () => {
    const date = new Date('2026-01-15T10:00:00Z');
    expect(generateDigestFilename(date, 'CUSTOM'))
      .toBe('CUSTOM/2026-01-15 - Newsletter Digest.md');
  });
});

describe('generateNewsletterHtmlPath', () => {
  it('generates correct path with slug', () => {
    const date = new Date('2026-02-03T10:00:00Z');
    const path = generateNewsletterHtmlPath(date, 'Design Weekly', 'Issue #47');
    expect(path).toBe('_newsletter-html/2026-02-03/design-weekly-issue-47.html');
  });

  it('handles special characters in slug', () => {
    const date = new Date('2026-02-03T10:00:00Z');
    const path = generateNewsletterHtmlPath(date, 'The Morning Brew ☕', 'What\'s New? #100!');
    expect(path).toMatch(/^_newsletter-html\/2026-02-03\/[a-z0-9-]+\.html$/);
    expect(path).not.toContain('☕');
    expect(path).not.toContain("'");
  });

  it('limits slug length to 80 chars', () => {
    const date = new Date('2026-02-03T10:00:00Z');
    const path = generateNewsletterHtmlPath(date, 'A'.repeat(50), 'B'.repeat(50));
    const slug = path.split('/').pop()!.replace('.html', '');
    expect(slug.length).toBeLessThanOrEqual(80);
  });

  it('strips leading and trailing hyphens from slug', () => {
    const date = new Date('2026-02-03T10:00:00Z');
    const path = generateNewsletterHtmlPath(date, '---Test---', '!!!Subject!!!');
    const slug = path.split('/').pop()!.replace('.html', '');
    expect(slug).not.toMatch(/^-/);
    expect(slug).not.toMatch(/-$/);
  });
});

describe('generateDigestEntry', () => {
  it('renders entry with URL and excerpt', () => {
    const email = createParsedEmail({
      from: { name: 'Design Weekly', email: 'hello@designweekly.com' },
      subject: 'Issue #47',
      isNewsletter: true,
      newsletterName: 'Design Weekly',
      body: 'CSS updates this week.',
    });

    const entry = generateDigestEntry(email, 'https://example.com/view');
    expect(entry).toContain('### Design Weekly — Issue #47');
    expect(entry).toContain('**From:** hello@designweekly.com');
    expect(entry).toContain('[Read full newsletter →](https://example.com/view)');
    expect(entry).toContain('> CSS updates this week.');
  });

  it('renders entry without URL', () => {
    const email = createParsedEmail({
      newsletterName: 'Test',
      subject: 'Hello',
      body: 'Content here.',
    });

    const entry = generateDigestEntry(email, null);
    expect(entry).not.toContain('[Read full newsletter');
    expect(entry).toContain('> Content here.');
  });

  it('renders entry without body', () => {
    const email = createParsedEmail({
      newsletterName: 'Test',
      subject: 'Hello',
      body: '',
    });

    const entry = generateDigestEntry(email, 'https://example.com');
    expect(entry).toContain('### Test — Hello');
    expect(entry).toContain('[Read full newsletter →]');
    // No blockquote lines (lines starting with "> ")
    expect(entry).not.toMatch(/^> /m);
  });

  it('formats multi-line body as blockquote', () => {
    const email = createParsedEmail({
      newsletterName: 'Test',
      subject: 'Hello',
      body: 'Line one\nLine two\nLine three',
    });

    const entry = generateDigestEntry(email, null);
    expect(entry).toContain('> Line one\n> Line two\n> Line three');
  });

  it('falls back to from.name when newsletterName is empty', () => {
    const email = createParsedEmail({
      from: { name: 'Fallback Name', email: 'fallback@test.com' },
      subject: 'Subject',
      newsletterName: '',
    });

    const entry = generateDigestEntry(email, null);
    expect(entry).toContain('### Fallback Name — Subject');
  });
});

describe('generateDigestMarkdown', () => {
  it('generates digest with single entry', () => {
    const date = new Date('2026-02-03T10:00:00Z');
    const entries = ['### Test — Subject\n**From:** a@b.com'];
    const emailIds = ['id-1'];

    const md = generateDigestMarkdown(date, entries, emailIds);
    expect(md).toContain('tags:');
    expect(md).toContain('- newsletter');
    expect(md).toContain('- digest');
    expect(md).toContain('created: 2026-02-03');
    expect(md).toContain('newsletter_count: 1');
    expect(md).toContain('  - id-1');
    expect(md).toContain('# Newsletter Digest — 2026-02-03');
    expect(md).toContain('### Test — Subject');
  });

  it('generates digest with multiple entries separated by ---', () => {
    const date = new Date('2026-02-03T10:00:00Z');
    const entries = ['### A — Sub1\n**From:** a@b.com', '### B — Sub2\n**From:** c@d.com'];
    const emailIds = ['id-1', 'id-2'];

    const md = generateDigestMarkdown(date, entries, emailIds);
    expect(md).toContain('newsletter_count: 2');
    expect(md).toContain('  - id-1');
    expect(md).toContain('  - id-2');
    // Entries separated by ---
    expect(md).toContain('---\n\n### B — Sub2');
  });

  it('includes all email IDs in frontmatter', () => {
    const date = new Date('2026-02-03T10:00:00Z');
    const md = generateDigestMarkdown(date, ['e1', 'e2', 'e3'], ['a', 'b', 'c']);
    expect(md).toContain('  - a\n  - b\n  - c');
  });
});

describe('parseDigestMarkdown', () => {
  it('extracts entries and email IDs', () => {
    const md = `---
tags:
  - newsletter
  - digest
created: 2026-02-03
newsletter_count: 2
email_ids:
  - id-1
  - id-2
---

# Newsletter Digest — 2026-02-03

### A — Sub1
**From:** a@b.com

---

### B — Sub2
**From:** c@d.com
`;

    const result = parseDigestMarkdown(md);
    expect(result.emailIds).toEqual(['id-1', 'id-2']);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toContain('### A — Sub1');
    expect(result.entries[1]).toContain('### B — Sub2');
  });

  it('handles single entry digest', () => {
    const md = `---
tags:
  - newsletter
  - digest
created: 2026-02-03
newsletter_count: 1
email_ids:
  - id-1
---

# Newsletter Digest — 2026-02-03

### A — Sub1
**From:** a@b.com
`;

    const result = parseDigestMarkdown(md);
    expect(result.emailIds).toEqual(['id-1']);
    expect(result.entries).toHaveLength(1);
  });

  it('round-trips with generateDigestMarkdown', () => {
    const date = new Date('2026-02-03T10:00:00Z');
    const entries = [
      '### Design Weekly — Issue #47\n**From:** hello@designweekly.com\n[Read full newsletter →](https://example.com)\n\n> Great CSS updates.',
      '### Morning Brew — Daily\n**From:** crew@brew.com\n\n> Top stories today.',
    ];
    const emailIds = ['id-1', 'id-2'];

    const md = generateDigestMarkdown(date, entries, emailIds);
    const parsed = parseDigestMarkdown(md);

    expect(parsed.emailIds).toEqual(emailIds);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toContain('### Design Weekly — Issue #47');
    expect(parsed.entries[1]).toContain('### Morning Brew — Daily');
  });

  it('handles empty/malformed content gracefully', () => {
    const result = parseDigestMarkdown('');
    expect(result.emailIds).toEqual([]);
    expect(result.entries).toEqual([]);
  });
});

// --- Address-Based Routing ---

describe('extractRoute', () => {
  it('routes email-to-obsidian to task pipeline', () => {
    expect(extractRoute('email-to-obsidian@example.com')).toBe('task');
    expect(extractRoute('email-to-obsidian@example.org')).toBe('task');
    expect(extractRoute('email-to-obsidian@example.net')).toBe('task');
  });

  it('routes newsletters to newsletter pipeline', () => {
    expect(extractRoute('newsletters@example.com')).toBe('newsletter');
    expect(extractRoute('newsletters@example.org')).toBe('newsletter');
  });

  it('accepts singular newsletter alias', () => {
    expect(extractRoute('newsletter@example.com')).toBe('newsletter');
  });

  it('routes claude to agent pipeline', () => {
    expect(extractRoute('claude@example.com')).toBe('agent');
    expect(extractRoute('claude@example.org')).toBe('agent');
  });

  it('routes inbox to catch-all', () => {
    expect(extractRoute('inbox@example.com')).toBe('inbox');
  });

  it('routes unknown addresses to catch-all', () => {
    expect(extractRoute('random@example.com')).toBe('inbox');
    expect(extractRoute('support@example.com')).toBe('inbox');
  });

  it('is case-insensitive', () => {
    expect(extractRoute('EMAIL-TO-OBSIDIAN@example.com')).toBe('task');
    expect(extractRoute('Newsletters@example.org')).toBe('newsletter');
    expect(extractRoute('Claude@example.com')).toBe('agent');
  });
});

// --- Agent Message Templates ---

describe('generateAgentMessageMarkdown', () => {
  it('generates markdown with agent-message tag and pending status', () => {
    const email = createParsedEmail({
      messageId: 'agent-123',
      from: { name: 'Test User', email: 'user@example.com' },
      subject: 'Summarize my meeting notes',
      date: new Date('2026-02-03T10:00:00Z'),
      body: 'Please summarize the notes from today.',
      source: 'gmail',
    });

    const markdown = generateAgentMessageMarkdown(email);

    expect(markdown).toContain('tags:');
    expect(markdown).toContain('- agent-message');
    expect(markdown).not.toContain('- email-task');
    expect(markdown).not.toContain('- newsletter');
    expect(markdown).toContain('status: pending');
    expect(markdown).toContain('from: user@example.com');
    expect(markdown).toContain('email_id: agent-123');
    expect(markdown).toContain('source: gmail');
  });

  it('does NOT include tasks section', () => {
    const email = createParsedEmail();
    const markdown = generateAgentMessageMarkdown(email);

    expect(markdown).not.toContain('## Tasks in this note');
    expect(markdown).not.toContain('- [ ] Review and process this email');
  });

  it('includes Agent Message heading and body', () => {
    const email = createParsedEmail({
      from: { name: 'Test User', email: 'user@example.com' },
      body: 'Do the thing please.',
    });

    const markdown = generateAgentMessageMarkdown(email);

    expect(markdown).toContain('## Agent Message');
    expect(markdown).toContain('**From:** Test User <user@example.com>');
    expect(markdown).toContain('Do the thing please.');
  });

  it('escapes YAML-problematic subjects', () => {
    const email = createParsedEmail({
      subject: 'Task: Do this thing',
    });

    const markdown = generateAgentMessageMarkdown(email);
    expect(markdown).toContain('subject: "Task: Do this thing"');
  });

  it('includes attachment URLs when attachments are present', () => {
    const email = createParsedEmail({
      messageId: 'agent-att-123',
      attachments: [
        {
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          content: new ArrayBuffer(0),
          disposition: 'attachment' as const,
          related: false,
          contentId: '',
        },
        {
          filename: 'screenshot.png',
          mimeType: 'image/png',
          content: new ArrayBuffer(0),
          disposition: 'attachment' as const,
          related: false,
          contentId: '',
        },
      ],
      attachmentUrls: [
        'https://worker.example.com/attachment/agent-att-123/report.pdf',
        'https://worker.example.com/attachment/agent-att-123/screenshot.png',
      ],
    });

    const markdown = generateAgentMessageMarkdown(email);

    expect(markdown).toContain('## Attachments');
    // PDF = regular link (not image)
    expect(markdown).toContain('[report.pdf](https://worker.example.com/attachment/agent-att-123/report.pdf)');
    // PNG = image embed
    expect(markdown).toContain('![screenshot.png](https://worker.example.com/attachment/agent-att-123/screenshot.png)');
  });

  it('omits attachments section when no attachments', () => {
    const email = createParsedEmail({
      messageId: 'agent-no-att',
    });

    const markdown = generateAgentMessageMarkdown(email);

    expect(markdown).not.toContain('## Attachments');
    expect(markdown).not.toContain('![[');
  });
});

describe('generateAgentMessageFilename', () => {
  it('generates filename in agent folder', () => {
    const email = createParsedEmail({
      subject: 'Summarize meeting notes',
      date: new Date('2026-02-03T10:00:00Z'),
    });

    const filename = generateAgentMessageFilename(email, '0 - INBOX/AGENT MESSAGES');
    expect(filename).toBe('0 - INBOX/AGENT MESSAGES/2026-02-03 - Summarize meeting notes.md');
  });

  it('sanitizes unsafe characters in subject', () => {
    const email = createParsedEmail({
      subject: 'Task/With:Special<Chars>',
      date: new Date('2026-02-03T10:00:00Z'),
    });

    const filename = generateAgentMessageFilename(email, 'Agent');
    expect(filename).toBe('Agent/2026-02-03 - Task-With-Special-Chars-.md');
  });

  it('strips Fwd prefix from subject', () => {
    const email = createParsedEmail({
      subject: 'Fwd: Do this thing',
      date: new Date('2026-02-03T10:00:00Z'),
    });

    const filename = generateAgentMessageFilename(email, 'Agent');
    expect(filename).not.toContain('Fwd:');
    expect(filename).toContain('Do this thing');
  });

  it('truncates long subjects to 100 chars', () => {
    const email = createParsedEmail({
      subject: 'A'.repeat(150),
      date: new Date('2026-02-03T10:00:00Z'),
    });

    const filename = generateAgentMessageFilename(email, 'Agent');
    // Agent/ + date + " - " + subject(max 100) + .md
    const subjectPart = filename.split(' - ').slice(1).join(' - ').replace('.md', '');
    expect(subjectPart.length).toBeLessThanOrEqual(100);
  });
});

// --- Attachment URL Helpers ---

describe('isImageMimeType', () => {
  it('returns true for image MIME types', () => {
    expect(isImageMimeType('image/png')).toBe(true);
    expect(isImageMimeType('image/jpeg')).toBe(true);
    expect(isImageMimeType('image/gif')).toBe(true);
    expect(isImageMimeType('image/webp')).toBe(true);
    expect(isImageMimeType('image/svg+xml')).toBe(true);
  });

  it('returns false for non-image MIME types', () => {
    expect(isImageMimeType('application/pdf')).toBe(false);
    expect(isImageMimeType('text/plain')).toBe(false);
    expect(isImageMimeType('application/octet-stream')).toBe(false);
    expect(isImageMimeType('video/mp4')).toBe(false);
  });
});

describe('buildAttachmentUrl', () => {
  it('returns HTTP URL when WORKER_URL is set', () => {
    expect(buildAttachmentUrl('https://worker.example.com', 'msg-123', 'file.pdf'))
      .toBe('https://worker.example.com/attachment/msg-123/file.pdf');
  });

  it('strips trailing slash from WORKER_URL', () => {
    expect(buildAttachmentUrl('https://worker.example.com/', 'msg-123', 'file.pdf'))
      .toBe('https://worker.example.com/attachment/msg-123/file.pdf');
  });

  it('returns relative path when WORKER_URL is empty', () => {
    expect(buildAttachmentUrl('', 'msg-123', 'file.pdf'))
      .toBe('_attachments/msg-123/file.pdf');
  });

  it('returns relative path when WORKER_URL is undefined', () => {
    expect(buildAttachmentUrl(undefined, 'msg-123', 'file.pdf'))
      .toBe('_attachments/msg-123/file.pdf');
  });
});

describe('generateMarkdown attachment URLs', () => {
  it('renders images with ![](url) syntax', () => {
    const email = createParsedEmail({
      messageId: 'att-test-1',
      attachments: [
        {
          filename: 'photo.jpg',
          mimeType: 'image/jpeg',
          content: new ArrayBuffer(0),
          disposition: 'attachment' as const,
          related: false,
          contentId: '',
        },
      ],
      attachmentUrls: ['https://worker.example.com/attachment/att-test-1/photo.jpg'],
    });

    const markdown = generateMarkdown(email);
    expect(markdown).toContain('![photo.jpg](https://worker.example.com/attachment/att-test-1/photo.jpg)');
  });

  it('renders non-images with [](url) syntax', () => {
    const email = createParsedEmail({
      messageId: 'att-test-2',
      attachments: [
        {
          filename: 'document.pdf',
          mimeType: 'application/pdf',
          content: new ArrayBuffer(0),
          disposition: 'attachment' as const,
          related: false,
          contentId: '',
        },
      ],
      attachmentUrls: ['https://worker.example.com/attachment/att-test-2/document.pdf'],
    });

    const markdown = generateMarkdown(email);
    expect(markdown).toContain('[document.pdf](https://worker.example.com/attachment/att-test-2/document.pdf)');
    // Should NOT have image prefix
    expect(markdown).not.toContain('![document.pdf]');
  });

  it('falls back to relative path when no attachmentUrls', () => {
    const email = createParsedEmail({
      messageId: 'att-test-3',
      attachments: [
        {
          filename: 'file.txt',
          mimeType: 'text/plain',
          content: new ArrayBuffer(0),
          disposition: 'attachment' as const,
          related: false,
          contentId: '',
        },
      ],
      attachmentUrls: [],
    });

    const markdown = generateMarkdown(email);
    expect(markdown).toContain('[file.txt](_attachments/att-test-3/file.txt)');
  });
});
