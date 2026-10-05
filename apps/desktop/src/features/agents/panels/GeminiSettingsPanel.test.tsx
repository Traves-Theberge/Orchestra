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

  it('keeps provider settings selection in the file scope until the explicit save action', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const item = { ...settingsItem, content: '{"telemetry":{"target":"local"}}\n' }
    render(
      <GeminiSettingsPanel
        items={[item]}
        scope="PROJECT"
        projectName="Fixture project"
        saving={null}
        onSave={onSave}
        onCreate={vi.fn()}
      />,
    )

    const target = screen.getByText('Target').parentElement?.querySelector('select')
    expect(target).not.toBeNull()
    fireEvent.change(target!, { target: { value: 'gcp' } })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      '/tmp/settings.json',
      '{\n  "telemetry": {\n    "target": "gcp"\n  }\n}\n',
    )
  })
})
