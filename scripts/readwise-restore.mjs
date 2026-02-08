#!/usr/bin/env node

/**
 * Readwise Reader: Restore protected items back to archive.
 *
 * Reads the manifest created by readwise-protect.mjs and moves all
 * protected items from "later" back to "archive".
 *
 * Usage:
 *   READWISE_TOKEN=xxx node scripts/readwise-restore.mjs [--dry-run]
 */

const API_BASE = "https://readwise.io/api/v3";
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

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

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

async function main() {
  console.log("=== Readwise Archive Restore ===");
  if (DRY_RUN) console.log("DRY RUN - no changes will be made\n");

  // Step 1: Load manifest
  const { readFileSync, writeFileSync, unlinkSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const manifestFile = fileURLToPath(MANIFEST_PATH);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
  } catch (err) {
    console.error(`Error: Could not read manifest at ${manifestFile}`);
    console.error("Run readwise-protect.mjs first to create the manifest.");
    process.exit(1);
  }

  console.log(`Loaded manifest with ${manifest.length} items to restore.\n`);

  // Show first 20
  const preview = manifest.slice(0, 20);
  for (const doc of preview) {
    const reasons = [];
    if (doc.reading_progress > 0) reasons.push(`progress=${Math.round(doc.reading_progress * 100)}%`);
    if (doc.has_highlights) reasons.push("has highlights");
    console.log(`  [${doc.category}] "${doc.title}" (${reasons.join(", ")})`);
  }
  if (manifest.length > 20) {
    console.log(`  ... and ${manifest.length - 20} more`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("DRY RUN complete. Run without --dry-run to apply changes.");
    return;
  }

  // Step 2: Move each item back to archive
  console.log("Moving items back to archive...");
  let restored = 0;
  let errors = 0;
  const failed = [];

  for (const doc of manifest) {
    try {
      const res = await fetchWithRetry(
        `${API_BASE}/update/${doc.id}/`,
        {
          method: "PATCH",
          headers: HEADERS,
          body: JSON.stringify({ location: "archive" }),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        // 404 likely means the document was deleted during the purge — that's expected
        if (res.status === 404) {
          console.log(`  SKIP [${doc.id}] "${doc.title}": already deleted`);
        } else {
          console.error(`  FAIL [${doc.id}] "${doc.title}": ${res.status} ${text}`);
          failed.push(doc);
        }
        errors++;
      } else {
        restored++;
        if (restored % 10 === 0 || restored === manifest.length) {
          console.log(`  Restored ${restored}/${manifest.length}...`);
        }
      }
    } catch (err) {
      console.error(`  ERROR [${doc.id}] "${doc.title}": ${err.message}`);
      failed.push(doc);
      errors++;
    }

    await sleep(1300); // respect 50 req/min update rate limit
  }

  console.log(`\nDone! Restored ${restored} items to archive (${errors} errors).`);

  if (failed.length > 0) {
    const failedFile = fileURLToPath(new URL("./readwise-restore-failed.json", import.meta.url));
    writeFileSync(failedFile, JSON.stringify(failed, null, 2));
    console.log(`\nFailed items saved to ${failedFile} for manual review.`);
  } else {
    // Clean up manifest on full success
    try {
      unlinkSync(manifestFile);
      console.log(`\nManifest file cleaned up.`);
    } catch {
      // ignore cleanup errors
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
