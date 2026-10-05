import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { parseOpenCodeMarkdown, updateOpenCodeMarkdown } from './open-code-frontmatter'

describe('OpenCode definition editing', () => {
  const source = '---\n# Preserve native policy\ndescription: "Review: carefully"\nmode: primary\npermission:\n  edit: deny\n  bash:\n    "git status": allow\nhidden: false\ncustom:\n  values: [one, two]\n---\n\nReview changes.\n'

  it('retains nested policies, unknown fields and comments when editing fields', () => {
    const result = updateOpenCodeMarkdown(source, { description: 'Changed: safely', mode: 'all', model: '' }, 'New instructions.\n')
    const frontmatter = result.match(/^---\n([\s\S]*?)\n---/)?.[1]
    expect(parse(frontmatter ?? '')).toMatchObject({ description: 'Changed: safely', mode: 'all', permission: { edit: 'deny', bash: { 'git status': 'allow' } }, hidden: false, custom: { values: ['one', 'two'] } })
    expect(result).toContain('# Preserve native policy')
    expect(result).toContain('New instructions.')
  })

  it('decodes quoted scalars and Windows line endings without flattening nested keys', () => {
    const parsed = parseOpenCodeMarkdown(source.replace(/\n/g, '\r\n'))
    expect(parsed.frontmatter.description).toBe('Review: carefully')
    expect(parsed.frontmatter.edit).toBeUndefined()
  })

  it('keeps unedited documents byte-for-byte and refuses malformed edits', () => {
    const parsed = parseOpenCodeMarkdown(source)
    expect(updateOpenCodeMarkdown(source, { description: parsed.frontmatter.description, mode: 'primary', model: '' }, parsed.body)).toBe(source)
    expect(() => updateOpenCodeMarkdown('---\npermission: [broken\n---\ntext', { description: 'changed' }, 'text')).toThrow('Invalid agent frontmatter')
  })
})
