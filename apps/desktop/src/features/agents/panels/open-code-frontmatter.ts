export type OpenCodeFrontmatter = Record<string, string>

export function parseOpenCodeMarkdown(content: string): { frontmatter: OpenCodeFrontmatter, body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const frontmatter: OpenCodeFrontmatter = {}
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf(':')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (key) frontmatter[key] = value
  }

  return { frontmatter, body: match[2] ?? '' }
}

export function buildOpenCodeMarkdown(frontmatter: OpenCodeFrontmatter, body: string): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(frontmatter)) {
    const trimmed = value.trim()
    if (trimmed === '') continue
    lines.push(`${key}: ${trimmed}`)
  }

  const normalizedBody = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return `---\n${lines.join('\n')}\n---\n\n${normalizedBody.trimEnd()}\n`
}
