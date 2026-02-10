#!/usr/bin/env node

/**
 * Agent Inbox Triage: Tier 1 light analysis for pending agent messages.
 *
 * Scans agent message notes for status: pending, extracts keywords,
 * searches The Library for related documentation, appends a
 * "## Related Context" section, and marks notes as triaged.
 *
 * Usage:
 *   node scripts/agent-inbox-triage.mjs [--dry-run] [--input-dir path]
 *
 * Options:
 *   --dry-run              Show what would be done without modifying files
 *   --input-dir path       Override the agent messages directory
 *
 * Environment:
 *   OBSIDIAN_VAULT_PATH    Path to Obsidian vault (default: iCloud vault)
 *   LIBRARY_PATH           Path to The Library (default: the-lodge/knowledge)
 */

const DEFAULT_VAULT_PATH =
  `${process.env.HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/MarkBrain`;
const DEFAULT_LIBRARY_PATH =
  `${process.env.HOME}/Developer/the-lodge/knowledge`;
const AGENT_MESSAGES_SUBDIR = "0 - INBOX/AGENT MESSAGES";

// Folders to search for related vault notes (future use — requires MCP)
// const VAULT_SEARCH_DIRS = ["1 - PROJECTS", "2 - AREAS"];

// Common words to strip from keyword extraction
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "this", "that", "was", "are",
  "be", "has", "had", "have", "will", "would", "could", "should", "may",
  "can", "do", "did", "not", "no", "so", "if", "then", "than", "also",
  "just", "more", "some", "any", "all", "each", "every", "both", "few",
  "most", "other", "into", "over", "such", "your", "you", "we", "our",
  "my", "its", "his", "her", "their", "been", "being", "were", "there",
  "here", "when", "where", "which", "who", "whom", "what", "how", "about",
  "up", "out", "as", "very", "only", "need", "check", "run", "may",
  // Date/time noise
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun", "date", "time",
  "2024", "2025", "2026", "2027",
  // Email metadata noise
  "com", "org", "net", "http", "https", "www", "email", "message", "sent",
  "subject", "agent", "local", "review", "readme",
]);

// --- CLI args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const inputDirIdx = args.indexOf("--input-dir");
const INPUT_DIR_OVERRIDE = inputDirIdx !== -1 ? args[inputDirIdx + 1] : null;

// --- Frontmatter parsing (no external dependencies) ---
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { data: {}, content, raw: "" };
  const yaml = {};
  const lines = match[1].split("\n");
  let currentKey = null;
  let currentList = null;

  for (const line of lines) {
    // Handle list items (e.g., tags)
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentKey && currentList) {
      currentList.push(listItem[1].trim());
      continue;
    }

    // Handle key: value pairs
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      // Flush previous list
      if (currentKey && currentList) {
        yaml[currentKey] = currentList;
        currentList = null;
      }
      currentKey = kv[1];
      const value = kv[2].trim();
      if (value === "") {
        // Could be start of a list
        currentList = [];
      } else {
        yaml[currentKey] = value.replace(/^["']|["']$/g, "");
        currentList = null;
      }
    }
  }
  // Flush final list
  if (currentKey && currentList) {
    yaml[currentKey] = currentList;
  }

  return { data: yaml, content: match[2], raw: match[1] };
}

function serializeFrontmatter(data, originalRaw) {
  // Replace status field in the original raw YAML to preserve formatting
  return originalRaw.replace(/^status:\s*.+$/m, `status: ${data.status}`);
}

// --- Keyword extraction ---
function extractKeywords(subject, body) {
  const text = `${subject || ""} ${body || ""}`;
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  // Deduplicate and return top terms by frequency
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);
}

// --- Recursive .md file collection ---
function collectMarkdownFiles(dirPath, readdirSync, statSync, join) {
  const results = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory() && entry.name !== "raw" && entry.name !== ".git") {
      results.push(...collectMarkdownFiles(fullPath, readdirSync, statSync, join));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push({ filePath: fullPath, fileName: entry.name });
    }
  }
  return results;
}

// --- Library search ---
async function searchLibrary(libraryPath, keywords) {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const matches = [];

  let topicDirs;
  try {
    topicDirs = readdirSync(libraryPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== ".git");
  } catch (err) {
    console.error(`  Warning: Could not read Library at ${libraryPath}: ${err.message}`);
    return matches;
  }

  for (const dir of topicDirs) {
    const topicPath = join(libraryPath, dir.name);
    let files;
    try {
      files = collectMarkdownFiles(topicPath, readdirSync, statSync, join);
    } catch {
      continue;
    }

    // Skip generic index files
    const SKIP_FILES = new Set(["readme.md", "index.md", "documentation_sources.md"]);

    for (const { filePath, fileName } of files) {
      // Skip raw files and generic index files
      if (filePath.includes("/raw/")) continue;
      if (SKIP_FILES.has(fileName.toLowerCase())) continue;

      // Match keywords against filename and content
      const fileNameLower = fileName.toLowerCase();
      const matchedKeywords = new Set();

      for (const kw of keywords) {
        if (fileNameLower.includes(kw)) {
          matchedKeywords.add(kw);
        }
      }

      // Also check first ~500 chars of content for additional matches
      try {
        const stat = statSync(filePath);
        if (stat.size > 0) {
          const content = readFileSync(filePath, "utf-8").slice(0, 500).toLowerCase();
          for (const kw of keywords) {
            if (content.includes(kw)) {
              matchedKeywords.add(kw);
            }
          }
        }
      } catch {
        // If we can't read, just use filename matches
      }

      // Require at least 2 keyword matches to reduce noise
      if (matchedKeywords.size >= 2) {
        matches.push({
          title: fileName.replace(/\.md$/, ""),
          topic: dir.name,
          keywords: [...matchedKeywords],
        });
      }
    }
  }

  // Sort by number of keyword matches (most relevant first)
  matches.sort((a, b) => b.keywords.length - a.keywords.length);
  return matches.slice(0, 10);
}

// --- Build the Related Context section ---
function buildContextSection(libraryMatches) {
  const lines = ["\n---\n## Related Context"];

  if (libraryMatches.length === 0) {
    lines.push("*No related notes or library resources found.*");
    return lines.join("\n");
  }

  // Note about vault search limitation
  lines.push("*Note: Vault search not available in v1 (iCloud sandbox). Library results only.*\n");

  for (const match of libraryMatches) {
    const kwList = match.keywords.map((k) => `"${k}"`).join(", ");
    lines.push(`- Library: "${match.title}" (${match.topic}) — matched on ${kwList}`);
  }

  return lines.join("\n");
}

// --- Main ---
async function main() {
  const { readdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const { join, resolve } = await import("node:path");

  console.log("=== Agent Inbox Triage ===");
  if (DRY_RUN) console.log("DRY RUN - no changes will be made\n");

  // Resolve paths
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH || DEFAULT_VAULT_PATH;
  const libraryPath = process.env.LIBRARY_PATH || DEFAULT_LIBRARY_PATH;
  const inputDir = INPUT_DIR_OVERRIDE
    ? resolve(INPUT_DIR_OVERRIDE)
    : join(vaultPath, AGENT_MESSAGES_SUBDIR);

  console.log(`Input directory: ${inputDir}`);
  console.log(`Library path:    ${libraryPath}\n`);

  // Step 1: Scan for pending agent messages
  console.log("Step 1: Scanning for pending agent messages...");
  let files;
  try {
    files = readdirSync(inputDir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith(".md"));
  } catch (err) {
    console.error(`Error: Could not read input directory: ${err.message}`);
    console.error("Use --input-dir to specify a readable path, or set OBSIDIAN_VAULT_PATH.");
    process.exit(1);
  }

  console.log(`Found ${files.length} .md files.\n`);

  // Step 2: Process each file
  console.log("Step 2: Processing pending notes...");
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = join(inputDir, file.name);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const { data, content, raw: rawYaml } = parseFrontmatter(raw);

      // Skip non-pending
      if (data.status !== "pending") {
        skipped++;
        continue;
      }

      // Skip already triaged (idempotency)
      if (content.includes("## Related Context")) {
        console.log(`  SKIP "${file.name}" — already has Related Context`);
        skipped++;
        continue;
      }

      console.log(`\n  Processing: ${file.name}`);

      // Extract keywords
      const keywords = extractKeywords(data.subject, content);
      console.log(`    Keywords: ${keywords.join(", ")}`);

      // Search Library
      const libraryMatches = await searchLibrary(libraryPath, keywords);
      console.log(`    Library matches: ${libraryMatches.length}`);

      if (libraryMatches.length > 0) {
        for (const m of libraryMatches) {
          console.log(`      - "${m.title}" (${m.topic}) [${m.keywords.join(", ")}]`);
        }
      }

      // Build output
      const contextSection = buildContextSection(libraryMatches);
      const updatedYaml = serializeFrontmatter({ ...data, status: "triaged" }, rawYaml);
      const updatedContent = `---\n${updatedYaml}\n---\n${content.trimEnd()}\n${contextSection}\n`;

      if (DRY_RUN) {
        console.log(`    [DRY RUN] Would update status to "triaged" and append Related Context`);
      } else {
        writeFileSync(filePath, updatedContent, "utf-8");
        console.log(`    Updated: status -> triaged, appended Related Context`);
      }

      processed++;
    } catch (err) {
      console.error(`  ERROR "${file.name}": ${err.message}`);
      errors++;
    }
  }

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Errors:    ${errors}`);

  if (DRY_RUN && processed > 0) {
    console.log("\nDRY RUN complete. Run without --dry-run to apply changes.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
