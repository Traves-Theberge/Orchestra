import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodexConfigPanel } from './CodexConfigPanel'
import type { FileResourceItem } from './FileResourcePanel'

const configItem: FileResourceItem = {
  key: '/tmp/.codex/config.toml',
  name: 'config.toml',
  path: '/tmp/.codex/config.toml',
  content: 'model = "gpt-5.3-codex"\n',
}

describe('CodexConfigPanel', () => {
  it('saves structured Codex config edits as TOML', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <CodexConfigPanel
        items={[configItem]}
        scope="GLOBAL"
        projectName={null}
        saving={null}
        onSave={onSave}
        onCreate={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('gpt-5.3-codex'), { target: { value: 'gpt-5.4' } })
    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      '/tmp/.codex/config.toml',
      'model = "gpt-5.4"\n',
    )
  })
})
