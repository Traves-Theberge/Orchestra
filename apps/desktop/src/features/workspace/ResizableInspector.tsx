import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const defaults = { files: 176, search: 240 }
function savedWidth(key: string, fallback: number) {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value >= 128 && value <= 480 ? value : fallback
  } catch { return fallback }
}

export function ResizableInspector({ storageKey, mode, inspector, children }: {
  storageKey: string; mode: 'files' | 'search' | null; inspector: ReactNode; children: ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; key: string } | null>(null)
  const [available, setAvailable] = useState(800)
  const key = `${storageKey}:${mode}`
  const fallback = mode ? defaults[mode] : defaults.files
  const [preference, setPreference] = useState(() => ({ key, width: savedWidth(key, fallback) }))
  const desired = preference.key === key ? preference.width : savedWidth(key, fallback)
  const maximum = Math.max(0, Math.min(480, available - 160))
  const minimum = Math.min(128, maximum)
  const width = Math.max(minimum, Math.min(maximum, desired))
  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const update = () => { const size = element.getBoundingClientRect().width; if (size > 0) setAvailable(size) }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const resize = (value: number) => {
    const next = Math.max(minimum, Math.min(maximum, value))
    setPreference({ key, width: next })
    // Preserve a useful desktop width when a temporarily narrow pane is clamped.
    if (next >= 128) try { localStorage.setItem(key, String(next)) } catch { /* Storage is optional. */ }
  }
  return <div ref={container} className="flex min-h-0 min-w-0 flex-1">
    {mode && <>
      <aside aria-label={mode === 'files' ? 'Workspace file sidebar' : 'Workspace search sidebar'} className="min-h-0 min-w-0 shrink-0 overflow-auto" style={{ width }}>{inspector}</aside>
      <div role="separator" aria-label={`Resize workspace ${mode === 'files' ? 'files' : 'search'}`} aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={Math.round(width)} tabIndex={0}
        className="group relative w-1 shrink-0 cursor-col-resize touch-none outline-none focus-visible:bg-primary/30 hover:bg-primary/15"
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { pointerId: event.pointerId, key }; event.currentTarget.setPointerCapture(event.pointerId) }}
        onPointerMove={event => { if (drag.current?.pointerId !== event.pointerId || drag.current.key !== key) return; const left = container.current?.getBoundingClientRect().left; if (left !== undefined) resize(event.clientX - left) }}
        onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
        onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
        onDoubleClick={() => resize(fallback)}
        onKeyDown={event => { const step = event.shiftKey ? 40 : 10; const next = event.key === 'ArrowLeft' ? width - step : event.key === 'ArrowRight' ? width + step : event.key === 'Home' ? minimum : event.key === 'End' ? maximum : undefined; if (next !== undefined) { event.preventDefault(); resize(next) } }} />
    </>}
    <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
  </div>
}
