import { Document, isMap, isScalar, parseDocument } from 'yaml'

export type OpenCodeFrontmatter = Record<string, string>

export function parseOpenCodeMarkdown(content: string): { frontmatter: OpenCodeFrontmatter, body: string } {
  const match = content.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const frontmatter: OpenCodeFrontmatter = {}
  const document = parseDocument(match[1])
  if (document.errors.length === 0 && isMap(document.contents)) {
    for (const pair of document.contents.items) {
      if (isScalar(pair.key) && typeof pair.key.value === 'string' && isScalar(pair.value)) {
        frontmatter[pair.key.value] = String(pair.value.value ?? '')
      }
    }
  }

  return { frontmatter, body: match[2] ?? '' }
}

/** Change the displayed fields without discarding native permissions or extra keys. */
export function updateOpenCodeMarkdown(content: string, fields: OpenCodeFrontmatter, body: string): string {
  const parsed = parseOpenCodeMarkdown(content)
  if (body === parsed.body && Object.entries(fields).every(([key, value]) => value === (parsed.frontmatter[key] ?? ''))) return content
  const match = content.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const document = match ? parseDocument(match[1]) : new Document({})
  if (document.errors.length || !isMap(document.contents)) throw new Error('Invalid agent frontmatter. Correct the source file before editing its fields.')
  for (const [key, value] of Object.entries(fields)) {
    if (value.trim()) document.set(key, value.trim())
    else document.delete(key)
  }
  return `---\n${document.toString()}---\n\n${body.replace(/\r\n/g, '\n').trimEnd()}\n`
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
