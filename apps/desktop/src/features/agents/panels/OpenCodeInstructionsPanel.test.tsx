import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OpenCodeInstructionsPanel } from './OpenCodeInstructionsPanel'
import type { FileResourceItem } from './FileResourcePanel'

const instructionsItem: FileResourceItem = {
  key: '/tmp/opencode.json',
  name: 'opencode.json',
  path: '/tmp/opencode.json',
  content: '{}\n',
}

describe('OpenCodeInstructionsPanel', () => {
  it('saves instruction path edits into the config file', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <OpenCodeInstructionsPanel
        items={[instructionsItem]}
        scope="GLOBAL"
        projectName={null}
        saving={null}
        onSave={onSave}
        onCreate={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('.cursor/rules/*.md'), { target: { value: 'docs/guidelines.md' } })
    fireEvent.click(screen.getByText('Add'))
    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      '/tmp/opencode.json',
      '{\n  "instructions": [\n    "docs/guidelines.md"\n  ]\n}\n',
    )
  })
})
