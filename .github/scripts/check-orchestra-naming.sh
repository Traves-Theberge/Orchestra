#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT_DIR"

# Enforce that new Orchestra implementation code does not reintroduce
# Symphony-specific symbol names. Compatibility strings for env keys and
# migration paths are allowed.

if rg --line-number --hidden --glob '!**/*_test.go' --glob '!**/docs/**' --glob '!**/packages/test-fixtures/**' '(?i)\bsymphony\b|\bSymphony[A-Za-z0-9_]*\b' apps/backend packages/protocol; then
  echo "Found forbidden legacy naming symbols in Orchestra code." >&2
  exit 1
fi

echo "Orchestra naming check passed."
