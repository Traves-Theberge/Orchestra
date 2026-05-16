export type OpenCodeSkillFrontmatter = {
  name: string
  description: string
  license?: string
  compatibility?: string
}

export function parseOpenCodeSkill(content: string): { frontmatter: OpenCodeSkillFrontmatter, body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    return { frontmatter: { name: '', description: '' }, body: content }
  }

  const frontmatter: OpenCodeSkillFrontmatter = { name: '', description: '' }
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf(':')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    switch (key) {
      case 'name': frontmatter.name = value; break
      case 'description': frontmatter.description = value; break
      case 'license': frontmatter.license = value; break
      case 'compatibility': frontmatter.compatibility = value; break
    }
  }

  return { frontmatter, body: match[2] ?? '' }
}

export function buildOpenCodeSkill(content: OpenCodeSkillFrontmatter, body: string): string {
  const lines = [
    `name: ${content.name.trim()}`,
    `description: ${content.description.trim()}`,
  ]
  if (content.license?.trim()) lines.push(`license: ${content.license.trim()}`)
  if (content.compatibility?.trim()) lines.push(`compatibility: ${content.compatibility.trim()}`)

  const normalizedBody = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return `---\n${lines.join('\n')}\n---\n\n${normalizedBody.trimEnd()}\n`
}
