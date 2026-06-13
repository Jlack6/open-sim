#!/usr/bin/env bash
# Use GitHub's private noreply email for commits in this repo (local config only).
# Run once after cloning: ./scripts/use-private-git-email.sh
# Also wired via .githooks/ (pre-commit + pre-push) when hooksPath is enabled below.
#
# Also enable on GitHub: Settings → Emails → "Keep my email addresses private"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUIET=false
if [[ "${1:-}" == "--quiet" ]]; then
  QUIET=true
fi

git config --local user.email "Jlack6@users.noreply.github.com"
git config --local user.name "James Lack"
git config --local core.hooksPath .githooks

if [[ "$QUIET" != true ]]; then
  echo "Local git identity for open-sim:"
  git config --local --get user.name
  git config --local --get user.email
  echo "Git hooks enabled from .githooks/ (pre-commit + pre-push)"
fi
