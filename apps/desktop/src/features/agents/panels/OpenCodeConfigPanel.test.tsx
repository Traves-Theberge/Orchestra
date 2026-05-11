import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OpenCodeConfigPanel } from './OpenCodeConfigPanel'
import type { FileResourceItem } from './FileResourcePanel'

const configItem: FileResourceItem = {
  key: '/tmp/opencode.json',
  name: 'opencode.json',
  path: '/tmp/opencode.json',
  content: '{}\n',
}

describe('OpenCodeConfigPanel', () => {
  it('saves structured OpenCode config edits as JSON', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <OpenCodeConfigPanel
        items={[configItem]}
        scope="GLOBAL"
        projectName={null}
        saving={null}
        onSave={onSave}
        onCreate={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('build'), { target: { value: 'planner' } })
    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      '/tmp/opencode.json',
      '{\n  "default_agent": "planner"\n}\n',
    )
  })
})
