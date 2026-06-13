#!/usr/bin/env bash
# Block commits/pushes that contain personal paths, private emails, secrets,
# or gitignored local-only directories (knowledge/, test_cases/apps/, .env, etc.).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

FAIL=0
PASS_LABEL=""

report() {
  echo "check-no-secrets: $1" >&2
  FAIL=1
}

# Paths that must never land in the public repo (local-only on your machine).
is_blocked_path() {
  local f="$1"
  case "$f" in
    knowledge/*|knowledge) return 0 ;;
    test_cases/apps/*|test_cases/apps) return 0 ;;
    .env|.env.*|*/.env|*/.env.*) return 0 ;;
    -.png|-/*.png) return 0 ;; # accidental simctl screenshot named "-"
    *) ;;
  esac
  [[ "$f" == "-" || "$f" == "./-" ]] && return 0
  return 1
}

# Content patterns: personal info and common secret formats.
# Allowed: Jlack6@users.noreply.github.com, hello@example.com, public GitHub URLs.
CONTENT_PATTERNS=(
  '/Users/jameslack'
  'jameslack@jamess-air'
  '@myfiosgateway'
  'jlack6@gmail.com'
  'AKIA[0-9A-Z]{16}'
  'ghp_[a-zA-Z0-9]{36,}'
  'github_pat_[a-zA-Z0-9_]{20,}'
  'sk-[a-zA-Z0-9]{20,}'
  'xox[baprs]-[a-zA-Z0-9-]{10,}'
  'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY'
)

should_skip_content_scan() {
  local f="$1"
  case "$f" in
    scripts/check-no-secrets.sh) return 0 ;; # contains pattern definitions
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.woff|*.woff2|*.ttf|*.eot) return 0 ;;
    *.zip|*.tar|*.gz|*.br|*.pdf) return 0 ;;
    package-lock.json) return 0 ;; # large; low signal for personal paths
  esac
  return 1
}

scan_content() {
  local label="$1"
  local file="$2"
  should_skip_content_scan "$file" && return 0
  [[ -f "$file" ]] || return 0

  local pattern
  for pattern in "${CONTENT_PATTERNS[@]}"; do
    if grep -qE "$pattern" "$file" 2>/dev/null; then
      report "sensitive content in ${label} (matched: ${pattern})"
    fi
  done
}

scan_blob() {
  local label="$1"
  local file="$2"
  should_skip_content_scan "$file" && return 0
  local tmp
  tmp="$(mktemp)"
  if git show "$label" >"$tmp" 2>/dev/null; then
    local pattern
    for pattern in "${CONTENT_PATTERNS[@]}"; do
      if grep -qE "$pattern" "$tmp" 2>/dev/null; then
        report "sensitive content in ${file} (matched: ${pattern})"
      fi
    done
  fi
  rm -f "$tmp"
}

check_file() {
  local f="$1"
  [[ -n "$f" ]] || return 0
  if is_blocked_path "$f"; then
    report "blocked path (local-only, must stay off GitHub): ${f}"
    return 0
  fi
  scan_content "working tree ${f}" "$f"
}

check_staged() {
  local f
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if is_blocked_path "$f"; then
      report "blocked path staged for commit (local-only): ${f}"
      continue
    fi
    scan_blob ":${f}" "$f"
  done < <(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
}

check_push_range() {
  local range="$1"
  local sha="${range##*..}"
  [[ -z "$sha" || "$sha" == "$range" ]] && sha="$range"

  local f
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if is_blocked_path "$f"; then
      report "blocked path in commits being pushed (local-only): ${f}"
      continue
    fi
    scan_blob "${sha}:${f}" "$f"
  done < <(git diff --name-only "$range" 2>/dev/null || true)
}

check_push_hook() {
  local local_ref local_sha remote_ref remote_sha
  while read -r local_ref local_sha remote_ref remote_sha; do
    [[ -z "${local_ref:-}" ]] && continue
    [[ "$local_sha" == "0000000000000000000000000000000000000000" ]] && continue

    local range
    if [[ "$remote_sha" == "0000000000000000000000000000000000000000" ]]; then
      range="$local_sha"
    else
      range="${remote_sha}..${local_sha}"
    fi
    check_push_range "$range"
  done
}

check_tracked_tree() {
  local f
  while IFS= read -r f; do
    check_file "$f"
  done < <(git ls-files 2>/dev/null || true)
}

usage() {
  echo "Usage: $0 [--staged | --push | --tracked | FILE ...]" >&2
  exit 2
}

if [[ $# -eq 0 ]]; then
  usage
fi

case "${1:-}" in
  --staged)
    PASS_LABEL="staged files"
    check_staged
    ;;
  --push)
    PASS_LABEL="push"
    shift
    if [[ $# -gt 0 ]]; then
      check_push_hook "$@"
    else
      check_push_hook
    fi
    ;;
  --tracked)
    PASS_LABEL="tracked files"
    check_tracked_tree
    ;;
  --help|-h)
    usage
    ;;
  *)
    PASS_LABEL="specified files"
    local f
    for f in "$@"; do
      check_file "$f"
    done
    ;;
esac

if [[ "$FAIL" -ne 0 ]]; then
  echo "" >&2
  echo "Push/commit blocked. Remove personal info, secrets, or local-only files before retrying." >&2
  echo "Local-only paths: knowledge/, test_cases/apps/, .env*" >&2
  exit 1
fi

if [[ -n "$PASS_LABEL" ]]; then
  echo "open-sim: ✓ secret scan passed (${PASS_LABEL})"
fi

exit 0
