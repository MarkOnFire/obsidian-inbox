#!/bin/bash
# init.sh - Bootstrap development environment for cloudflare-email-to-obsidian
#
# Run this at the start of every development session to ensure
# consistent environment state.

set -e

echo "=== Cloudflare Email to Obsidian - Init ==="

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
required_files=("src/worker.ts" "wrangler.toml" "package.json" "feature_list.json" "claude-progress.txt")
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
echo "  1. Read claude-progress.txt for context"
echo "  2. Check feature_list.json for next pending feature"
echo "  3. Run 'npm run dev' for local development"
echo ""
