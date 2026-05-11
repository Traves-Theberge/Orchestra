import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GeminiCommandsPanel } from './GeminiCommandsPanel'
import type { FileResourceItem } from './FileResourcePanel'

const baseItem: FileResourceItem = {
  key: '/tmp/daily-summary.toml',
  name: 'daily-summary.toml',
  path: '/tmp/daily-summary.toml',
  content: 'description = "Daily Summary"\nprompt = """\nDescribe the task.\n"""\n',
}

describe('GeminiCommandsPanel', () => {
  it('saves TOML command edits using structured fields', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <GeminiCommandsPanel
        items={[baseItem]}
        scope="GLOBAL"
        projectName={null}
        saving={null}
        onSave={onSave}
        onDelete={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    const description = screen.getByDisplayValue('Daily Summary')
    fireEvent.change(description, { target: { value: 'Updated Summary' } })

    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      '/tmp/daily-summary.toml',
      'description = "Updated Summary"\nprompt = """\nDescribe the task.\n"""\n',
    )
  })

  it('keeps legacy markdown commands editable in raw mode', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <GeminiCommandsPanel
        items={[{
          ...baseItem,
          key: '/tmp/legacy.md',
          name: 'legacy.md',
          path: '/tmp/legacy.md',
          content: '# Legacy command\n\nRun the old workflow.\n',
        }]}
        scope="GLOBAL"
        projectName={null}
        saving={null}
        onSave={onSave}
        onDelete={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '# Legacy command\n\nRun the new workflow.\n' } })

    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      '/tmp/legacy.md',
      '# Legacy command\n\nRun the new workflow.\n',
    )
  })
})
