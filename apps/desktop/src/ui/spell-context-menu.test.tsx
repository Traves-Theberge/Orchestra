import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpellBridge, SpellContextMenuPayload } from '@core/spellcheck/spell-bridge'
import { SpellContextMenuHost } from './spell-context-menu'
import { SpellLanguagesList } from './spell-languages'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function payload(overrides: Partial<SpellContextMenuPayload> = {}): SpellContextMenuPayload {
  return {
    x: 40, y: 50, misspelledWord: 'teh', selectionText: '', dictionarySuggestions: ['the', 'ten', 'tea'],
    editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true, canUndo: false, canRedo: false },
    ...overrides,
  }
}

function fakeBridge() {
  let emit: (p: SpellContextMenuPayload) => void = () => {}
  const unsubscribe = vi.fn()
  const bridge: SpellBridge = {
    onContextMenu: vi.fn((cb) => { emit = cb; return unsubscribe }),
    replaceMisspelling: vi.fn(async () => true),
    addToDictionary: vi.fn(async () => true),
    ignoreWord: vi.fn(async () => true),
    getSettings: vi.fn(async () => ({ supportsLanguages: true, languages: ['en-US'], availableLanguages: ['en-US', 'fr', 'de-DE'] })),
    setLanguages: vi.fn(async (languages: string[]) => ({ supportsLanguages: true, languages, availableLanguages: ['en-US', 'fr', 'de-DE'] })),
    edit: vi.fn(async () => true),
  }
  return { bridge, unsubscribe, open: (p: SpellContextMenuPayload) => act(() => emit(p)) }
}

function renderWithField(bridge: SpellBridge) {
  const utils = render(<><textarea aria-label="Message" defaultValue="teh cat" /><SpellContextMenuHost bridge={bridge} /></>)
  const field = screen.getByLabelText('Message') as HTMLTextAreaElement
  field.focus()
  field.setSelectionRange(0, 3)
  return { ...utils, field }
}

describe('SpellContextMenuHost', () => {
  it('renders nothing and does not crash without the Electron API', () => {
    vi.stubGlobal('orchestraDesktop', undefined)
    const { container } = render(<SpellContextMenuHost />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows suggestions with the top one emphasized, then dictionary and edit items', () => {
    const { bridge, open } = fakeBridge()
    renderWithField(bridge)
    open(payload())
    const labels = screen.getAllByRole('menuitem').map(item => item.textContent)
    expect(labels).toEqual(['the', 'ten', 'tea', 'Add to dictionary', 'Ignore', 'CutCtrl+X', 'CopyCtrl+C', 'PasteCtrl+V', 'Select allCtrl+A', 'Spelling languages…'])
    expect(screen.getByRole('menuitem', { name: 'the' })).toHaveClass('font-semibold')
    expect(screen.getByRole('menuitem', { name: 'ten' })).not.toHaveClass('font-semibold')
    expect(screen.getAllByRole('separator')).toHaveLength(3)
  })

  it('replaces the misspelling and returns focus and selection to the field first', async () => {
    const { bridge, open } = fakeBridge()
    const { field } = renderWithField(bridge)
    open(payload())
    expect(screen.getByRole('menuitem', { name: 'the' })).toHaveFocus()
    let focusedAtCall: Element | null = null
    vi.mocked(bridge.replaceMisspelling).mockImplementation(async () => { focusedAtCall = document.activeElement; return true })
    fireEvent.click(screen.getByRole('menuitem', { name: 'ten' }))
    expect(bridge.replaceMisspelling).toHaveBeenCalledWith('ten')
    expect(focusedAtCall).toBe(field)
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('adds to the dictionary and ignores the misspelled word', () => {
    const { bridge, open } = fakeBridge()
    renderWithField(bridge)
    open(payload())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to dictionary' }))
    expect(bridge.addToDictionary).toHaveBeenCalledWith('teh')
    open(payload())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ignore' }))
    expect(bridge.ignoreWord).toHaveBeenCalledWith('teh')
  })

  it('disables edit items per editFlags and skips them in keyboard navigation', () => {
    const { bridge, open } = fakeBridge()
    renderWithField(bridge)
    open(payload({ misspelledWord: '', dictionarySuggestions: [] }))
    const cut = screen.getByRole('menuitem', { name: /Cut/ })
    expect(cut).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(cut)
    expect(bridge.edit).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Add to dictionary' })).toBeNull()

    const menu = screen.getByRole('menu')
    expect(screen.getByRole('menuitem', { name: /Paste/ })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByRole('menuitem', { name: 'Spelling languages…' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: /Paste/ })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(bridge.edit).toHaveBeenCalledWith('selectAll')
  })

  it('navigates with arrows/Home/End and closes on Escape with focus back on the field', () => {
    const { bridge, open } = fakeBridge()
    const { field } = renderWithField(bridge)
    open(payload())
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'ten' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(screen.getByRole('menuitem', { name: 'Spelling languages…' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(screen.getByRole('menuitem', { name: 'the' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(field).toHaveFocus()
  })

  it('shows "No suggestions" disabled when there are none', () => {
    const { bridge, open } = fakeBridge()
    renderWithField(bridge)
    open(payload({ dictionarySuggestions: [] }))
    expect(screen.getByRole('menuitem', { name: 'No suggestions' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Add to dictionary' })).toHaveFocus()
  })

  it('closes on outside pointerdown, scroll, resize and window blur', () => {
    const { bridge, open } = fakeBridge()
    renderWithField(bridge)
    for (const dismiss of [
      () => fireEvent.pointerDown(document.body),
      () => fireEvent.scroll(document),
      () => fireEvent(window, new Event('resize')),
      () => fireEvent(window, new Event('blur')),
    ]) {
      open(payload())
      expect(screen.getByRole('menu')).toBeInTheDocument()
      act(dismiss)
      expect(screen.queryByRole('menu')).toBeNull()
    }
  })

  it('opens the languages popover and unsubscribes on unmount', async () => {
    const { bridge, open, unsubscribe } = fakeBridge()
    const { unmount } = renderWithField(bridge)
    open(payload())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Spelling languages…' }))
    expect(screen.getByRole('dialog', { name: 'Spelling languages' })).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: /English/ })).toBeChecked()
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})

describe('SpellLanguagesList', () => {
  it('toggles languages and keeps at least one on', async () => {
    const { bridge } = fakeBridge()
    render(<SpellLanguagesList bridge={bridge} />)
    const english = await screen.findByRole('checkbox', { name: /English/ })
    expect(english).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /French/ }))
    expect(bridge.setLanguages).toHaveBeenCalledWith(['en-US', 'fr'])
    await waitFor(() => expect(english).not.toBeDisabled())
  })

  it('explains when languages follow the OS or Electron is absent', async () => {
    const { bridge } = fakeBridge()
    vi.mocked(bridge.getSettings).mockResolvedValue({ supportsLanguages: false, languages: [], availableLanguages: [] })
    render(<SpellLanguagesList bridge={bridge} />)
    expect(await screen.findByText(/system language settings/)).toBeInTheDocument()
    cleanup()
    render(<SpellLanguagesList bridge={null} />)
    expect(screen.getByText(/desktop app/)).toBeInTheDocument()
  })
})
