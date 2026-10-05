import { describe, it, expect } from 'vitest'
import { splitPRDiff } from './pr-diff-files'

describe('PR file boundaries', () => {
  it('preserves binary, rename-only, deleted and added file identities', () => {
    const files = splitPRDiff('diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\ndiff --git a/old name.ts b/new name.ts\nsimilarity index 100%\nrename from old name.ts\nrename to new name.ts\ndiff --git a/deleted.ts b/deleted.ts\n--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\ndiff --git a/added.ts b/added.ts\n--- /dev/null\n+++ b/added.ts\n@@ -0,0 +1 @@\n+added')
    expect(files.map(file => file.path)).toEqual(['logo.png', 'new name.ts', 'deleted.ts', 'added.ts'])
    expect(files[0].binary).toBe(true)
    expect(files[1].oldPath).toBe('old name.ts')
    expect(files[2].deletions).toBe(1)
    expect(files[3].additions).toBe(1)
  })
  it('decodes Git C-style UTF-8 escaped paths without confusing headers and hunks', () => {
    const files = splitPRDiff('diff --git "a/\\303\\251.ts" "b/\\303\\251.ts"\n--- "a/\\303\\251.ts"\n+++ "b/\\303\\251.ts"\n@@ -1 +1 @@\n---old\n+++new')
    expect(files[0].path).toBe('é.ts')
    expect(files[0].additions).toBe(1)
    expect(files[0].deletions).toBe(1)
  })
})
