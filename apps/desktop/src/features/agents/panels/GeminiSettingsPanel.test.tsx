import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GeminiSettingsPanel } from './GeminiSettingsPanel'
import type { FileResourceItem } from './FileResourcePanel'

const settingsItem: FileResourceItem = {
  key: '/tmp/settings.json',
  name: 'settings.json',
  path: '/tmp/settings.json',
  content: '{}\n',
}

describe('GeminiSettingsPanel', () => {
  it('saves structured Gemini settings edits as JSON', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <GeminiSettingsPanel
        items={[settingsItem]}
        scope="GLOBAL"
        projectName={null}
        saving={null}
        onSave={onSave}
        onCreate={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('code'), { target: { value: 'zed' } })
    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      '/tmp/settings.json',
      '{\n  "general": {\n    "preferredEditor": "zed"\n  }\n}\n',
    )
  })
})
