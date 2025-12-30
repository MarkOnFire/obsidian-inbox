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
  type ParsedEmail,
  type EmailSource,
} from './worker';
import {
  createMockEmail,
  createGmailEmail,
  createOutlookEmail,
  createICloudEmail,
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
  it('generates correct filename format', () => {
    const email = createParsedEmail({
      subject: 'Test Subject',
      date: new Date('2025-01-15T10:30:00Z'),
    });
    const filename = generateFilename(email, '0 - INBOX');
    expect(filename).toBe('0 - INBOX/2025-01-15 - Test Subject.md');
  });

  it('sanitizes unsafe characters in subject', () => {
    const email = createParsedEmail({
      subject: 'Test/Subject:With<Special>Chars',
      date: new Date('2025-01-15T10:30:00Z'),
    });
    const filename = generateFilename(email, 'INBOX');
    expect(filename).toBe('INBOX/2025-01-15 - Test-Subject-With-Special-Chars.md');
  });

  it('normalizes whitespace', () => {
    const email = createParsedEmail({
      subject: 'Too   many   spaces',
      date: new Date('2025-01-15T10:30:00Z'),
    });
    const filename = generateFilename(email, 'INBOX');
    expect(filename).toBe('INBOX/2025-01-15 - Too many spaces.md');
  });

  it('truncates long subjects to 100 chars', () => {
    const longSubject = 'A'.repeat(150);
    const email = createParsedEmail({
      subject: longSubject,
      date: new Date('2025-01-15T10:30:00Z'),
    });
    const filename = generateFilename(email, 'INBOX');
    // Date is 10 chars, " - " is 3 chars, ".md" is 3 chars
    // Subject should be truncated to 100 chars
    expect(filename.length).toBeLessThanOrEqual('INBOX/'.length + 10 + 3 + 100 + 3);
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
