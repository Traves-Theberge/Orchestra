import { useMemo, useState } from 'react'
import { Activity, AppWindow, Circle, CircleDashed, Cpu, RefreshCcw } from 'lucide-react'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'

import { CustomDropdown } from '@/components/app-shell/shared/controls'
import { AppTooltip } from '@/components/ui/tooltip-wrapper'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { SnapshotPayload } from '@/lib/orchestra-types'
import { getSortedRetryEntries, getSortedRunningEntries } from '@/lib/view-models'

type QueueRow = {
  issue_id: string
  issue_identifier: string
  state: string
  lane: 'running' | 'retrying'
  session_id: string
  provider: string
  detail: string
  at: string
}

function queueRowsFromSnapshot(snapshot: SnapshotPayload | null): QueueRow[] {
  if (!snapshot) {
    return []
  }

  const runningRows: QueueRow[] = getSortedRunningEntries(snapshot.running).map((row) => ({
    issue_id: row.issue_id,
    issue_identifier: row.issue_identifier,
    state: row.state,
    lane: 'running',
    session_id: row.session_id ?? 'n/a',
    provider: row.provider || 'default',
    detail: row.last_message || row.last_event || 'active runtime session',
    at: row.last_event_at || row.started_at || snapshot.generated_at,
  }))

  const retryRows: QueueRow[] = getSortedRetryEntries(snapshot.retrying).map((row) => ({
    issue_id: row.issue_id,
    issue_identifier: row.issue_identifier,
    state: row.state,
    lane: 'retrying',
    session_id: 'retry-queue',
    provider: row.provider || 'default',
    detail: row.error || `attempt ${row.attempt}`,
    at: row.due_at,
  }))

  return [...runningRows, ...retryRows].sort((a, b) => a.issue_identifier.localeCompare(b.issue_identifier, 'en', { sensitivity: 'base' }))
}

export function OperationsQueueCard({
  loadingState,
  snapshot,
  onInspectIssue,
  onJumpToTerminal,
}: {
  loadingState: boolean
  snapshot: SnapshotPayload | null
  onInspectIssue: (issueIdentifier: string) => Promise<void>
  onJumpToTerminal?: (identifier: string) => void
}) {
  void onJumpToTerminal
  const [laneFilter, setLaneFilter] = useState<'all' | 'running' | 'retrying'>('all')
  const [stateFilter, setStateFilter] = useState<string>('all')

  const allRows = queueRowsFromSnapshot(snapshot)
  const uniqueStates = Array.from(new Set(allRows.map((row) => row.state))).sort()

  const rows = allRows.filter((row) => {
    const laneMatch = laneFilter === 'all' || row.lane === laneFilter
    const stateMatch = stateFilter === 'all' || row.state === stateFilter
    return laneMatch && stateMatch
  })

  const osOptions = useMemo(() => ({
    scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
    overflow: { x: 'hidden' as const, y: 'scroll' as const },
  }), [])

  return (
    <Card className="border bg-card shadow-lg dark:bg-card flex flex-col h-full overflow-hidden">
      <CardHeader className="pb-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <AppWindow className="h-5 w-5 text-primary" />
              Operations Queue
            </CardTitle>
            <CardDescription className="text-xs">Live orchestrator surface for active and retrying issue sessions.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2 py-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Lane</span>
              <CustomDropdown
                className="w-36 h-8"
                value={laneFilter}
                options={[
                  { label: 'All Lanes', value: 'all', icon: <Circle className="h-2 w-2" /> },
                  { label: 'Running', value: 'running', icon: <Activity className="h-2 w-2 text-primary" /> },
                  { label: 'Retrying', value: 'retrying', icon: <RefreshCcw className="h-2 w-2 text-amber-500" /> },
                ]}
                onChange={(value) => setLaneFilter(value as 'all' | 'running' | 'retrying')}
              />
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2 py-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Status</span>
              <CustomDropdown
                className="w-44 h-8"
                value={stateFilter}
                options={[
                  { label: 'All States', value: 'all', icon: <CircleDashed className="h-2 w-2" /> },
                  ...uniqueStates.map((state) => ({ label: state, value: state })),
                ]}
                onChange={setStateFilter}
              />
            </div>
            {(laneFilter !== 'all' || stateFilter !== 'all') && (
              <AppTooltip content="Clear Filters">
                <button
                  type="button"
                  aria-label="Clear Filters"
                  onClick={() => {
                    setLaneFilter('all')
                    setStateFilter('all')
                  }}
                  className="grid h-8 w-8 place-items-center rounded-lg bg-transparent text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <RefreshCcw className="h-4 w-4" />
                </button>
              </AppTooltip>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 pb-4">
        <OverlayScrollbarsComponent
          element="div"
          options={osOptions}
          className="rounded-xl border border-border/40 bg-muted/5 shadow-inner h-full custom-scrollbar"
        >
          <Table className="relative">
            <TableHeader className="bg-muted/30 sticky top-0 z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3">Issue</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3">Provider</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3">Lane</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3">State</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3 text-center">Session</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3">Detail</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3 text-right">Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingState
                ? Array.from({ length: 3 }).map((_, idx) => (
                  <TableRow key={idx}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-10 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                ))
                : rows.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground italic text-xs uppercase tracking-widest opacity-40">
                        No active sessions in queue
                      </TableCell>
                    </TableRow>
                    )
                  : rows.map((row) => (
                    <TableRow key={`${row.lane}-${row.issue_id}-${row.provider}`} className="group transition-colors hover:bg-muted/30">
                      <TableCell className="font-bold font-mono text-xs">
                        <button
                          type="button"
                          className="rounded px-1 py-0.5 text-left text-primary hover:bg-primary/10 transition-colors border border-transparent hover:border-primary/20"
                          onClick={() => void onInspectIssue(row.issue_identifier)}
                        >
                          {row.issue_identifier}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Cpu className="h-3 w-3 text-muted-foreground/40" />
                          <span className="text-[10px] font-bold capitalize text-foreground/70">{row.provider}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.lane === 'running' ? 'default' : 'outline'} className={`text-[9px] uppercase tracking-tighter h-5 px-1.5 ${row.lane === 'running' ? '' : 'text-amber-600 border-amber-500/20'}`}>
                          {row.lane}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-medium text-foreground/80">{row.state}</TableCell>
                      <TableCell className="text-center">
                        {row.session_id !== 'retry-queue'
                          ? (
                            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border/40 text-muted-foreground font-mono">
                              {row.session_id.slice(0, 8)}
                            </code>
                            )
                          : (
                            <span className="text-[10px] text-muted-foreground/40 italic">-</span>
                            )}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate group-hover:whitespace-normal group-hover:overflow-visible group-hover:z-50 relative">
                        <AppTooltip content={row.detail}>
                          <span className="text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                            {row.detail}
                          </span>
                        </AppTooltip>
                      </TableCell>
                      <TableCell className="text-right text-[10px] text-muted-foreground/60 font-medium whitespace-nowrap">
                        {new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </OverlayScrollbarsComponent>
      </CardContent>
    </Card>
  )
}
