import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@core/utils/cn'
import { clampMenuPosition, getSpellBridge, type SpellBridge, type SpellContextMenuPayload, type SpellEditAction } from '@core/spellcheck/spell-bridge'
import { menuContentClass, menuItemClass } from './menu-classes'
import { SpellLanguagesList } from './spell-languages'

type Entry =
  | { kind: 'item'; id: string; label: string; run: () => void; disabled?: boolean; strong?: boolean; shortcut?: string }
  | { kind: 'separator'; id: string }

type SpellContextMenuProps = {
  payload: SpellContextMenuPayload
  bridge: SpellBridge
  /** Close the menu and hand focus back to the field before `then` runs. */
  onClose: (then?: () => void) => void
  onOpenLanguages: () => void
  isMac?: boolean
}

const fail = (error: unknown) => console.error('spellcheck action failed', error)

function buildEntries({ payload, bridge, onClose, onOpenLanguages, isMac }: SpellContextMenuProps): Entry[] {
  const act = (fn: () => Promise<unknown>) => () => onClose(() => { fn().catch(fail) })
  const edit = (action: SpellEditAction) => act(() => bridge.edit(action))
  const mod = isMac ? '⌘' : 'Ctrl+'
  const { misspelledWord: word, dictionarySuggestions: suggestions, editFlags: flags } = payload
  const entries: Entry[] = []
  if (word) {
    if (suggestions.length === 0) entries.push({ kind: 'item', id: 'none', label: 'No suggestions', run: () => {}, disabled: true })
    suggestions.forEach((suggestion, index) => entries.push({
      kind: 'item', id: `s-${suggestion}`, label: suggestion, strong: index === 0, run: act(() => bridge.replaceMisspelling(suggestion)),
    }))
    entries.push(
      { kind: 'separator', id: 'sep-spell' },
      { kind: 'item', id: 'add', label: 'Add to dictionary', run: act(() => bridge.addToDictionary(word)) },
      { kind: 'item', id: 'ignore', label: 'Ignore', run: act(() => bridge.ignoreWord(word)) },
      { kind: 'separator', id: 'sep-edit' },
    )
  }
  entries.push(
    { kind: 'item', id: 'cut', label: 'Cut', shortcut: `${mod}X`, disabled: !flags.canCut, run: edit('cut') },
    { kind: 'item', id: 'copy', label: 'Copy', shortcut: `${mod}C`, disabled: !flags.canCopy, run: edit('copy') },
    { kind: 'item', id: 'paste', label: 'Paste', shortcut: `${mod}V`, disabled: !flags.canPaste, run: edit('paste') },
    { kind: 'item', id: 'select-all', label: 'Select all', shortcut: `${mod}A`, disabled: !flags.canSelectAll, run: edit('selectAll') },
    { kind: 'separator', id: 'sep-lang' },
    { kind: 'item', id: 'languages', label: 'Spelling languages…', run: onOpenLanguages },
  )
  return entries
}

/** Place a floating panel at the click point, clamped to the viewport once it has a size. */
function useClampedPosition(ref: React.RefObject<HTMLElement | null>, point: { x: number; y: number }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPosition(clampMenuPosition(point, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight }))
  }, [ref, point])
  return { left: position?.left ?? point.x, top: position?.top ?? point.y, visibility: position ? undefined : 'hidden' as const }
}

/** The spelling + edit menu for one right-click. Presentational; the host owns open state. */
export function SpellContextMenu(props: SpellContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const entries = buildEntries(props)
  const items = entries.filter((e): e is Extract<Entry, { kind: 'item' }> => e.kind === 'item')
  const enabled = items.filter(item => !item.disabled)
  const [activeId, setActiveId] = useState(() => enabled[0]?.id ?? '')
  const style = useClampedPosition(ref, props.payload)

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(activeId)}"]`)?.focus({ preventScroll: true })
  }, [activeId])

  const move = (delta: number | 'first' | 'last') => {
    if (enabled.length === 0) return
    const index = enabled.findIndex(item => item.id === activeId)
    const next = delta === 'first' ? 0 : delta === 'last' ? enabled.length - 1 : (index + delta + enabled.length) % enabled.length
    setActiveId(enabled[next].id)
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1), ArrowUp: () => move(-1), Home: () => move('first'), End: () => move('last'),
      Escape: () => props.onClose(), Tab: () => props.onClose(),
      Enter: () => enabled.find(item => item.id === activeId)?.run(),
      ' ': () => enabled.find(item => item.id === activeId)?.run(),
    }
    const handler = keys[event.key]
    if (!handler) return
    event.preventDefault()
    event.stopPropagation()
    handler()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={props.payload.misspelledWord ? `Spelling: ${props.payload.misspelledWord}` : 'Edit'}
      aria-orientation="vertical"
      data-spell-menu=""
      onKeyDown={onKeyDown}
      onContextMenu={e => e.preventDefault()}
      style={{ position: 'fixed', ...style }}
      className={cn(menuContentClass, 'min-w-[12rem] origin-top-left motion-safe:animate-[spell-menu-in_120ms_ease-out]')}
    >
      {entries.map(entry => entry.kind === 'separator'
        ? <div key={entry.id} role="separator" className="-mx-1 my-1 h-px bg-border" />
        : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            data-id={entry.id}
            tabIndex={entry.id === activeId ? 0 : -1}
            aria-disabled={entry.disabled || undefined}
            data-disabled={entry.disabled ? '' : undefined}
            data-highlighted={entry.id === activeId ? '' : undefined}
            onMouseMove={() => { if (!entry.disabled && entry.id !== activeId) setActiveId(entry.id) }}
            onClick={() => { if (!entry.disabled) entry.run() }}
            className={cn(menuItemClass, 'w-full text-left', entry.strong && 'font-semibold')}
          >
            <span className="flex-1 truncate">{entry.label}</span>
            {entry.shortcut && <span className="text-[11px] text-muted-foreground">{entry.shortcut}</span>}
          </button>
        ))}
    </div>
  )
}

function SpellLanguagesPopover({ point, bridge, onClose }: { point: { x: number; y: number }; bridge: SpellBridge; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const style = useClampedPosition(ref, point)
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Spelling languages"
      data-spell-menu=""
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }}
      style={{ position: 'fixed', ...style }}
      className={cn(menuContentClass, 'flex h-80 w-64 flex-col gap-1 p-2 motion-safe:animate-[spell-menu-in_120ms_ease-out]')}
    >
      <p className="px-1 text-[11px] font-medium text-muted-foreground">Spelling languages</p>
      <SpellLanguagesList bridge={bridge} autoFocus className="flex-1" />
    </div>
  )
}

type FieldSnapshot = {
  element: HTMLElement
  restore: () => void
}

/** Remember the right-clicked field and its selection so actions apply to it after the menu closes. */
function snapshotField(): FieldSnapshot | null {
  const element = document.activeElement
  if (!(element instanceof HTMLElement) || element === document.body) return null
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd, selectionDirection } = element
    return {
      element,
      restore: () => {
        element.focus({ preventScroll: true })
        if (selectionStart !== null && selectionEnd !== null) {
          try { element.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined) } catch { /* type without selection API */ }
        }
      },
    }
  }
  const selection = window.getSelection()
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
  return {
    element,
    restore: () => {
      element.focus({ preventScroll: true })
      if (range) {
        const current = window.getSelection()
        current?.removeAllRanges()
        current?.addRange(range)
      }
    },
  }
}

type HostState =
  | { view: 'closed' }
  | { view: 'menu'; payload: SpellContextMenuPayload }
  | { view: 'languages'; payload: SpellContextMenuPayload }

/** Mount once at the app root. Renders nothing outside Electron. */
export function SpellContextMenuHost({ bridge: bridgeProp }: { bridge?: SpellBridge | null } = {}) {
  const [defaultBridge] = useState(getSpellBridge)
  const bridge = bridgeProp === undefined ? defaultBridge : bridgeProp
  const [state, setState] = useState<HostState>({ view: 'closed' })
  const field = useRef<FieldSnapshot | null>(null)
  const [isMac] = useState(() => typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac'))

  useEffect(() => bridge?.onContextMenu(payload => {
    field.current = snapshotField()
    setState({ view: 'menu', payload })
  }), [bridge])

  const close = useCallback((then?: () => void, restoreFocus = true) => {
    setState({ view: 'closed' })
    const snapshot = field.current
    field.current = null
    if (restoreFocus && snapshot?.element.isConnected) snapshot.restore()
    then?.()
  }, [])

  const open = state.view !== 'closed'
  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null) => target instanceof Node && !!document.querySelector('[data-spell-menu]')?.contains(target)
    const onPointerDown = (event: PointerEvent) => { if (!inside(event.target)) close(undefined, false) }
    const onScroll = (event: Event) => { if (!inside(event.target)) close(undefined, false) }
    const onDismiss = () => close(undefined, false)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('blur', onDismiss)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('blur', onDismiss)
    }
  }, [open, close])

  if (!bridge || state.view === 'closed') return null
  return createPortal(
    state.view === 'menu'
      ? <SpellContextMenu payload={state.payload} bridge={bridge} isMac={isMac} onClose={close} onOpenLanguages={() => setState({ view: 'languages', payload: state.payload })} />
      : <SpellLanguagesPopover point={state.payload} bridge={bridge} onClose={() => close()} />,
    document.body,
  )
}
