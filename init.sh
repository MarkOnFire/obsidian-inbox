#!/bin/bash
# init.sh - Bootstrap development environment for obsidian-inbox
#
# Run this at the start of every development session to ensure
# consistent environment state.

set -e

echo "=== Obsidian Inbox - Init ==="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is required but not installed."
    exit 1
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo "ERROR: npm is required but not installed."
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Type check
echo "Running type check..."
npm run typecheck || {
    echo "WARNING: Type check failed. Review errors above."
}

# Check wrangler auth
echo "Checking Cloudflare authentication..."
if npx wrangler whoami &> /dev/null; then
    echo "Authenticated with Cloudflare."
else
    echo "WARNING: Not authenticated with Cloudflare. Run 'npx wrangler login' to authenticate."
fi

# Check for required files
echo "Checking project structure..."
required_files=("src/worker.ts" "wrangler.toml" "package.json" "planning/progress.md" "planning/backlog.md")
for file in "${required_files[@]}"; do
    if [[ -f "$file" ]]; then
        echo "  ✓ $file"
    else
        echo "  ✗ $file (missing)"
    fi
done

echo ""
echo "=== Init Complete ==="
echo ""
echo "Next steps:"
echo "  1. Read planning/progress.md for context"
echo "  2. Check planning/backlog.md for pending work"
echo "  3. Run 'npm run dev' for local development"
echo ""
