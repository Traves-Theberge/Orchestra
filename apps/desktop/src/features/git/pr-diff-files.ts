export type PRDiffFile = { path: string; oldPath?: string; binary: boolean; diff: string; additions: number; deletions: number }

function decodePath(path: string): string {
  if (path.startsWith('"')) {
    // Git uses C-style octal UTF-8 escapes, which JSON.parse does not decode.
    const bytes: number[] = []
    const text = path.slice(1, -1)
    for (let i = 0; i < text.length; i++) {
      const octal = text.slice(i).match(/^\\([0-7]{1,3})/)
      if (octal) { bytes.push(parseInt(octal[1], 8)); i += octal[0].length - 1; continue }
      if (text[i] === '\\' && i + 1 < text.length) {
        const escaped = text[++i]
        bytes.push(...new TextEncoder().encode(({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[escaped] ?? escaped))
      } else bytes.push(...new TextEncoder().encode(text[i]))
    }
    return new TextDecoder().decode(new Uint8Array(bytes))
  }
  return path
}

export function splitPRDiff(diff: string): PRDiffFile[] {
  const sections = diff.split(/(?=^diff --git )/m).filter(section => section.trim())
  return sections.map((section, index) => {
    const lines = section.split('\n')
    const renamed = lines.find(line => line.startsWith('rename to '))?.slice(10).trimEnd()
    const oldPath = lines.find(line => line.startsWith('rename from '))?.slice(12).trimEnd()
    const target = lines.find(line => line.startsWith('+++ ') && line.trimEnd() !== '+++ /dev/null')
      ?? lines.find(line => line.startsWith('--- '))
    // Binary and rename-only changes lack ---/+++ headers. Read the b/ side
    // of the boundary, including quoted Git paths and unquoted spaces.
    const boundary = lines[0].match(/^diff --git (?:"(?:[^"\\]|\\.)*"|a\/.*?) ("(?:[^"\\]|\\.)*"|b\/.*)\r?$/)
    const path = renamed ? decodePath(renamed) : decodePath(target?.slice(4).trimEnd() ?? boundary?.[1] ?? `Change ${index + 1}`).replace(/^[ab]\//, '')
    const hunks = section.slice(section.search(/^@@ /m) >= 0 ? section.search(/^@@ /m) : section.length).split('\n')
    return {
      path, oldPath: oldPath ? decodePath(oldPath) : undefined, binary: lines.some(line => line.startsWith('Binary files ') || line.trimEnd() === 'GIT binary patch'), diff: section,
      additions: hunks.filter(line => line.startsWith('+')).length,
      deletions: hunks.filter(line => line.startsWith('-')).length,
    }
  })
}
