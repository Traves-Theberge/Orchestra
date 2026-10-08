import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceChatRewindPreview } from '@core/api/client'
import { RewindDialog, REWIND_STANDING_NOTE } from './RewindDialog'

const preview: WorkspaceChatRewindPreview = {
  message_id: 'u1', has_checkpoint: true, files_available: true,
  changes: [{ path: 'src/a.ts', kind: 'modify' }, { path: 'src/new.ts', kind: 'delete' }, { path: 'docs/gone.md', kind: 'create' }],
  changed_since_turn: ['src/a.ts'], skipped: 0,
}
type Props = React.ComponentProps<typeof RewindDialog>
const base = (overrides: Partial<Props> = {}): Props => ({
  open: true, mode: 'edit', preview, previewLoading: false, previewError: null, busy: false, error: null,
  onConfirm: vi.fn(), onCancel: vi.fn(), ...overrides,
})
afterEach(() => cleanup())

const filesChoice = () => screen.getByRole('radio', { name: /Conversation and files/ })
const conversationChoice = () => screen.getByRole('radio', { name: /Conversation only/ })

describe('RewindDialog', () => {
  it('titles and labels the confirm button by mode', () => {
    const { rerender } = render(<RewindDialog {...base()} />)
    expect(screen.getAllByRole('heading', { name: 'Edit and re-run from here' })).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Edit and re-run from here' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edit and re-run' })).toBeDefined()
    rerender(<RewindDialog {...base({ mode: 'regenerate' })} />)
    expect(screen.getByRole('dialog', { name: 'Regenerate this response' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDefined()
    rerender(<RewindDialog {...base({ mode: 'switch', preview: null })} />)
    expect(screen.getByRole('dialog', { name: 'Switch version' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Switch' })).toBeDefined()
    expect(filesChoice()).toHaveTextContent('Files go back to the state at the end of that version.')
    expect(filesChoice()).not.toHaveTextContent('before that message')
    expect(filesChoice()).toBeEnabled()
    rerender(<RewindDialog {...base({ mode: 'regenerate' })} />)
    expect(filesChoice()).toHaveTextContent('Files in the folder go back to how they were before that message.')
    expect(screen.queryByText('Files go back to the state at the end of that version.')).toBeNull()
  })

  it('offers both choices, defaults to Conversation only and passes the chosen boolean', () => {
    const onConfirm = vi.fn()
    render(<RewindDialog {...base({ onConfirm })} />)
    expect(conversationChoice()).toHaveAttribute('aria-checked', 'true')
    expect(filesChoice()).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Edit and re-run' }))
    expect(onConfirm).toHaveBeenLastCalledWith(false)
    fireEvent.click(filesChoice())
    expect(filesChoice()).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Edit and re-run' }))
    expect(onConfirm).toHaveBeenLastCalledWith(true)
  })

  it('moves between enabled choices with the arrow keys and keeps one tab stop', () => {
    render(<RewindDialog {...base()} />)
    expect(screen.getByRole('radiogroup', { name: 'What goes back' })).toBeDefined()
    expect(conversationChoice()).toHaveAttribute('tabindex', '0')
    expect(filesChoice()).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(conversationChoice(), { key: 'ArrowDown' })
    expect(filesChoice()).toHaveAttribute('aria-checked', 'true')
    expect(filesChoice()).toHaveFocus()
    expect(filesChoice()).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(filesChoice(), { key: 'ArrowUp' })
    expect(conversationChoice()).toHaveAttribute('aria-checked', 'true')
    expect(conversationChoice()).toHaveFocus()
  })

  it('does not move to a disabled files choice with the arrow keys', () => {
    render(<RewindDialog {...base({ preview: { ...preview, has_checkpoint: false, files_available: false } })} />)
    fireEvent.keyDown(conversationChoice(), { key: 'ArrowDown' })
    expect(conversationChoice()).toHaveAttribute('aria-checked', 'true')
    expect(filesChoice()).toHaveAttribute('aria-checked', 'false')
  })

  it('draws a visible ring for an unselected choice and a dot for the selected one', () => {
    render(<RewindDialog {...base()} />)
    const indicator = (radio: HTMLElement) => radio.querySelector('[data-radio-indicator]')!
    expect(indicator(conversationChoice()).className).toContain('border-foreground')
    expect(indicator(conversationChoice()).children).toHaveLength(1)
    expect(indicator(filesChoice()).className).toMatch(/border-muted-foreground(\s|$)/)
    expect(indicator(filesChoice()).children).toHaveLength(0)
  })

  it('always shows the standing note exactly', () => {
    expect(REWIND_STANDING_NOTE).toBe('Does not undo commits, pushes, installs, network actions or ignored files.')
    const { rerender } = render(<RewindDialog {...base()} />)
    expect(screen.getByText(REWIND_STANDING_NOTE)).toBeDefined()
    rerender(<RewindDialog {...base({ filesHidden: true })} />)
    expect(screen.getByText(REWIND_STANDING_NOTE)).toBeDefined()
  })

  it('lists what will change, marks files edited since the turn and expands the list', () => {
    render(<RewindDialog {...base({ preview: { ...preview, skipped: 2 } })} />)
    expect(screen.getByText('3 files will change')).toBeDefined()
    expect(screen.getByText('2 large files are not included')).toBeDefined()
    expect(screen.queryByText('src/a.ts')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show files' }))
    const rowA = screen.getByText('src/a.ts').closest('li')!
    expect(rowA).toHaveTextContent('changed back')
    expect(rowA).toHaveTextContent('edited since this turn')
    expect(screen.getByText('src/new.ts').closest('li')).toHaveTextContent('removed')
    expect(screen.getByText('src/new.ts').closest('li')).not.toHaveTextContent('edited since this turn')
    expect(screen.getByText('docs/gone.md').closest('li')).toHaveTextContent('restored')
    fireEvent.click(screen.getByRole('button', { name: 'Hide files' }))
    expect(screen.queryByText('src/a.ts')).toBeNull()
  })

  it('says when no files will change and uses singular wording', () => {
    const { rerender } = render(<RewindDialog {...base({ preview: { ...preview, changes: [], changed_since_turn: [] } })} />)
    expect(screen.getByText('No files will change')).toBeDefined()
    rerender(<RewindDialog {...base({ preview: { ...preview, changes: [preview.changes[0]], skipped: 1 } })} />)
    expect(screen.getByText('1 file will change')).toBeDefined()
    expect(screen.getByText('1 large file is not included')).toBeDefined()
  })

  it.each([
    ['files unavailable', { ...preview, files_available: false }, 'No file checkpoint was saved for this message'],
    ['no checkpoint', { ...preview, has_checkpoint: false, files_available: false }, 'No file checkpoint was saved for this message'],
    ['busy folder', { ...preview, busy_reason: 'Another conversation ("Refactor") is using this folder.' }, 'Another conversation ("Refactor") is using this folder.'],
  ])('disables the files choice when %s and says why', (_name, value, reason) => {
    const onConfirm = vi.fn()
    render(<RewindDialog {...base({ preview: value, onConfirm })} />)
    expect(filesChoice()).toBeDisabled()
    expect(screen.getByText(reason)).toBeDefined()
    fireEvent.click(filesChoice())
    fireEvent.click(screen.getByRole('button', { name: 'Edit and re-run' }))
    expect(onConfirm).toHaveBeenLastCalledWith(false)
  })

  it('hides the files choice entirely when files are hidden', () => {
    render(<RewindDialog {...base({ filesHidden: true })} />)
    expect(screen.queryByRole('radio', { name: /Conversation and files/ })).toBeNull()
    expect(screen.queryByText(/files will change/)).toBeNull()
    expect(conversationChoice()).toBeDefined()
  })

  it('allows Conversation only while the preview loads and after a failed preview', () => {
    const onConfirm = vi.fn()
    const { rerender } = render(<RewindDialog {...base({ preview: null, previewLoading: true, onConfirm })} />)
    expect(filesChoice()).toBeDisabled()
    expect(screen.getByText('Checking the files…')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edit and re-run' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Edit and re-run' }))
    expect(onConfirm).toHaveBeenLastCalledWith(false)
    rerender(<RewindDialog {...base({ preview: null, previewError: 'Server unavailable', onConfirm })} />)
    expect(screen.getByText(/Server unavailable/)).toBeDefined()
    expect(filesChoice()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Edit and re-run' }))
    expect(onConfirm).toHaveBeenLastCalledWith(false)
  })

  it('cannot be confirmed or dismissed while busy', () => {
    const onCancel = vi.fn()
    render(<RewindDialog {...base({ busy: true, onCancel })} />)
    expect(screen.getByRole('button', { name: 'Edit and re-run' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('cancels with Escape or Cancel when idle without letting Escape bubble', () => {
    const onCancel = vi.fn()
    const outer = vi.fn()
    render(<div onKeyDown={outer}><RewindDialog {...base({ onCancel })} /></div>)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('shows an error in an alert and stays open', () => {
    render(<RewindDialog {...base({ error: 'Files could not be restored: src/a.ts (locked). Nothing in the conversation was changed.' })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('src/a.ts (locked)')
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edit and re-run' })).toBeEnabled()
  })

  it('starts again at Conversation only each time it opens', () => {
    const { rerender } = render(<RewindDialog {...base()} />)
    fireEvent.click(filesChoice())
    rerender(<RewindDialog {...base({ open: false })} />)
    rerender(<RewindDialog {...base()} />)
    expect(conversationChoice()).toHaveAttribute('aria-checked', 'true')
  })
})
