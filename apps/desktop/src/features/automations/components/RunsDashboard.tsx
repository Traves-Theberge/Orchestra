import { useMemo, useState } from 'react'
import { ArrowLeft, RefreshCw, Search } from 'lucide-react'
import type { AutomationRun, BackendConfig } from '@core/api/client'
import { cn } from '@core/utils/cn'
import { useNow } from '@/hooks/use-now'
import { Button } from '@ui/button'
import { Input } from '@ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/select'
import { useAutomationRuns } from '../hooks/use-automations'
import { computeRunStats } from '../lib/stats'
import { RUN_STATUS_FILTERS, matchesRunStatusFilter, runStatusMeta, type RunStatusFilter } from '../lib/status'
import { RunsList } from './RunsList'
import { Caption, ErrorStrip } from './shared'

function StatCard({ label, value, failure }: { label: string; value: number; failure?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5" data-testid={`stat-${label}`}>
      <Caption>{label}</Caption>
      <div className={cn('mt-1 text-[20px] font-semibold tabular-nums', failure && value > 0 ? 'text-red-500' : 'text-foreground')}>{value}</div>
    </div>
  )
}

/** All-automations run history with 24h / 7d stats, search and status filter. */
export function RunsDashboard({ config, onBack, onOpenRun }: { config: BackendConfig; onBack: () => void; onOpenRun: (run: AutomationRun) => void }) {
  const { runs, loading, error, refresh } = useAutomationRuns(config)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<RunStatusFilter>('all')
  const now = useNow(60_000)
  const stats = useMemo(() => computeRunStats(runs, now), [runs, now])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return runs.filter(run => matchesRunStatusFilter(run.status, status) && (!needle || [run.title, run.automation_name, run.provider, run.model, run.branch, runStatusMeta(run.status).label, run.error].join(' ').toLowerCase().includes(needle)))
  }, [runs, query, status])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[13px] text-muted-foreground" onClick={onBack}><ArrowLeft className="size-3.5" />All automations</Button>
        <span className="text-muted-foreground/50">/</span>
        <h1 className="text-[14px] font-medium">Runs</h1>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" tooltip="Refresh" aria-label="Refresh runs" onClick={() => void refresh()}><RefreshCw className="size-3.5" /></Button>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 px-4 pt-4 md:grid-cols-4">
        <StatCard label="Succeeded · 24h" value={stats.succeeded24h} />
        <StatCard label="Failed · 24h" value={stats.failed24h} failure />
        <StatCard label="Succeeded · 7d" value={stats.succeeded7d} />
        <StatCard label="Failed · 7d" value={stats.failed7d} failure />
      </div>

      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
        <label className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search runs" placeholder="Search runs" className="pl-8" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <Select value={status} onValueChange={value => setStatus(value as RunStatusFilter)}>
          <SelectTrigger aria-label="Status filter" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RUN_STATUS_FILTERS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="ml-auto text-[12px] text-muted-foreground">{filtered.length} of {runs.length}</span>
      </div>

      {error ? <div className="px-4 pb-2"><ErrorStrip message={error} onRetry={() => void refresh()} /></div> : null}

      <div className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
        <RunsList runs={filtered} onOpenRun={onOpenRun} emptyText={loading ? 'Loading runs…' : runs.length ? 'No runs match the current filters.' : 'No runs yet.'} />
      </div>
    </div>
  )
}
