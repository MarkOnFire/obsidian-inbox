#!/usr/bin/env npx tsx
/**
 * Local newsletter test script
 *
 * Reads .emlx files from sample_eml/, processes them through the newsletter
 * HTML cleaning pipeline, and writes the output files (cleaned .html + .md sidecar)
 * directly into the Obsidian vault's NEWSLETTERS folder.
 *
 * Usage:
 *   npx tsx scripts/test-newsletter-local.ts                    # process all .emlx files
 *   npx tsx scripts/test-newsletter-local.ts sample_eml/500013.emlx  # process one file
 */

import * as fs from 'fs';
import * as path from 'path';
import PostalMime from 'postal-mime';
import type { Email } from 'postal-mime';
import {
  cleanNewsletterHtml,
  generateNewsletterSidecarMarkdown,
  generateNewsletterBaseFilename,
  detectEmailSource,
  isNewsletter,
  extractNewsletterName,
  formatDate,
  type ParsedEmail,
} from '../src/worker.js';

// ── Config ──────────────────────────────────────────────────────────────
const VAULT_NEWSLETTERS = path.join(
  process.env.HOME || '~',
  'Library/Mobile Documents/iCloud~md~obsidian/Documents/MarkBrain/0 - INBOX/NEWSLETTERS',
);
const SAMPLE_DIR = path.resolve(__dirname, '../sample_eml');

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse an Apple Mail .emlx file.
 * Format: first line is a byte count, then RFC822 content, then Apple plist.
 * We only need the RFC822 portion.
 */
function extractRfc822FromEmlx(filePath: string): Buffer {
  const raw = fs.readFileSync(filePath);
  const content = raw.toString('utf-8');

  // First line is the byte count of the RFC822 message
  const firstNewline = content.indexOf('\n');
  const byteCount = parseInt(content.substring(0, firstNewline), 10);

  // Extract exactly byteCount bytes starting after the first newline
  const rfc822Start = firstNewline + 1;
  return raw.subarray(rfc822Start, rfc822Start + byteCount);
}

/**
 * Build a ParsedEmail from a postal-mime Email, mirroring the worker's parseEmail().
 */
function buildParsedEmail(email: Email): ParsedEmail {
  const source = detectEmailSource(email);

  let fromInfo = { name: 'Unknown', email: 'unknown@unknown.com' };
  if (email.from) {
    if ('address' in email.from && email.from.address) {
      fromInfo = { name: email.from.name || email.from.address, email: email.from.address };
    } else if ('group' in email.from && email.from.group && email.from.group.length > 0) {
      const first = email.from.group[0];
      fromInfo = { name: first.name || first.address, email: first.address };
    }
  }

  const newsletter = isNewsletter(email);
  const newsletterName = newsletter ? extractNewsletterName(email) : '';

  return {
    messageId: email.messageId || `local-${Date.now()}`,
    from: fromInfo,
    subject: email.subject || '(no subject)',
    date: email.date ? new Date(email.date) : new Date(),
    body: email.text || '',
    rawHtml: email.html || '',
    source,
    attachments: email.attachments || [],
    isNewsletter: newsletter,
    newsletterName,
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function processFile(emlxPath: string): Promise<void> {
  const basename = path.basename(emlxPath);
  console.log(`\n── Processing: ${basename} ──`);

  // 1. Extract RFC822 from .emlx
  const rfc822 = extractRfc822FromEmlx(emlxPath);
  console.log(`   RFC822 size: ${(rfc822.length / 1024).toFixed(1)} KB`);

  // 2. Parse with postal-mime
  const parser = new PostalMime();
  const email = await parser.parse(rfc822);
  console.log(`   From: ${email.from && 'name' in email.from ? email.from.name : 'unknown'}`);
  console.log(`   Subject: ${email.subject}`);
  console.log(`   Has HTML: ${!!email.html} (${((email.html || '').length / 1024).toFixed(1)} KB)`);
  console.log(`   Is Newsletter: ${isNewsletter(email)}`);

  // 3. Build ParsedEmail
  const parsed = buildParsedEmail(email);

  // 4. Generate filenames (just the basename, since we're writing to a flat folder)
  const newsletterFolder = '0 - INBOX/NEWSLETTERS';
  const baseFilename = generateNewsletterBaseFilename(parsed, newsletterFolder);
  // Strip the folder prefix — we're writing directly to the vault folder
  const filenameOnly = baseFilename.replace(`${newsletterFolder}/`, '');

  const htmlFilename = filenameOnly + '.html';
  const mdFilename = filenameOnly + '.md';

  console.log(`   Output base: ${filenameOnly}`);

  // 5. Clean HTML
  let htmlContent: string | null = null;
  if (parsed.rawHtml) {
    htmlContent = cleanNewsletterHtml(parsed.rawHtml);
    const reduction = ((1 - htmlContent.length / parsed.rawHtml.length) * 100).toFixed(1);
    console.log(`   Cleaned HTML: ${(htmlContent.length / 1024).toFixed(1)} KB (${reduction}% reduction)`);
  } else {
    console.log('   No HTML body — sidecar will contain text directly');
  }

  // 6. Generate sidecar markdown
  const sidecarMd = generateNewsletterSidecarMarkdown(parsed, htmlContent ? htmlFilename : null);

  // 7. Write files to vault
  const htmlOutputPath = path.join(VAULT_NEWSLETTERS, htmlFilename);
  const mdOutputPath = path.join(VAULT_NEWSLETTERS, mdFilename);

  if (htmlContent) {
    fs.writeFileSync(htmlOutputPath, htmlContent, 'utf-8');
    console.log(`   Wrote HTML: ${htmlOutputPath}`);
  }

  fs.writeFileSync(mdOutputPath, sidecarMd, 'utf-8');
  console.log(`   Wrote MD:   ${mdOutputPath}`);
}

async function main() {
  // Verify output directory exists
  if (!fs.existsSync(VAULT_NEWSLETTERS)) {
    console.error(`Newsletter folder not found: ${VAULT_NEWSLETTERS}`);
    process.exit(1);
  }

  // Determine which files to process
  const args = process.argv.slice(2);
  let files: string[];

  if (args.length > 0) {
    // Specific files passed as arguments
    files = args.map(f => path.resolve(f));
  } else {
    // All .emlx files in sample_eml/
    files = fs.readdirSync(SAMPLE_DIR)
      .filter(f => f.endsWith('.emlx'))
      .map(f => path.join(SAMPLE_DIR, f));
  }

  if (files.length === 0) {
    console.log('No .emlx files found.');
    return;
  }

  console.log(`Processing ${files.length} file(s)...`);
  console.log(`Output dir: ${VAULT_NEWSLETTERS}`);

  for (const file of files) {
    try {
      await processFile(file);
    } catch (err) {
      console.error(`   ERROR processing ${path.basename(file)}:`, err);
    }
  }

  console.log('\nDone!');
}

main();
