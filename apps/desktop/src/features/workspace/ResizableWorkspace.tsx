import { useRef, useState, useSyncExternalStore, type ReactNode, type CSSProperties } from 'react'

const query = '(min-width: 1024px)'
const isWide = () => window.matchMedia?.(query).matches ?? true
const subscribe = (listener: () => void) => {
  const media = window.matchMedia?.(query)
  media?.addEventListener('change', listener)
  return () => media?.removeEventListener('change', listener)
}

const clamp = (value: number) => Math.min(80, Math.max(25, Number.isFinite(value) ? value : 60))
const read = (key: string) => {
  try { const saved = localStorage.getItem(key); return saved === null ? 60 : clamp(Number(saved)) } catch { return 60 }
}

export function ResizableWorkspace({ storageKey, toolsOpen, chat, tools }: {
  storageKey: string; toolsOpen: boolean; chat: ReactNode; tools: ReactNode
}) {
  const wide = useSyncExternalStore(subscribe, isWide, () => true)
  const [size, setSize] = useState(() => ({ key: storageKey, percent: read(storageKey) }))
  const drag = useRef<{ pointerId: number; key: string; percent: number } | null>(null)
  if (size.key !== storageKey) setSize({ key: storageKey, percent: read(storageKey) })
  const percent = size.key === storageKey ? size.percent : read(storageKey)
  const save = (value: number) => {
    const next = clamp(value)
    setSize({ key: storageKey, percent: next })
    try { localStorage.setItem(storageKey, String(next)) } catch { /* Resizing still works without persistence. */ }
  }
  return <div className="flex min-h-0 flex-1 flex-col lg:flex-row" style={{ '--chat-share': `${percent}%` } as CSSProperties}>
    <div aria-label="Workspace chat pane" className="min-h-0 min-w-0" style={{ flex: toolsOpen ? '0 1 var(--chat-share)' : '1 1 0%' }}>{chat}</div>
    {toolsOpen && <div role="separator" aria-orientation={wide ? 'vertical' : 'horizontal'} aria-label="Resize chat and workspace tools" aria-valuemin={25} aria-valuemax={80} aria-valuenow={Math.round(percent)} tabIndex={0}
      title="Drag to resize · Arrow keys to adjust · Double-click to reset"
      className="group relative z-10 h-2 shrink-0 touch-none cursor-row-resize select-none bg-border/30 hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-none lg:h-auto lg:w-2 lg:cursor-col-resize"
      onDoubleClick={() => save(60)}
      onKeyDown={event => {
        const step = event.shiftKey ? 10 : 2
        const next = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? percent - step
          : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? percent + step
          : event.key === 'Home' ? 25 : event.key === 'End' ? 80 : null
        if (next !== null) { event.preventDefault(); save(next) }
      }}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, key: storageKey, percent }
      }}
      onPointerMove={event => {
        const current = drag.current
        const container = event.currentTarget.parentElement
        if (!current || current.key !== storageKey || current.pointerId !== event.pointerId || !container) return
        const rect = container.getBoundingClientRect()
        const horizontal = getComputedStyle(container).flexDirection === 'row'
        const extent = horizontal ? rect.width : rect.height
        if (extent <= 0) return
        current.percent = clamp(100 * (horizontal ? event.clientX - rect.left : event.clientY - rect.top) / extent)
        setSize({ key: storageKey, percent: current.percent })
      }}
      onLostPointerCapture={() => {
        const current = drag.current
        drag.current = null
        if (current?.key === storageKey) save(current.percent)
      }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onPointerCancel={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    />}
    <div aria-label="Workspace tools" hidden={!toolsOpen} className={`${toolsOpen ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1`}>{tools}</div>
  </div>
}
