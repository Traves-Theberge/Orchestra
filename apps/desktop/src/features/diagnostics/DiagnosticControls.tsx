import { useState } from 'react'
import { Check, Copy, X, SlidersHorizontal, Search } from 'lucide-react'
import { Input } from '@ui/input'
import { Button } from '@ui/button'
import type { DiagnosticFilter } from './api'
import { outcomeLabel } from './presentation'

export function OutcomeBadge({ status }: { status: string }) {
  return <span className={`diagnostic-outcome diagnostic-outcome-${status}`}><span aria-hidden="true" />{outcomeLabel(status)}</span>
}

export function CopyValue({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState('')
  async function copy() {
    try { await navigator.clipboard.writeText(value); setState('Copied') }
    catch { setState('Copy unavailable') }
  }
  return <span className="inline-flex min-w-0 items-center gap-2"><code className="truncate" title={value}>{value}</code><button type="button" aria-label={`Copy ${label}`} title={`Copy ${label}`} onClick={() => void copy()} className="diagnostic-icon-button shrink-0">{state === 'Copied' ? <Check size={14} /> : <Copy size={14} />}</button><span role="status" className="text-xs text-muted-foreground">{state}</span></span>
}

const filterLabels: Partial<Record<keyof DiagnosticFilter, string>> = { project_id: 'Project', task_id: 'Task', provider: 'Provider', q: 'Search', status: 'Outcome' }
function localDate(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function DiagnosticFilters({ filter, onChange }: { filter: DiagnosticFilter; onChange: (filter: DiagnosticFilter) => void }) {
  const [range, setRange] = useState(filter.since || filter.until ? 'custom' : 'all')
  const entries = Object.entries(filter).filter(([key, value]) => value !== undefined && value !== '' && key in filterLabels)
  function preset(value: string) {
    setRange(value)
    if (value === 'custom') return
    const now = Date.now()
    onChange({ ...filter, since: value === 'all' ? undefined : new Date(now - Number(value) * 60000).toISOString(), until: value === 'all' ? undefined : new Date(now).toISOString() })
  }
  function clear() { setRange('all'); onChange({}) }
  return <section aria-label="Diagnostic filters" className="diagnostic-filter-panel">
    <div className="grid gap-3 md:grid-cols-[minmax(200px,1fr)_180px_180px_auto] items-end">
      <label className="text-xs font-medium text-muted-foreground">Search diagnostics<div className="relative mt-1.5"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" aria-label="Search diagnostics" placeholder="Endpoint, operation, or trace ID…" value={filter.q ?? ''} onChange={event => onChange({ ...filter, q: event.target.value })} /></div></label>
      <label className="text-xs font-medium text-muted-foreground">Outcome<select className="diagnostic-select mt-1.5" aria-label="Outcome filter" value={filter.status ?? ''} onChange={event => onChange({ ...filter, status: event.target.value })}><option value="">All outcomes</option>{['running', 'ok', 'error', 'cancelled', 'unknown'].map(value => <option key={value} value={value}>{outcomeLabel(value)}</option>)}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Time range<select className="diagnostic-select mt-1.5" aria-label="Time range" value={range} onChange={event => preset(event.target.value)}><option value="all">All retained history</option><option value="15">Last 15 minutes</option><option value="60">Last hour</option><option value="1440">Last 24 hours</option><option value="10080">Last 7 days</option><option value="custom">Custom range</option></select></label>
      <Button size="sm" variant="ghost" onClick={clear} disabled={!Object.values(filter).some(value => value !== undefined && value !== '')}><X size={14} />Reset filters</Button>
    </div>
    <details open={range === 'custom' ? true : undefined} className="mt-3 border-t border-border/50 pt-3"><summary className="flex w-fit cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground"><SlidersHorizontal size={14} />Project, provider & custom time</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {([{ field: 'project_id', label: 'Project filter', placeholder: 'Project ID' }, { field: 'task_id', label: 'Task filter', placeholder: 'Task ID' }, { field: 'provider', label: 'Provider filter', placeholder: 'e.g. codex' }] as const).map(item => <label key={item.field} className="text-xs text-muted-foreground">{item.label}<Input className="mt-1.5" aria-label={item.label} placeholder={item.placeholder} value={filter[item.field] ?? ''} onChange={event => onChange({ ...filter, [item.field]: event.target.value })} /></label>)}
      {(['since', 'until'] as const).map(field => <label key={field} className="text-xs text-muted-foreground">{field === 'since' ? 'From time' : 'Until time'}<Input className="mt-1.5" aria-label={field === 'since' ? 'From time' : 'Until time'} type="datetime-local" value={localDate(filter[field])} onChange={event => { setRange('custom'); onChange({ ...filter, [field]: event.target.value ? new Date(event.target.value).toISOString() : undefined }) }} /></label>)}
    </div></details>
    {!!entries.length && <div aria-label="Active filters" className="mt-3 flex flex-wrap gap-2">{entries.map(([key, value]) => <button key={key} className="diagnostic-filter-chip" aria-label={`Remove ${filterLabels[key as keyof DiagnosticFilter]} filter`} onClick={() => onChange({ ...filter, [key]: undefined })}>{filterLabels[key as keyof DiagnosticFilter]}: {String(value)}<X size={12} /></button>)}</div>}
  </section>
}
