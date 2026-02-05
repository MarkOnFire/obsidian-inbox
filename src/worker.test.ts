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
  extractNewsletterName,
  generateNewsletterSidecarMarkdown,
  generateNewsletterFilename,
  generateNewsletterBaseFilename,
  cleanNewsletterHtml,
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

describe('generateNewsletterSidecarMarkdown', () => {
  it('generates sidecar with correct frontmatter', () => {
    const email = createParsedEmail({
      messageId: 'nl-123',
      from: { name: 'Design Weekly', email: 'hello@designweekly.com' },
      subject: 'Issue #47: CSS Updates',
      date: new Date('2026-02-03T10:00:00Z'),
      source: 'unknown',
      isNewsletter: true,
      newsletterName: 'Design Weekly',
    });

    const markdown = generateNewsletterSidecarMarkdown(email, 'newsletter.html');

    expect(markdown).toContain('tags:');
    expect(markdown).toContain('- newsletter');
    expect(markdown).not.toContain('- email-task');
    expect(markdown).toContain('newsletter_name: Design Weekly');
    expect(markdown).toContain('status: unprocessed');
    expect(markdown).toContain('from: hello@designweekly.com');
    expect(markdown).toContain('email_id: nl-123');
  });

  it('embeds HTML file via wikilink', () => {
    const email = createParsedEmail({
      isNewsletter: true,
      newsletterName: 'Test Newsletter',
    });

    const markdown = generateNewsletterSidecarMarkdown(email, '2025-01-15 - Test Newsletter - Test Subject.html');

    expect(markdown).toContain('![[2025-01-15 - Test Newsletter - Test Subject.html]]');
  });

  it('does NOT include tasks section', () => {
    const email = createParsedEmail({
      isNewsletter: true,
      newsletterName: 'Test Newsletter',
    });

    const markdown = generateNewsletterSidecarMarkdown(email, 'test.html');

    expect(markdown).not.toContain('## Tasks in this note');
    expect(markdown).not.toContain('- [ ] Review and process this email');
  });

  it('uses newsletter name in heading', () => {
    const email = createParsedEmail({
      from: { name: 'Design Weekly', email: 'hello@designweekly.com' },
      subject: 'Issue #47',
      isNewsletter: true,
      newsletterName: 'Design Weekly',
    });

    const markdown = generateNewsletterSidecarMarkdown(email, 'test.html');

    expect(markdown).toContain('## Design Weekly — Issue #47');
  });

  it('escapes YAML-problematic newsletter names', () => {
    const email = createParsedEmail({
      isNewsletter: true,
      newsletterName: 'News: Daily Update',
    });

    const markdown = generateNewsletterSidecarMarkdown(email, 'test.html');
    expect(markdown).toContain('newsletter_name: "News: Daily Update"');
  });

  it('falls back to body text when no HTML file', () => {
    const email = createParsedEmail({
      isNewsletter: true,
      newsletterName: 'Text Newsletter',
      body: 'Plain text content',
    });

    const markdown = generateNewsletterSidecarMarkdown(email, null);

    expect(markdown).not.toContain('![[');
    expect(markdown).toContain('Plain text content');
  });

  it('shows placeholder when no HTML and no body', () => {
    const email = createParsedEmail({
      isNewsletter: true,
      newsletterName: 'Empty Newsletter',
      body: '',
    });

    const markdown = generateNewsletterSidecarMarkdown(email, null);

    expect(markdown).toContain('*No newsletter content*');
  });
});

describe('generateNewsletterFilename', () => {
  it('generates newsletter filename with newsletter name prefix', () => {
    const email = createParsedEmail({
      from: { name: 'Design Weekly', email: 'hello@designweekly.com' },
      subject: 'Issue #47: CSS Updates',
      date: new Date('2026-02-03T10:00:00Z'),
      isNewsletter: true,
      newsletterName: 'Design Weekly',
    });

    const filename = generateNewsletterFilename(email, '0 - INBOX/NEWSLETTERS');
    expect(filename).toBe('0 - INBOX/NEWSLETTERS/2026-02-03 - Design Weekly - Issue #47- CSS Updates.md');
  });

  it('sanitizes unsafe characters in newsletter name', () => {
    const email = createParsedEmail({
      subject: 'Test',
      date: new Date('2026-02-03T10:00:00Z'),
      isNewsletter: true,
      newsletterName: 'News/Letter:Special',
    });

    const filename = generateNewsletterFilename(email, 'NEWSLETTERS');
    expect(filename).not.toContain('/Letter');
    expect(filename).toContain('News-Letter-Special');
  });

  it('truncates long newsletter names', () => {
    const email = createParsedEmail({
      subject: 'Short Subject',
      date: new Date('2026-02-03T10:00:00Z'),
      isNewsletter: true,
      newsletterName: 'A'.repeat(80),
    });

    const filename = generateNewsletterFilename(email, 'NL');
    // Newsletter name should be truncated to 40 chars
    const namePart = filename.split(' - ')[1];
    expect(namePart.length).toBeLessThanOrEqual(40);
  });

  it('strips FWD prefix from subject', () => {
    const email = createParsedEmail({
      subject: 'Fwd: Weekly Digest',
      date: new Date('2026-02-03T10:00:00Z'),
      isNewsletter: true,
      newsletterName: 'Tech News',
    });

    const filename = generateNewsletterFilename(email, 'NL');
    expect(filename).not.toContain('Fwd:');
    expect(filename).toContain('Weekly Digest');
  });
});

// --- Newsletter HTML Cleaning ---

describe('cleanNewsletterHtml', () => {
  it('strips script tags and contents', () => {
    const html = '<p>Hello</p><script>alert("x")</script><p>World</p>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).not.toContain('<script');
    expect(cleaned).not.toContain('alert');
    expect(cleaned).toContain('<p>Hello</p>');
    expect(cleaned).toContain('<p>World</p>');
  });

  it('strips tracking pixels (1x1 images)', () => {
    const html = '<p>Content</p><img width="1" height="1" src="https://example.com/pixel.png">';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).not.toContain('<img');
    expect(cleaned).toContain('<p>Content</p>');
  });

  it('strips zero-dimension images', () => {
    const html = '<img width="0" src="https://example.com/spacer.gif"><p>Text</p>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).not.toContain('<img');
    expect(cleaned).toContain('<p>Text</p>');
  });

  it('strips tracker images by domain pattern', () => {
    const trackerUrls = [
      'https://open.substack.com/p/tracking',
      'https://pixel.example.com/img',
      'https://track.mailsender.com/open',
      'https://beacon.krxd.net/pixel',
      'https://email.mg.example.com/o/abc',
      'https://example.com/o.gif',
      'https://example.com/t.gif',
      'https://example.com/spacer.gif',
      'https://list-manage.com/track/click?u=abc123',
    ];

    for (const url of trackerUrls) {
      const html = `<p>Content</p><img src="${url}" />`;
      const cleaned = cleanNewsletterHtml(html);
      expect(cleaned).not.toContain(url);
    }
  });

  it('preserves regular images', () => {
    const html = '<img src="https://cdn.example.com/hero-image.jpg" width="600" height="400">';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).toContain('hero-image.jpg');
  });

  it('preserves CSS and style blocks', () => {
    const html = '<style>.header { color: red; }</style><div class="header">Hello</div>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).toContain('<style>');
    expect(cleaned).toContain('color: red');
  });

  it('preserves layout tables', () => {
    const html = '<table><tr><td>Column 1</td><td>Column 2</td></tr></table>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).toContain('<table>');
    expect(cleaned).toContain('Column 1');
    expect(cleaned).toContain('Column 2');
  });

  it('strips unsubscribe footers', () => {
    const html = '<p>Content</p><div class="footer"><p>Unsubscribe here</p></div>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).toContain('Content');
    expect(cleaned).not.toContain('Unsubscribe here');
  });

  it('returns empty string for empty input', () => {
    expect(cleanNewsletterHtml('')).toBe('');
  });

  it('strips MSO/IE conditional comments', () => {
    const html = '<div>Before</div><!--[if mso | IE]><table width="600"><tr><td>MSO only</td></tr></table><![endif]--><div>After</div>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).toContain('Before');
    expect(cleaned).toContain('After');
    expect(cleaned).not.toContain('MSO only');
    expect(cleaned).not.toContain('<!--[if');
  });

  it('strips DuckDuckGo Email Protection preview divs', () => {
    const html = '<div data-email-protection="duckduckgo-email-protection-preview" style="display:none;">Preview text here</div><p>Real content</p>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).not.toContain('duckduckgo');
    expect(cleaned).not.toContain('Preview text here');
    expect(cleaned).toContain('Real content');
  });

  it('strips DuckDuckGo Email Protection banner tables', () => {
    const html = '<table class="duckduckgo-email-protection-banner" width="100%"><tr><td>DuckDuckGo removed 1 tracker. <a href="#">More</a></td></tr></table><p>Newsletter body</p>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).not.toContain('duckduckgo');
    expect(cleaned).not.toContain('removed 1 tracker');
    expect(cleaned).toContain('Newsletter body');
  });

  it('strips DDG banner with nested tables (real-world structure)', () => {
    // DDG banner contains layout tables nested 3 levels deep.
    // The old regex stopped at the first inner </table>.
    const html = [
      '<table aria-label="duckduckgo-email-protection-banner" width="100%">',
      '  <tr><td>',
      '    <table><tr><td>DuckDuckGo removed 1 tracker</td></tr></table>',
      '    <table>',
      '      <tr><td>',
      '        <table><tr><td>',
      '          <a href="https://duckduckgo.com/email/report-spam#token">Report Spam</a>',
      '        </td></tr></table>',
      '      </td></tr>',
      '    </table>',
      '  </td></tr>',
      '</table>',
      '<p>Real newsletter starts here</p>',
    ].join('\n');
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).not.toContain('Report Spam');
    expect(cleaned).not.toContain('removed 1 tracker');
    expect(cleaned).not.toContain('duckduckgo');
    expect(cleaned).toContain('Real newsletter starts here');
  });

  it('strips stray DDG report-spam links outside banner', () => {
    const html = '<div><a href="https://duckduckgo.com/email/report-spam#abc123">Report Spam</a></div><p>Content</p>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).not.toContain('Report Spam');
    expect(cleaned).not.toContain('duckduckgo.com');
    expect(cleaned).toContain('Content');
  });

  it('strips content after closing </html> tag (mail relay footers)', () => {
    const html = '<html><body><p>Newsletter</p></body></html>\n\n-- \nYou received this because you are subscribed to Google Groups.\nTo unsubscribe send email to list+unsub@groups.com.';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).toContain('Newsletter');
    expect(cleaned).toContain('</html>');
    expect(cleaned).not.toContain('Google Groups');
    expect(cleaned).not.toContain('unsubscribe');
  });

  it('strips hidden preheader/preview text spans', () => {
    const html = '<span style="display: none; max-height: 0px; overflow: hidden;">&#x34F; &#x34F; preview</span><p>Content</p>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).not.toContain('preview');
    expect(cleaned).toContain('Content');
  });

  it('strips display:none divs (email preheader)', () => {
    const html = '<div style="display:none;font-size:1px;color:#ffffff;">Preheader text for inbox</div><p>Body</p>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).not.toContain('Preheader text for inbox');
    expect(cleaned).toContain('Body');
  });

  it('collapses excessive blank lines after stripping', () => {
    const html = '<p>Top</p>\n\n\n\n\n\n<p>Bottom</p>';
    const cleaned = cleanNewsletterHtml(html);

    expect(cleaned).not.toMatch(/\n{3,}/);
    expect(cleaned).toContain('<p>Top</p>');
    expect(cleaned).toContain('<p>Bottom</p>');
  });
});

// --- Newsletter Base Filename ---

describe('generateNewsletterBaseFilename', () => {
  it('returns path without extension', () => {
    const email = createParsedEmail({
      from: { name: 'Design Weekly', email: 'hello@designweekly.com' },
      subject: 'Issue #47',
      date: new Date('2026-02-03T10:00:00Z'),
      isNewsletter: true,
      newsletterName: 'Design Weekly',
    });

    const base = generateNewsletterBaseFilename(email, '0 - INBOX/NEWSLETTERS');
    expect(base).toBe('0 - INBOX/NEWSLETTERS/2026-02-03 - Design Weekly - Issue #47');
    expect(base).not.toContain('.md');
    expect(base).not.toContain('.html');
  });

  it('matches generateNewsletterFilename minus extension', () => {
    const email = createParsedEmail({
      subject: 'Test Subject',
      date: new Date('2026-02-03T10:00:00Z'),
      isNewsletter: true,
      newsletterName: 'Test Newsletter',
    });

    const base = generateNewsletterBaseFilename(email, 'NL');
    const full = generateNewsletterFilename(email, 'NL');
    expect(full).toBe(base + '.md');
  });

  it('sanitizes unsafe characters', () => {
    const email = createParsedEmail({
      subject: 'Test',
      date: new Date('2026-02-03T10:00:00Z'),
      isNewsletter: true,
      newsletterName: 'News/Letter:Special',
    });

    const base = generateNewsletterBaseFilename(email, 'NL');
    expect(base).toContain('News-Letter-Special');
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
