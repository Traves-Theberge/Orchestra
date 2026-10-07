import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'

/** Status-bar zoom: − 100% +. Also driven by Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel. Desktop only. */
export function ZoomControl() {
  const desktop = typeof window !== 'undefined' ? window.orchestraDesktop : undefined
  const supported = !!desktop?.getZoom && !!desktop.setZoom
  const [factor, setFactor] = useState(1)

  useEffect(() => {
    if (!desktop?.getZoom) return
    let active = true
    void desktop.getZoom().then(value => { if (active) setFactor(value) }).catch(() => {})
    const unsubscribe = desktop.onZoomChanged?.(value => setFactor(value))
    return () => { active = false; unsubscribe?.() }
  }, [desktop])

  if (!supported) return null
  const set = (request: 'in' | 'out' | 'reset') => { void desktop.setZoom?.(request).then(setFactor).catch(() => {}) }
  const button = 'inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
  return (
    <div role="group" aria-label="Zoom" className="ml-3 flex shrink-0 items-center gap-0.5">
      <AppTooltip content="Zoom out (Ctrl+-)"><button type="button" aria-label="Zoom out" onClick={() => set('out')} className={button}><Minus size={11} /></button></AppTooltip>
      <AppTooltip content="Reset zoom (Ctrl+0)"><button type="button" aria-label="Reset zoom" onClick={() => set('reset')} className="min-w-9 rounded px-1 text-center text-[10px] tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">{Math.round(factor * 100)}%</button></AppTooltip>
      <AppTooltip content="Zoom in (Ctrl+=)"><button type="button" aria-label="Zoom in" onClick={() => set('in')} className={button}><Plus size={11} /></button></AppTooltip>
    </div>
  )
}
