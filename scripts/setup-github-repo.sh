#!/usr/bin/env bash
# One-time GitHub repo setup: description, topics, security reporting, Pages.
# Requires: brew install gh && gh auth login
set -euo pipefail

REPO="${1:-Jlack6/open-sim}"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found. Install with: brew install gh && gh auth login" >&2
  exit 1
fi

echo "Updating repo metadata for ${REPO}..."
gh repo edit "${REPO}" \
  --description "MCP server that lets Claude drive the iOS Simulator via simctl and XCUITest." \
  --add-topic mcp \
  --add-topic ios-simulator \
  --add-topic cursor \
  --add-topic xcuitest \
  --add-topic simctl \
  --add-topic open-sim

echo "Enabling private vulnerability reporting..."
gh api --method PUT "/repos/${REPO}/private-vulnerability-reporting" \
  -f enabled=true

echo "Enabling GitHub Pages (GitHub Actions source)..."
if gh api "/repos/${REPO}/pages" >/dev/null 2>&1; then
  gh api --method PUT "/repos/${REPO}/pages" -f build_type=workflow
else
  gh api --method POST "/repos/${REPO}/pages" -f build_type=workflow
fi

echo ""
echo "Done. Deploy the website manually when ready:"
echo "  GitHub → Actions → Deploy website → Run workflow"
echo "Live URL (after a successful run): https://jlack6.github.io/open-sim/"
