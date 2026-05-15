import { useEffect, useRef, useState } from 'react'
import { Check, SlidersHorizontal } from 'lucide-react'
import type { UsageScope, UsageRange } from '@core/api/client'

const SCOPE_OPTIONS: { value: UsageScope; label: string }[] = [
  { value: 'orchestra', label: 'Orchestra worktrees only' },
  { value: 'all', label: 'All local CLI usage' },
]

const RANGE_OPTIONS: { value: UsageRange; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

export function FilterMenu({
  scope,
  range,
  onScopeChange,
  onRangeChange,
}: {
  scope: UsageScope
  range: UsageRange
  onScopeChange: (s: UsageScope) => void
  onRangeChange: (r: UsageRange) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Usage filters"
        title="Filters"
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <SlidersHorizontal className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-md border border-border/60 bg-popover p-1 shadow-md">
          <div className="px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Scope
          </div>
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onScopeChange(opt.value); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
            >
              <span className="inline-flex w-3.5 items-center justify-center text-foreground">
                {scope === opt.value && <Check className="size-3.5" />}
              </span>
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-border/60" />
          <div className="px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Range
          </div>
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onRangeChange(opt.value); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
            >
              <span className="inline-flex w-3.5 items-center justify-center text-foreground">
                {range === opt.value && <Check className="size-3.5" />}
              </span>
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function scopeLabel(scope: UsageScope): string {
  return SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope
}

export function rangeLabel(range: UsageRange): string {
  return RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range
}
