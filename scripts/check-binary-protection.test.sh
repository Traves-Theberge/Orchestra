#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/.cache"
# Keep isolated fixtures under ignored scratch; never stage test binaries in the app.
scratch="$(mktemp -d "$root/.cache/binary-policy.XXXXXX")"
git init -q "$scratch"
cd "$scratch"
mkdir -p apps/desktop/electron/assets
cp "$root/apps/desktop/electron/assets/icon.png" apps/desktop/electron/assets/icon.png
git add apps/desktop/electron/assets/icon.png
bash "$root/scripts/check-binary-protection.sh" --repo

# The exception is one PNG asset, not permission to commit other native binaries.
printf '\x00\x01\x02' > apps/desktop/electron/assets/unexpected.bin
git add apps/desktop/electron/assets/unexpected.bin
if bash "$root/scripts/check-binary-protection.sh" --repo; then
  echo 'FAIL: unexpected binary was allowed' >&2
  exit 1
fi
git rm -q --cached apps/desktop/electron/assets/unexpected.bin

# A binary payload renamed to the approved image path must remain blocked.
printf '\x00\x01\x02' > apps/desktop/electron/assets/icon.png
git add apps/desktop/electron/assets/icon.png
if bash "$root/scripts/check-binary-protection.sh" --repo; then
  echo 'FAIL: non-PNG payload at icon path was allowed' >&2
  exit 1
fi
echo 'PASS: real icon accepted; unexpected and disguised binaries rejected'
