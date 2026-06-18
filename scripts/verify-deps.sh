#!/usr/bin/env bash
# Enforce full dependency pinning + policy. Run from repo root or via npm run deps:verify
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

if [[ ! -f package.json || ! -f package-lock.json ]]; then
  echo "error: package.json and package-lock.json are required" >&2
  exit 1
fi

if ! git ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then
  echo "verify-deps: package-lock.json is not tracked in git" >&2
  exit 1
fi

node scripts/verify-overrides.mjs
