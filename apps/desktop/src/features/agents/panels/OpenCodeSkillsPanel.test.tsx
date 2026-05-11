import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OpenCodeSkillsPanel } from './OpenCodeSkillsPanel'
import type { FileResourceItem } from './FileResourcePanel'

const skillItem: FileResourceItem = {
  key: '/tmp/skills/git-release/SKILL.md',
  name: 'git-release',
  path: '/tmp/skills/git-release/SKILL.md',
  content: '---\nname: git-release\ndescription: Prepare releases\nlicense: MIT\ncompatibility: opencode\n---\n\nRelease steps go here.\n',
}

describe('OpenCodeSkillsPanel', () => {
  it('saves structured skill frontmatter edits', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <OpenCodeSkillsPanel
        items={[skillItem]}
        scope="GLOBAL"
        projectName={null}
        saving={null}
        onSave={onSave}
        onDelete={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    const description = screen.getByDisplayValue('Prepare releases')
    fireEvent.change(description, { target: { value: 'Prepare tagged releases' } })

    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      '/tmp/skills/git-release/SKILL.md',
      '---\nname: git-release\ndescription: Prepare tagged releases\nlicense: MIT\ncompatibility: opencode\n---\n\n\nRelease steps go here.\n',
    )
  })
})
