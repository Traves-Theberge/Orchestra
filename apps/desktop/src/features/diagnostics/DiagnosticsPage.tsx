import { useLayoutEffect, useRef, useState } from 'react'
import type { BackendConfig } from '@core/api/client'
import { Button } from '@ui/button'
import { Input } from '@ui/input'
import { diagnosticsAPI, diagnosticQuery, sanitizedExport, type DiagnosticFilter, type DiagnosticLog, type DiagnosticSettings, type Overview } from './api'
import { backendKey, RunInspector } from './RunInspector'
import { useDiagnosticResource } from './useDiagnosticResource'
import { EvilChartsMetrics } from './EvilChartsMetrics'
import './diagnostics.css'
import { DiagnosticFilters } from './DiagnosticControls'
import { operationDescription, operationLabel } from './presentation'

const tabs = ['Overview', 'Runs', 'Logs', 'Usage', 'Settings'] as const
type Tab = typeof tabs[number]
const viewDescriptions: Record<Tab, string> = {
  Overview: 'Check recorded activity, failures, and collection health. These counts include API requests, conversation turns, and task attempts.',
  Runs: 'Open a recorded trace to see which operations happened, how long they took, and where a failure or delay occurred. A trace can represent an API request, conversation, or task attempt.',
  Logs: 'Read the events that explain recorded activity. Info describes routine activity; warnings highlight interruptions or uncertainty; errors point to failures. Expand technical details to correlate a record with its trace.',
  Usage: 'See token usage reported by providers. Input tokens represent material sent to the model; output tokens represent its generated response. Unreported usage remains unknown.',
  Settings: 'Choose whether to record new diagnostics and how much history to keep. Turning collection off preserves existing records. These controls apply to the connected backend.',
}
const bytes = (value = 0) => `${(value / 1024 / 1024).toFixed(1)} MiB`

function OverviewView({ data, onRuns }: { data: Overview; onRuns: (status?: string) => void }) {
  const cards = [
    { label: 'Recorded traces', value: data.total_traces, status: undefined, description: 'Retained requests, conversation turns, and task attempts. Open one to inspect its timeline.' },
    { label: 'Failed traces', value: data.failed_traces, status: 'error', description: 'Traces with a recorded failure. Open these first when investigating a problem.' },
    { label: 'In progress', value: data.active_traces, status: 'running', description: 'Operations that have not ended. Live event streams may stay open while the app is connected.' },
  ]
  return <div className="space-y-4">
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">{cards.map(card => <button key={card.label} className="diagnostic-panel p-5 text-left hover:bg-muted/20 space-y-2" onClick={() => onRuns(card.status)}><span className="text-xs text-muted-foreground">{card.label}</span><strong className="block text-2xl tabular-nums">{card.value}</strong><p className="text-xs text-muted-foreground leading-relaxed">{card.description}</p></button>)}<div className="diagnostic-panel p-5 space-y-2"><span className="text-xs text-muted-foreground">Missing diagnostic records</span><strong className="block text-2xl tabular-nums">{data.dropped_records}</strong><p className="text-xs text-muted-foreground leading-relaxed">Records lost to collection limits or storage failures since history was last cleared. A value above zero means some history is incomplete.</p></div></div>
    <details className="text-xs border border-border rounded-lg p-3"><summary className="cursor-pointer font-medium">Collection health and storage</summary><p className="text-muted-foreground mt-3 leading-relaxed">Waiting to save: {data.queue_depth ?? 0} records · Diagnostic storage: {bytes(data.storage_bytes)} of {data.settings.max_storage_mb} MiB · Backend workers (goroutines): {data.runtime?.goroutines ?? 'Unknown'} · Backend heap: {data.runtime?.heap_bytes === undefined ? 'Unknown' : bytes(data.runtime.heap_bytes)}</p><p className="text-muted-foreground mt-2">A growing queue or missing records can indicate collection pressure. These measurements describe the backend, not the agent's progress.</p></details>
    {data.dropped_records > 0 && <p className="text-sm text-amber-600">Some diagnostic records were not saved. Timelines may be incomplete; task execution outcomes must be checked separately.</p>}
    {data.detailed_scope && <p className="text-xs text-muted-foreground">This project or task view includes only history still within the retention period.</p>}
    <EvilChartsMetrics points={data.points ?? []} />
    <div className="border border-border rounded-lg p-4"><h3 className="font-medium mb-1">Where time is spent</h3><p className="text-xs text-muted-foreground mb-3">Recorded time per operation. High averages can help locate delays; an API request may include time waiting on child operations or an open stream.</p><div className="overflow-auto"><table className="diagnostic-table"><thead><tr><th>Operation</th><th>Recorded count</th><th>Failures</th><th>Average duration (ms)</th></tr></thead><tbody>{(data.operations ?? []).map(operation => <tr key={operation.name} className="border-t border-border"><td className="py-2 pr-4"><p className="font-medium">{operationLabel(operation.name)}</p><p className="text-muted-foreground mt-1 max-w-xl">{operationDescription(operation.name)}</p></td><td>{operation.count}</td><td>{operation.errors}</td><td>{operation.average_duration_ms.toFixed(1)}</td></tr>)}</tbody></table></div>{!(data.operations ?? []).length && <p className="text-sm text-muted-foreground mt-3">No completed operations have been recorded in this view yet.</p>}</div>
  </div>
}

function UsageView({ data }: { data: Overview }) {
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">Totals include only usage the provider reported, including reported retries. Missing reports do not mean zero usage. Monetary costs are unavailable because pricing is not configured.</p>{!(data.usage ?? []).length ? <p>No reported provider usage. Token totals are unknown.</p> : <div className="overflow-auto"><table className="diagnostic-table"><thead><tr><th>Provider</th><th>Model</th><th>Input tokens</th><th>Output tokens</th><th>Reported-usage operations</th></tr></thead><tbody>{data.usage.map(usage => <tr key={JSON.stringify([usage.provider, usage.model])} className="border-t border-border"><td className="py-3">{usage.provider || 'Unavailable'}</td><td>{usage.model || 'Unavailable'}</td><td>{usage.input_tokens}</td><td>{usage.output_tokens}</td><td>{usage.known_runs}</td></tr>)}</tbody></table></div>}<h3 className="font-medium">Recorded feature use</h3>{(data.features ?? []).map(feature => <p key={feature.name} className="text-sm">{feature.name}: {feature.count}</p>)}{!(data.features ?? []).length && <p className="text-sm text-muted-foreground">No recorded feature events.</p>}</div>
}

function DiagnosticLogRow({ log }: { log: DiagnosticLog }) {
  const timestamp = new Date(log.timestamp)
  const time = Number.isNaN(timestamp.getTime()) ? log.timestamp : timestamp.toLocaleString()
  const label = log.label ?? operationLabel(log.name)
  const scope = log.task_id ? `Task ${log.task_id}` : log.name.startsWith('http.') ? 'API activity' : 'Application activity'
  return <div className="diagnostic-panel p-4 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{label}</p><time className="text-muted-foreground tabular-nums" dateTime={log.timestamp} title={log.timestamp}>{time}</time></div>
    {(log.http_method || log.http_route) && <p className="font-mono break-all">{log.http_method} {log.http_route}{log.http_status_code ? ` · HTTP ${log.http_status_code}` : ''}{log.duration_ms !== undefined ? ` · ${log.duration_ms.toFixed(1)} ms` : ''}</p>}
    <p className="text-muted-foreground leading-relaxed">{log.description ?? operationDescription(log.name)}</p>
    <div className="flex flex-wrap gap-2 items-center"><span className={`rounded px-1.5 py-0.5 uppercase text-[10px] font-medium ${log.severity === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>{log.severity}</span><span className="text-muted-foreground">{scope}</span>{log.provider && <span className="text-muted-foreground">{log.provider}</span>}</div>
    <details className="text-muted-foreground"><summary className="cursor-pointer">Technical details</summary><div className="font-mono break-all mt-2 space-y-1">{label !== log.name && <div>Event {log.name}</div>}<div>Trace {log.trace_id}</div><div>Span {log.span_id}</div>{log.run_id && <div>Run {log.run_id}</div>}</div></details>
  </div>
}

function LogsView({ config, filter, live, active, refreshRevision }: { config: BackendConfig; filter: DiagnosticFilter; live: boolean; active: boolean; refreshRevision: number }) {
  const [severity, setSeverity] = useState('')
  const logFilter = { ...filter, severity }
  const scope = `${backendKey(config)}${diagnosticQuery(logFilter)}`
  const [page, setPage] = useState({ scope: '', offset: 0 }); const offset = page.scope === scope ? page.offset : 0
  const resource = useDiagnosticResource(`logs:${scope}:${offset}`, signal => diagnosticsAPI.logs(config, { ...logFilter, offset }, signal), active, live, refreshRevision)
  return <div className="space-y-3"><label className="text-xs flex items-center gap-2">Severity<select className="bg-background border border-border rounded p-1" aria-label="Log severity filter" value={severity} onChange={e => setSeverity(e.target.value)}><option value="">All</option>{['info', 'warn', 'error', 'debug'].map(value => <option key={value}>{value}</option>)}</select></label>{resource.loading && <p role="status">Loading logs…</p>}{resource.error && <p role="alert">{resource.error}</p>}{resource.data && <><p className="text-xs text-muted-foreground">{resource.data.total} matching records · at most 100 records per page</p><div className="space-y-1">{(resource.data.items ?? []).map(log => <DiagnosticLogRow key={log.id} log={log} />)}</div>{!(resource.data.items ?? []).length && <p>No matching logs. History may be empty or expired.</p>}<div className="flex gap-2"><Button variant="outline" size="sm" disabled={!offset} onClick={() => setPage({ scope, offset: Math.max(0, offset - 100) })}>Previous logs</Button><Button variant="outline" size="sm" disabled={offset + 100 >= resource.data.total} onClick={() => setPage({ scope, offset: offset + 100 })}>Next logs</Button></div></>}</div>
}

function SettingsView({ config, onChanged, active, refreshRevision }: { config: BackendConfig; onChanged: () => void; active: boolean; refreshRevision: number }) {
  const scope = backendKey(config)
  const currentScope = useRef(scope)
  useLayoutEffect(() => { currentScope.current = scope }, [scope])
  const resource = useDiagnosticResource(`settings:${scope}`, signal => diagnosticsAPI.settings(config, signal), active, false, refreshRevision)
  const [draft, setDraft] = useState<DiagnosticSettings | null>(null)
  const [confirmation, setConfirmation] = useState(''); const [pending, setPending] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('')
  const settings = draft ?? resource.data
  async function mutate(operation: () => Promise<unknown>, success: string) {
    if (pending) return
    const requestScope = scope; setPending(true); setError(''); setMessage('')
    try { await operation(); if (currentScope.current !== requestScope) return; setMessage(success); setDraft(null); setConfirmation(''); resource.refresh(); onChanged() } catch (err) { if (currentScope.current === requestScope) setError(err instanceof Error ? err.message : 'Settings operation failed') } finally { if (currentScope.current === requestScope) setPending(false) }
  }
  return <div className="diagnostic-panel space-y-5 p-6 max-w-2xl">{resource.loading && <p role="status">Loading settings…</p>}{(resource.error || error) && <p role="alert">{resource.error || error}</p>}{message && <p role="status">{message}</p>}{settings && <><label className="flex items-center gap-2 text-sm"><input aria-label="Enable local diagnostics collection" type="checkbox" checked={settings.enabled} onChange={e => setDraft({ ...settings, enabled: e.target.checked })} />Enable local diagnostics collection</label>{([{ field: 'retention_days', label: 'Detailed retention (days)', min: 1, max: 365 }, { field: 'metrics_retention_days', label: 'Metric retention (days)', min: settings.retention_days, max: 3650 }, { field: 'max_storage_mb', label: 'Storage budget (MiB)', min: 1, max: 10240 }] as const).map(item => <label key={item.field} className="block text-sm space-y-1">{item.label}<Input aria-label={item.label} type="number" min={item.min} max={item.max} value={settings[item.field]} onChange={e => setDraft({ ...settings, [item.field]: Number(e.target.value) })} /></label>)}<Button disabled={pending || !Number.isInteger(settings.retention_days) || settings.retention_days < 1 || settings.retention_days > 365 || !Number.isInteger(settings.metrics_retention_days) || settings.metrics_retention_days < settings.retention_days || settings.metrics_retention_days > 3650 || !Number.isInteger(settings.max_storage_mb) || settings.max_storage_mb < 1 || settings.max_storage_mb > 10240} onClick={() => void mutate(() => diagnosticsAPI.saveSettings(config, settings), 'Diagnostics settings saved.')}>Save diagnostics settings</Button><div className="border border-destructive/20 bg-destructive/5 rounded-xl p-4 space-y-3"><p className="text-sm">Clear diagnostic history on this backend. Tasks, conversations, and projects are preserved. This cannot be undone.</p><label className="block text-xs">Type CLEAR to confirm<Input aria-label="Confirm clear diagnostic history" value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="CLEAR" /></label><Button variant="destructive" disabled={pending || confirmation !== 'CLEAR'} onClick={() => void mutate(() => diagnosticsAPI.clear(config), 'Diagnostic history cleared.')}>Clear diagnostic history</Button></div></>}</div>
}

export function DiagnosticsPage({ config, active = true }: { config: BackendConfig | null; active?: boolean }) {
  const [tab, setTab] = useState<Tab>('Overview'); const [live, setLive] = useState(true); const [filter, setFilter] = useState<DiagnosticFilter>({})
  const [refreshRevision, setRefreshRevision] = useState(0)
  const refreshAll = () => setRefreshRevision(value => value + 1)
  const [exportState, setExportState] = useState({ pending: false, message: '', error: '', scope: '' })
  const scope = backendKey(config); const currentScope = useRef(scope)
  useLayoutEffect(() => { currentScope.current = scope }, [scope])
  const overview = useDiagnosticResource(`overview:${scope}:${diagnosticQuery(filter)}`, signal => diagnosticsAPI.overview(config!, filter, signal), active && !!config, live, refreshRevision)
  async function exportBundle() {
    if (!config || (exportState.scope === scope && exportState.pending)) return
    const exportScope = scope; setExportState({ pending: true, message: '', error: '', scope })
    try {
      const bundle = sanitizedExport(await diagnosticsAPI.export(config, filter))
      if (currentScope.current !== exportScope) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `orchestra-diagnostics-${Date.now()}.json`; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
      setExportState({ pending: false, message: bundle.truncated ? 'Export saved. The bounded export was truncated.' : 'Sanitized diagnostic export saved locally.', error: '', scope })
    } catch (err) { if (currentScope.current === exportScope) setExportState({ pending: false, message: '', error: err instanceof Error ? err.message : 'Export failed', scope }) }
  }
  return <section aria-label="Diagnostics" className="diagnostics-page flex-1 min-h-0 overflow-auto p-6 space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.2em] text-primary font-semibold mb-1">Local observability</p><h1 className="text-2xl font-semibold tracking-tight">Diagnostics</h1><p className="text-xs text-muted-foreground">Understand what the app and agents are doing, where time is spent, and what needs attention. Stored locally on the connected backend.</p></div><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{live ? 'Live' : 'Paused'} · Last update {overview.updated?.toLocaleTimeString() ?? 'not yet'}</span><Button size="sm" variant="outline" onClick={() => setLive(value => !value)}>{live ? 'Pause live updates' : 'Resume live updates'}</Button><Button size="sm" variant="outline" disabled={!config} onClick={refreshAll}>Refresh diagnostics</Button><Button size="sm" variant="outline" disabled={!config || (exportState.scope === scope && exportState.pending)} onClick={() => void exportBundle()}>Export diagnostics</Button></div></header><nav aria-label="Diagnostic views" className="flex gap-1 border-b border-border pb-2">{tabs.map(value => <Button key={value} size="sm" variant={tab === value ? 'secondary' : 'ghost'} aria-pressed={tab === value} onClick={() => setTab(value)}>{value}</Button>)}</nav><p className="text-sm text-muted-foreground max-w-4xl leading-relaxed">{viewDescriptions[tab]}</p>{!config ? <p>Connect a backend to inspect Diagnostics.</p> : <>
    {overview.loading && <p role="status">Loading diagnostics…</p>}{overview.error && <p role="alert">Backend diagnostics unavailable: {overview.error}</p>}{overview.data && !overview.data.settings.enabled && <p className="text-sm border border-border bg-muted/20 rounded p-3">Collection disabled. Retained history remains available.</p>}
    {exportState.scope === scope && exportState.error && <p role="alert">{exportState.error}</p>}{exportState.scope === scope && exportState.message && <p role="status">{exportState.message}</p>}
    {tab !== 'Settings' && <DiagnosticFilters filter={filter} onChange={setFilter} />}
    {tab === 'Overview' && overview.data && <OverviewView data={overview.data} onRuns={status => { setFilter(previous => ({ ...previous, status })); setTab('Runs') }} />}
    {tab === 'Usage' && overview.data && <UsageView data={overview.data} />}
    {tab === 'Runs' && <RunInspector config={config} filter={filter} live={live} active={active} refreshRevision={refreshRevision} />}
    {tab === 'Logs' && <LogsView config={config} filter={filter} live={live} active={active} refreshRevision={refreshRevision} />}
    {tab === 'Settings' && <SettingsView key={scope} config={config} onChanged={refreshAll} active={active} refreshRevision={refreshRevision} />}
  </>}</section>
}
