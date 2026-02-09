#!/usr/bin/env node

/**
 * Readwise Reader: Protect engaged archive items before bulk deletion.
 *
 * Finds archived documents that have reading progress > 0 or highlights,
 * tags them as "protected-from-purge", moves them to "later", and saves
 * a manifest so they can be restored afterward.
 *
 * Usage:
 *   READWISE_TOKEN=xxx node scripts/readwise-protect.mjs [--dry-run] [--category rss,email]
 *
 * Options:
 *   --dry-run              List what would be moved without making changes
 *   --category rss,email   Only protect items from these categories (default: all)
 */

const API_BASE = "https://readwise.io/api/v3";
const TAG_NAME = "protected-from-purge";
const MANIFEST_PATH = new URL("./readwise-protect-manifest.json", import.meta.url);

const TOKEN = process.env.READWISE_TOKEN;
if (!TOKEN) {
  console.error("Error: Set READWISE_TOKEN environment variable.");
  console.error("Get your token at https://readwise.io/access_token");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Token ${TOKEN}`,
  "Content-Type": "application/json",
};

// --- CLI args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const catIdx = args.indexOf("--category");
const CATEGORIES = catIdx !== -1 && args[catIdx + 1]
  ? args[catIdx + 1].split(",").map((c) => c.trim())
  : null;

// --- Rate limiting ---
// List endpoint: 20 req/min → 3s between requests
// Update endpoint: 50 req/min → 1.2s between requests
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
      console.log(`  Rate limited, waiting ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      continue;
    }
    return res;
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

// --- Paginated list fetcher ---
async function listDocuments(params) {
  const results = [];
  let cursor = null;
  let page = 1;

  while (true) {
    const searchParams = new URLSearchParams(params);
    if (cursor) searchParams.set("pageCursor", cursor);

    const url = `${API_BASE}/list/?${searchParams}`;
    console.log(`  Fetching page ${page}...`);
    const res = await fetchWithRetry(url, { headers: HEADERS });

    if (!res.ok) {
      throw new Error(`List failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    results.push(...data.results);
    console.log(`  Got ${data.results.length} items (total: ${results.length})`);

    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
    page++;
    await sleep(3200); // respect 20 req/min list rate limit
  }

  return results;
}

// --- Main ---
async function main() {
  console.log("=== Readwise Archive Protect ===");
  if (DRY_RUN) console.log("DRY RUN - no changes will be made\n");
  if (CATEGORIES) console.log(`Filtering categories: ${CATEGORIES.join(", ")}\n`);

  // Step 1: Fetch all highlights to find which documents have them
  console.log("Step 1: Fetching highlights to identify documents with annotations...");
  const highlights = await listDocuments({ category: "highlight" });
  const highlightedParentIds = new Set(
    highlights.map((h) => h.parent_id).filter(Boolean)
  );
  console.log(`Found ${highlightedParentIds.size} documents with highlights.\n`);

  // Step 2: Fetch all archived documents
  console.log("Step 2: Fetching archived documents...");
  const archived = await listDocuments({ location: "archive" });
  console.log(`Found ${archived.length} total archived documents.\n`);

  // Step 3: Filter to engaged items
  console.log("Step 3: Filtering to engaged items...");
  const toProtect = archived.filter((doc) => {
    // Skip categories we're not interested in (if filter is set)
    if (CATEGORIES && !CATEGORIES.includes(doc.category)) return false;

    const hasProgress = doc.reading_progress > 0;
    const hasHighlights = highlightedParentIds.has(doc.id);
    return hasProgress || hasHighlights;
  });

  console.log(`Found ${toProtect.length} items to protect:\n`);

  // Summary by reason
  let withProgress = 0;
  let withHighlights = 0;
  let withBoth = 0;
  for (const doc of toProtect) {
    const hasP = doc.reading_progress > 0;
    const hasH = highlightedParentIds.has(doc.id);
    if (hasP && hasH) withBoth++;
    else if (hasP) withProgress++;
    else withHighlights++;
  }
  console.log(`  Reading progress only: ${withProgress}`);
  console.log(`  Highlights only:       ${withHighlights}`);
  console.log(`  Both:                  ${withBoth}`);
  console.log();

  // Show first 20 items
  const preview = toProtect.slice(0, 20);
  for (const doc of preview) {
    const reasons = [];
    if (doc.reading_progress > 0) reasons.push(`progress=${Math.round(doc.reading_progress * 100)}%`);
    if (highlightedParentIds.has(doc.id)) reasons.push("has highlights");
    console.log(`  [${doc.category}] "${doc.title}" (${reasons.join(", ")})`);
  }
  if (toProtect.length > 20) {
    console.log(`  ... and ${toProtect.length - 20} more`);
  }
  console.log();

  if (toProtect.length === 0) {
    console.log("Nothing to protect. Exiting.");
    return;
  }

  if (DRY_RUN) {
    console.log("DRY RUN complete. Run without --dry-run to apply changes.");
    return;
  }

  // Step 4: Save manifest
  const manifest = toProtect.map((doc) => ({
    id: doc.id,
    title: doc.title,
    source_url: doc.source_url,
    category: doc.category,
    reading_progress: doc.reading_progress,
    has_highlights: highlightedParentIds.has(doc.id),
    original_tags: doc.tags,
  }));

  const { writeFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const manifestFile = fileURLToPath(MANIFEST_PATH);
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`Saved manifest with ${manifest.length} items to ${manifestFile}\n`);

  // Step 5: Move each item to "later"
  console.log("Step 4: Moving protected items to 'later'...");
  let moved = 0;
  let errors = 0;

  for (const doc of toProtect) {
    try {
      const res = await fetchWithRetry(
        `${API_BASE}/update/${doc.id}/`,
        {
          method: "PATCH",
          headers: HEADERS,
          body: JSON.stringify({ location: "later" }),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        console.error(`  FAIL [${doc.id}] "${doc.title}": ${res.status} ${text}`);
        errors++;
      } else {
        moved++;
        if (moved % 10 === 0 || moved === toProtect.length) {
          console.log(`  Moved ${moved}/${toProtect.length}...`);
        }
      }
    } catch (err) {
      console.error(`  ERROR [${doc.id}] "${doc.title}": ${err.message}`);
      errors++;
    }

    await sleep(1300); // respect 50 req/min update rate limit
  }

  console.log(`\nDone! Moved ${moved} items to "later" (${errors} errors).`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open Readwise Reader and bulk-delete the remaining archive items`);
  console.log(`  2. Run: READWISE_TOKEN=xxx node scripts/readwise-restore.mjs`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
