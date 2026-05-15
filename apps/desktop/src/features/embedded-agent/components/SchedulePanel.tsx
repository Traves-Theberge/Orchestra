import { useState, useEffect } from 'react'
import { Clock, X, ChevronDown, ChevronRight } from 'lucide-react'
import type { ScheduledItem } from '../hooks/use-scheduler'

interface SchedulePanelProps {
  items: ScheduledItem[]
  onCancel: (id: string) => void
}

function Countdown({ firesAt }: { firesAt: Date }) {
  const [remaining, setRemaining] = useState('')

  useEffect(() => {
    const update = () => {
      const diff = firesAt.getTime() - Date.now()
      if (diff <= 0) {
        setRemaining('now')
        return
      }
      const mins = Math.floor(diff / 60_000)
      const secs = Math.floor((diff % 60_000) / 1000)
      setRemaining(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [firesAt])

  return <span className="font-mono text-primary/70">{remaining}</span>
}

/**
 * Collapsible panel showing active scheduled items with countdown timers.
 */
export function SchedulePanel({ items, onCancel }: SchedulePanelProps) {
  const [expanded, setExpanded] = useState(false)
  const active = items.filter((i) => !i.fired && !i.cancelled)

  if (active.length === 0) return null

  return (
    <div className="mx-3 mt-2 rounded-lg border border-border/20 bg-background/30 text-[10px] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <Clock className="size-3 shrink-0 text-primary/60" />
        <span className="font-bold uppercase tracking-wider">
          {active.length} scheduled
        </span>
      </button>

      {expanded && (
        <div className="space-y-px border-t border-border/20">
          {active.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-2.5 py-1.5 hover:bg-muted/10">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[8px] font-bold uppercase">
                  {item.type}
                </span>
                <span className="truncate text-foreground/70">
                  {item.type === 'reminder' ? item.message : `${item.toolName}()`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Countdown firesAt={item.firesAt} />
                <button
                  onClick={() => onCancel(item.id)}
                  className="text-foreground/30 hover:text-red-400 transition-colors"
                  title="Cancel"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
