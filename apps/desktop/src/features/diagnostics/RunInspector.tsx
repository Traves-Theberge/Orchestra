import { useState } from 'react'
import type { BackendConfig } from '@core/api/client'
import { Button } from '@ui/button'
import { diagnosticsAPI, diagnosticQuery, type DiagnosticFilter, type TraceSummary } from './api'
import { useDiagnosticResource } from './useDiagnosticResource'
import { TraceWaterfall } from './TraceWaterfall'
import { CopyValue, OutcomeBadge } from './DiagnosticControls'
import { operationDescription, operationLabel } from './presentation'

export const backendKey = (config: BackendConfig | null) => JSON.stringify([config?.baseUrl, config?.apiToken, config?.workspaceId])
function TraceRow({ run, selected, onSelect }: { run: TraceSummary; selected: boolean; onSelect: () => void }) {
  return <button className="diagnostic-trace-row space-y-2" aria-pressed={selected} aria-label={`Inspect run ${run.name} ${run.trace_id}`} onClick={onSelect}>
    <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm truncate" title={run.name}>{run.label ?? operationLabel(run.name)}</span><OutcomeBadge status={run.status} /></div>
    {run.http_route ? <p className="font-mono text-xs break-all">{run.label ? '' : `${run.http_method ?? ''} ${run.http_route} `}{run.http_status_code ? ` · HTTP ${run.http_status_code}` : ''}</p> : <p className="text-xs text-muted-foreground truncate" title={run.description ?? operationDescription(run.name)}>{run.provider || operationDescription(run.name)}{run.model ? ` · ${run.model}` : ''}</p>}
    <div className="flex justify-between gap-2 text-xs text-muted-foreground"><time dateTime={run.start_time}>{new Date(run.start_time).toLocaleTimeString()}</time><span className="tabular-nums">{run.duration_ms.toFixed(1)} ms · {run.span_count} operations</span></div>
  </button>
}
export function RunInspector({ config, filter, live, active = true, refreshRevision = 0 }: { config: BackendConfig; filter: DiagnosticFilter; live: boolean; active?: boolean; refreshRevision?: number }) {
  const [selected, setSelected] = useState<{ scope: string; id: string } | null>(null)
  const [offset, setOffset] = useState<{ scope: string; value: number }>({ scope: '', value: 0 })
  const scope = `${backendKey(config)}${diagnosticQuery(filter)}`
  const pageOffset = offset.scope === scope ? offset.value : 0
  const runs = useDiagnosticResource(`runs:${scope}:${pageOffset}`, signal => diagnosticsAPI.traces(config, { ...filter, offset: pageOffset }, signal), active, live, refreshRevision)
  const selectedId = selected?.scope === scope ? selected.id : null
  const detail = useDiagnosticResource(`trace:${scope}:${selectedId}`, signal => diagnosticsAPI.trace(config, selectedId!, signal), active && !!selectedId, live, refreshRevision)
  return <div className="diagnostic-explorer">
    <section className="diagnostic-panel overflow-hidden min-w-0" aria-label="Recorded requests">
      <div className="p-4 border-b border-border space-y-1"><h3 className="font-semibold">Trace explorer</h3><p className="text-xs text-muted-foreground">{runs.data?.total ?? '—'} matching traces · {live ? 'Live' : 'Paused'} · {runs.updated?.toLocaleTimeString() ?? 'Waiting for data'}</p></div>
      {runs.loading && <p role="status" className="p-4">Loading runs...</p>}{runs.error && <p role="alert" className="p-4 text-destructive">{runs.error}</p>}
      <div className="diagnostic-trace-list">{(runs.data?.items ?? []).map(run => <TraceRow key={run.trace_id} run={run} selected={selectedId === run.trace_id} onSelect={() => setSelected({ scope, id: run.trace_id })} />)}</div>
      {runs.data && !(runs.data.items ?? []).length && <div className="diagnostic-empty">No matching runs.<span>History may be empty, disabled, or expired.</span></div>}
      <div className="flex justify-between gap-2 p-3 border-t border-border"><Button variant="ghost" size="sm" disabled={!pageOffset} onClick={() => setOffset({ scope, value: Math.max(0, pageOffset - 100) })}>Previous runs</Button><Button variant="ghost" size="sm" disabled={!runs.data || pageOffset + 100 >= runs.data.total} onClick={() => setOffset({ scope, value: pageOffset + 100 })}>Next runs</Button></div>
    </section>
    <div className="min-w-0 space-y-3">
      {!selectedId ? <div className="diagnostic-panel diagnostic-empty"><h3 className="text-foreground font-semibold">Select a trace</h3><p>Follow a request from its first recorded operation to its outcome.</p><p className="text-xs max-w-md">Explore nested operations, concurrent work, provider attempts, and correlated log events on one shared timeline.</p></div> : <>
        <div className="flex flex-wrap justify-between gap-2 items-center text-xs"><CopyValue value={selectedId} label="trace ID" /><Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Back to runs</Button></div>
        {detail.loading && <p role="status">Loading trace...</p>}{detail.error && <p role="alert">{detail.error} · Trace may have expired.</p>}{detail.data && <TraceWaterfall key={selectedId} detail={detail.data} />}
      </>}
    </div>
  </div>
}
