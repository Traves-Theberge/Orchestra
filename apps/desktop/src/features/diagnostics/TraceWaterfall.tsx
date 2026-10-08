import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DiagnosticSpan, TraceDetail } from './api'
import { Button } from '@ui/button'
import { Input } from '@ui/input'
import { CopyValue, OutcomeBadge } from './DiagnosticControls'
import { operationDescription, operationLabel } from './presentation'

type Row = { span: DiagnosticSpan; depth: number; offsetMs: number; durationMs: number; children: boolean; warning?: string; ancestors: string[] }
const time = (value: string) => { const result = Date.parse(value); return Number.isFinite(result) ? result : 0 }

/** Iterative traversal bounds indentation and visits malformed trees once, including cycles. */
export function buildWaterfall(spans: DiagnosticSpan[], now = Date.now()): Row[] {
  if (!spans.length) return []
  const ordered = [...new Map(spans.map(s => [s.span_id, s])).values()].sort((a, b) => time(a.start_time) - time(b.start_time) || a.span_id.localeCompare(b.span_id))
  const ids = new Set(ordered.map(s => s.span_id)); const children = new Map<string, DiagnosticSpan[]>()
  for (const span of ordered) { const siblings = children.get(span.parent_span_id) ?? []; siblings.push(span); children.set(span.parent_span_id, siblings) }
  const start = Math.min(...ordered.map(s => time(s.start_time))); const visited = new Set<string>(); const result: Row[] = []
  const walk = (root: DiagnosticSpan, warning?: string) => {
    const pending: { span: DiagnosticSpan; depth: number; ancestors: string[]; warning?: string }[] = [{ span: root, depth: 0, ancestors: [], warning }]
    while (pending.length) {
      const node = pending.pop()!; const span = node.span
      if (visited.has(span.span_id)) continue
      visited.add(span.span_id)
      const descendants = children.get(span.span_id) ?? []
      const cycle = descendants.some(child => node.ancestors.includes(child.span_id) || child.span_id === span.span_id)
      result.push({ ...node, warning: cycle ? 'Parent cycle detected' : node.warning, children: descendants.length > 0, offsetMs: Math.max(0, time(span.start_time) - start), durationMs: span.status === 'running' && !span.end_time ? Math.max(0, now - time(span.start_time)) : Math.max(0, span.duration_ms || 0) })
      for (let i = descendants.length - 1; i >= 0; i--) pending.push({ span: descendants[i], depth: Math.min(node.depth + 1, 64), ancestors: [...node.ancestors, span.span_id] })
    }
  }
  for (const span of ordered) if (!span.parent_span_id || !ids.has(span.parent_span_id)) walk(span, span.parent_span_id ? 'Missing parent span' : undefined)
  for (const span of ordered) if (!visited.has(span.span_id)) walk(span, 'Parent cycle detected')
  return result
}

export function TraceWaterfall({ detail }: { detail: TraceDetail }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); const [selected, setSelected] = useState<string | null>(null); const [zoom, setZoom] = useState(1)
  const allRows = useMemo(() => buildWaterfall(detail.spans ?? []), [detail])
  const [query, setQuery] = useState('')
  const matchingIds = new Set<string>()
  if (query.trim()) for (const row of allRows) {
    if ([row.span.name, row.span.label, row.span.http_route, row.span.provider, row.span.model, row.span.status].join(' ').toLowerCase().includes(query.trim().toLowerCase())) {
      matchingIds.add(row.span.span_id); row.ancestors.forEach(id => matchingIds.add(id))
    }
  }
  const rows = allRows.filter(row => query.trim() ? matchingIds.has(row.span.span_id) : !row.ancestors.some(id => collapsed.has(id)))
  const extent = Math.max(1, ...allRows.map(row => row.offsetMs + row.durationMs))
  const parent = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({ count: rows.length > 100 ? rows.length : 0, getScrollElement: () => parent.current, estimateSize: () => 40, overscan: 12 })
  const selectedRow = allRows.find(row => row.span.span_id === selected)
  const selectedSpan = selectedRow?.span
  const selectedFields: Record<string, string | number> = selectedSpan ? {
    Outcome: selectedSpan.status,
    Operation: selectedSpan.name,
    ...(selectedSpan.name === 'http.request' ? {
      'HTTP method': selectedSpan.http_method ?? 'Not recorded in this historical request',
      'Route template': selectedSpan.http_route ?? 'Not recorded in this historical request',
      'HTTP status': selectedSpan.http_status_code ?? 'Not recorded in this historical request',
    } : {
      ...(selectedSpan.provider ? { Provider: selectedSpan.provider } : {}),
      ...(selectedSpan.model ? { Model: selectedSpan.model } : {}),
      ...(selectedSpan.attempt > 0 ? { Attempt: selectedSpan.attempt } : {}),
      'Input tokens': selectedSpan.input_tokens ?? 'Unknown',
      'Output tokens': selectedSpan.output_tokens ?? 'Unknown',
    }),
    Duration: selectedRow!.durationMs.toFixed(1) + ' ms' + (selectedSpan.status === 'running' ? ' (in progress)' : ''),
    Started: selectedSpan.start_time,
    Ended: selectedSpan.end_time ?? 'Not observed',
    ...(selectedSpan.task_id ? { Task: selectedSpan.task_id } : {}),
    ...(selectedSpan.project_id ? { Project: selectedSpan.project_id } : {}),
    ...(selectedSpan.run_id ? { Run: selectedSpan.run_id } : {}),
    ...(selectedSpan.session_id ? { Session: selectedSpan.session_id } : {}),
    Trace: selectedSpan.trace_id,
    Span: selectedSpan.span_id,
  } : {}
  const virtualRows = rows.length > 100 ? virtual.getVirtualItems().map(item => ({ row: rows[item.index], index: item.index, top: item.start })) : rows.map((row, index) => ({ row, index, top: index * 40 }))
  return <section aria-label="Trace waterfall" className="diagnostic-panel space-y-4 p-5 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Run timeline</h3><p className="text-xs text-muted-foreground mt-1">{allRows.length} operations · {extent.toFixed(1)} ms observed window · {allRows.filter(row => row.span.status === 'error').length} failures</p></div><label className="flex items-center gap-2 text-xs">Timeline zoom<select aria-label="Timeline zoom" className="bg-background border border-border rounded px-2 py-1" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[1, 2, 4, 8].map(value => <option key={value} value={value}>{value}×</option>)}</select></label></div>
    <Input aria-label="Find operation" placeholder="Find operation, endpoint, provider, or outcome..." value={query} onChange={event => setQuery(event.target.value)} />
    {detail.partial && <p className="text-sm text-amber-600">Partial trace: some operation evidence is unavailable or expired.</p>}
    <p className="text-xs text-muted-foreground">Read left to right: each bar starts when an operation began, and its width shows the recorded time spent. Indented rows belong to the operation above them. Overlapping bars ran during the same period. Select a row to see its purpose, outcome, and related events.</p>
    {allRows.some(row => row.warning) && <p className="text-sm text-amber-600">Incomplete hierarchy: missing parent or parent cycle detected.</p>}
    <div ref={parent} tabIndex={0} aria-label="Scrollable operation timeline" className="overflow-auto max-h-[420px] border border-border rounded">
      <div style={{ minWidth: `${Math.max(700, 700 * zoom)}px` }}>
        <div className="flex text-xs text-muted-foreground border-b border-border py-2"><span className="w-64 shrink-0 px-2">Operation / outcome</span><span className="flex-1 flex justify-between px-2">{[0, .25, .5, .75, 1].map(fraction => <span key={fraction}>{(extent * fraction).toFixed(0)} ms</span>)}</span><span className="w-20 shrink-0 text-right pr-3">Duration</span></div>
        <div style={{ position: 'relative', height: rows.length * 40 }}>
          {virtualRows.map(({ row, index, top }) => <div key={row.span.span_id} data-selected={selected === row.span.span_id} className="diagnostic-waterfall-row flex items-center border-b border-border/40 h-10" style={{ position: 'absolute', top, width: '100%' }}>
            <div className="w-64 shrink-0 flex items-center gap-1 pr-1 min-w-0" style={{ paddingLeft: 4 + Math.min(row.depth, 12) * 10 }}>
              {row.children ? <button className="w-5 shrink-0" aria-label={`${collapsed.has(row.span.span_id) ? 'Expand' : 'Collapse'} ${row.span.name}`} aria-expanded={!collapsed.has(row.span.span_id)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(row.span.span_id)) next.delete(row.span.span_id); else next.add(row.span.span_id); return next })}>{collapsed.has(row.span.span_id) ? '+' : '−'}</button> : <span className="w-5 shrink-0" />}
              <button data-testid={`span-row-${row.span.span_id}`} aria-label={`Select ${row.span.name} span${row.span.attempt ? ` attempt ${row.span.attempt}` : ''}`} aria-pressed={selected === row.span.span_id} title={row.warning} className="truncate text-xs text-left hover:text-primary focus-visible:outline focus-visible:outline-primary" onClick={() => setSelected(row.span.span_id)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const target = rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]; setSelected(target.span.span_id); if (rows.length > 100) virtual.scrollToIndex(rows.indexOf(target)); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="span-row-${target.span.span_id}"]`)?.focus()) } }}>{row.span.label ?? operationLabel(row.span.name)}{row.span.attempt > 0 ? ` · attempt ${row.span.attempt}` : ''} · {row.span.status}</button>
            </div>
            <button tabIndex={-1} aria-label={`Timing for ${row.span.name}`} className="diagnostic-grid relative flex-1 h-10 mr-2 text-left" onClick={() => setSelected(row.span.span_id)}><span data-testid={`span-bar-${row.span.span_id}`} className={`diagnostic-bar diagnostic-bar-${row.span.status} ${selected === row.span.span_id ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`} style={{ left: `${row.offsetMs / extent * 100}%`, width: `${Math.max(0.3, row.durationMs / extent * 100)}%` }}><span className="sr-only">{row.durationMs.toFixed(0)} ms</span></span></button><span className="w-20 shrink-0 text-right pr-3 text-[11px] tabular-nums text-muted-foreground">{row.durationMs.toFixed(1)} ms</span>
          </div>)}
        </div>
      </div>
    </div>
    {!rows.length && <p className="text-sm text-muted-foreground">{query ? 'No operations match this search.' : 'No retained spans. History may have expired.'}</p>}
    {selectedSpan && <div data-testid="span-details" aria-label="Selected span details" className="rounded-xl border border-border bg-muted/20 p-4 text-sm space-y-4"><div className="flex justify-between"><h4 className="font-medium">{selectedSpan.label ?? operationLabel(selectedSpan.name)}</h4><Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close span details</Button></div><p className="text-xs text-muted-foreground leading-relaxed">{selectedSpan.description ?? operationDescription(selectedSpan.name)}</p><OutcomeBadge status={selectedSpan.status} /><dl className="diagnostic-span-fields">{Object.entries(selectedFields).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-muted-foreground">{key}</dt><dd>{['Trace', 'Span', 'Session', 'Task', 'Project', 'Run'].includes(key) ? <CopyValue value={String(value)} label={key.toLowerCase() + ' ID'} /> : value}</dd></div>)}</dl><h5 className="font-medium">Linked log events</h5>{(detail.logs ?? []).filter(log => log.span_id === selectedSpan.span_id).map(log => <p key={log.id} className="text-xs font-mono">{log.timestamp} · {log.severity} · {log.name}</p>)}{!(detail.logs ?? []).some(log => log.span_id === selectedSpan.span_id) && <p className="text-xs text-muted-foreground">No retained linked events.</p>}</div>}
  </section>
}
