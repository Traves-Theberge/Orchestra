import { useRef, type CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Hand, Timer } from 'lucide-react'
import type { AutomationRun } from '@core/api/client'
import { cn } from '@core/utils/cn'
import { useNow } from '@/hooks/use-now'
import { formatAbsolute, formatDuration, formatRelative } from '../lib/schedule'
import { RunStatusBadge } from './shared'

const ROW_HEIGHT = 40
/** Lists longer than this are virtualized. */
export const VIRTUALIZE_THRESHOLD = 60

function gridColumns(showAutomation: boolean) {
  return showAutomation ? 'grid-cols-[150px_minmax(0,1.4fr)_minmax(0,1fr)_100px_150px_90px]' : 'grid-cols-[150px_minmax(0,1.6fr)_100px_150px_90px]'
}

function RunRow({ run, showAutomation, now, onOpen, style }: { run: AutomationRun; showAutomation: boolean; now: number; onOpen: (run: AutomationRun) => void; style?: CSSProperties }) {
  const started = run.started_at || run.scheduled_for
  return (
    <button
      type="button"
      role="row"
      aria-label={`Open ${run.title || `run ${run.run_number}`}`}
      onClick={() => onOpen(run)}
      style={style}
      className={cn('grid w-full items-center gap-3 border-b border-border/60 px-4 text-left text-[13px] hover:bg-muted/40 focus-visible:bg-muted/50 focus-visible:outline-none', gridColumns(showAutomation))}
    >
      <span role="cell"><RunStatusBadge status={run.status} /></span>
      <span role="cell" className="min-w-0 truncate">
        {run.title || `Run ${run.run_number}`}
        {run.occurrence_count > 1 ? <span className="ml-1.5 text-[11px] text-muted-foreground">×{run.occurrence_count}</span> : null}
      </span>
      {showAutomation ? <span role="cell" className="min-w-0 truncate text-muted-foreground">{run.automation_name}</span> : null}
      <span role="cell" className="flex items-center gap-1 text-[12px] text-muted-foreground">
        {run.trigger === 'manual' ? <Hand className="size-3" /> : <Timer className="size-3" />}
        {run.trigger === 'manual' ? 'Manual' : 'Scheduled'}
      </span>
      <span role="cell" className="truncate text-[12px] text-muted-foreground" title={started}>
        {formatAbsolute(started)}{now && started ? <span className="text-muted-foreground/70"> · {formatRelative(started, now)}</span> : null}
      </span>
      <span role="cell" className="text-right font-mono text-[11px] text-muted-foreground">{run.started_at ? formatDuration(run.started_at, run.finished_at, now || undefined) : '—'}</span>
    </button>
  )
}

/** Runs table; virtualized when long. */
export function RunsList({ runs, onOpenRun, showAutomation = true, emptyText = 'No runs yet.' }: {
  runs: AutomationRun[]
  onOpenRun: (run: AutomationRun) => void
  showAutomation?: boolean
  emptyText?: string
}) {
  const now = useNow(30_000)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtual = runs.length > VIRTUALIZE_THRESHOLD
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoizable functions by design.
  const virtualizer = useVirtualizer({
    count: virtual ? runs.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    initialRect: { width: 800, height: 600 },
  })

  return (
    <div role="table" aria-label="Automation runs" className="flex min-h-0 flex-1 flex-col">
      <div role="row" className={cn('grid shrink-0 items-center gap-3 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground', gridColumns(showAutomation))}>
        <span role="columnheader">Status</span>
        <span role="columnheader">Run</span>
        {showAutomation ? <span role="columnheader">Automation</span> : null}
        <span role="columnheader">Trigger</span>
        <span role="columnheader">Started</span>
        <span role="columnheader" className="text-right">Duration</span>
      </div>
      {runs.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{emptyText}</p>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" role="rowgroup">
          {virtual ? (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map(item => (
                <RunRow key={runs[item.index].id} run={runs[item.index]} showAutomation={showAutomation} now={now} onOpen={onOpenRun}
                  style={{ position: 'absolute', top: 0, left: 0, height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }} />
              ))}
            </div>
          ) : runs.map(run => (
            <RunRow key={run.id} run={run} showAutomation={showAutomation} now={now} onOpen={onOpenRun} style={{ height: ROW_HEIGHT }} />
          ))}
        </div>
      )}
    </div>
  )
}
