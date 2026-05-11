import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OpenCodeCommandsPanel } from './OpenCodeCommandsPanel'
import type { FileResourceItem } from './FileResourcePanel'

const commandItem: FileResourceItem = {
  key: '/tmp/commands/test.md',
  name: 'test',
  path: '/tmp/commands/test.md',
  content: '---\ndescription: Run tests\nagent: build\nmodel: openai/gpt-5\n---\n\npnpm test\n',
}

describe('OpenCodeCommandsPanel', () => {
  it('saves structured OpenCode command frontmatter edits', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <OpenCodeCommandsPanel
        items={[commandItem]}
        scope="GLOBAL"
        projectName={null}
        saving={null}
        onSave={onSave}
        onDelete={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('Run tests'), { target: { value: 'Run tests with coverage' } })
    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      '/tmp/commands/test.md',
      '---\ndescription: Run tests with coverage\nagent: build\nmodel: openai/gpt-5\n---\n\n\npnpm test\n',
    )
  })
})
