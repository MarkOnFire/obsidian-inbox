/**
 * Test utilities for creating mock email data
 */

import type { Email, Header } from 'postal-mime';

interface EmailFixtureOptions {
  from?: { name?: string; address: string };
  subject?: string;
  date?: string;
  messageId?: string;
  html?: string;
  text?: string;
  headers?: Array<{ key: string; value: string }>;
}

/**
 * Create a Header object matching the postal-mime Header type
 */
function createHeader(key: string, value: string): Header {
  return { key: key.toLowerCase(), value };
}

/**
 * Create a mock postal-mime Email object for testing.
 * Uses type assertion since we only need the fields used by our worker functions.
 */
export function createMockEmail(options: EmailFixtureOptions = {}): Email {
  const defaultHeaders: Header[] = [
    createHeader('From', options.from?.address || 'test@example.com'),
    createHeader('Subject', options.subject || 'Test Subject'),
    createHeader('Date', options.date || new Date().toISOString()),
  ];

  // Convert simple headers to full Header objects
  const customHeaders: Header[] = (options.headers || []).map(h => createHeader(h.key, h.value));
  const finalHeaders = customHeaders.length > 0 ? customHeaders : defaultHeaders;

  // Cast through unknown because we only need the fields our worker uses
  // The postal-mime Email type has many optional fields we don't need for testing
  return {
    from: options.from
      ? { name: options.from.name || '', address: options.from.address }
      : { name: 'Test Sender', address: 'test@example.com' },
    to: [{ name: '', address: 'inbox@yourdomain.com' }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: options.subject || 'Test Subject',
    date: options.date || new Date().toISOString(),
    messageId: options.messageId || '<test-message-id@example.com>',
    html: options.html || '<p>Test email body</p>',
    text: options.text || 'Test email body',
    headers: finalHeaders,
    attachments: [],
  } as unknown as Email;
}

/**
 * Create a Gmail-style email with appropriate headers
 */
export function createGmailEmail(options: EmailFixtureOptions = {}): Email {
  return createMockEmail({
    ...options,
    headers: [
      ...(options.headers || []),
      { key: 'x-gm-message-state', value: 'AOAM532abc123' },
    ],
  });
}

/**
 * Create an Outlook-style email with appropriate headers
 */
export function createOutlookEmail(options: EmailFixtureOptions = {}): Email {
  return createMockEmail({
    ...options,
    headers: [
      ...(options.headers || []),
      { key: 'x-ms-exchange-organization-authas', value: 'Internal' },
    ],
  });
}

/**
 * Create an iCloud-style email with appropriate headers
 */
export function createICloudEmail(options: EmailFixtureOptions = {}): Email {
  return createMockEmail({
    ...options,
    headers: [
      ...(options.headers || []),
      { key: 'received', value: 'from mx.icloud.com (mx.icloud.com)' },
    ],
  });
}

/**
 * Create a newsletter-style email with List-Unsubscribe header
 */
export function createNewsletterEmail(options: EmailFixtureOptions = {}): Email {
  return createMockEmail({
    from: options.from || { name: 'Design Weekly', address: 'hello@designweekly.com' },
    subject: options.subject || 'Issue #47: What\'s New in CSS',
    ...options,
    headers: [
      ...(options.headers || []),
      { key: 'list-unsubscribe', value: '<https://designweekly.com/unsubscribe>, <mailto:unsubscribe@designweekly.com>' },
    ],
  });
}

/**
 * Create an agent-message email (sent to claude@domain)
 */
export function createAgentMessageEmail(options: EmailFixtureOptions = {}): Email {
  return createMockEmail({
    from: options.from || { name: 'Test User', address: 'user@example.com' },
    subject: options.subject || 'Summarize my meeting notes from today',
    ...options,
  });
}

/**
 * Create a ParsedEmail object for testing generateMarkdown/generateFilename
 */
export function createParsedEmail(overrides: Partial<{
  messageId: string;
  from: { name: string; email: string };
  subject: string;
  date: Date;
  body: string;
  rawHtml: string;
  source: 'gmail' | 'outlook' | 'icloud' | 'unknown';
  isNewsletter: boolean;
  newsletterName: string;
}> = {}) {
  return {
    messageId: overrides.messageId || 'test-message-id',
    from: overrides.from || { name: 'Test Sender', email: 'test@example.com' },
    subject: overrides.subject || 'Test Subject',
    date: overrides.date || new Date('2025-01-15T10:30:00Z'),
    body: overrides.body ?? 'Test email body content',
    rawHtml: overrides.rawHtml ?? '<p>Test email body</p>',
    source: overrides.source || 'unknown' as const,
    attachments: [],
    isNewsletter: overrides.isNewsletter ?? false,
    newsletterName: overrides.newsletterName ?? '',
  };
}
