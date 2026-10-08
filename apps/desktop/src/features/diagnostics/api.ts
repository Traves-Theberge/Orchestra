import { requestJSON, type BackendConfig } from '@core/api/client'

export type DiagnosticSpan = {
  trace_id: string; span_id: string; parent_span_id: string; name: string
  start_time: string; end_time?: string; duration_ms: number; status: string
  project_id: string; task_id: string; run_id: string; session_id: string
  provider: string; model: string; attempt: number; input_tokens?: number; output_tokens?: number
  label?: string; description?: string; http_method?: string; http_route?: string; http_status_code?: number
}
export type TraceSummary = DiagnosticSpan & { span_count: number }
export type DiagnosticLog = { id: string | number; trace_id: string; span_id: string; timestamp: string; name: string; severity: string; project_id?: string; task_id?: string; run_id?: string; session_id?: string; provider?: string; model?: string; attempt?: number; label?: string; description?: string; http_method?: string; http_route?: string; http_status_code?: number; duration_ms?: number }
export type TraceDetail = { trace: TraceSummary; spans: DiagnosticSpan[]; logs: DiagnosticLog[]; partial: boolean }
export type Page<T> = { items: T[]; total: number; limit: number; offset: number }
export type DiagnosticSettings = { enabled: boolean; retention_days: number; metrics_retention_days: number; max_storage_mb: number }
export type DiagnosticPoint = { time: string; operations: number; errors: number; duration_ms: number; input_tokens?: number; output_tokens?: number }
export type Overview = {
  detailed_scope?: boolean; total_traces: number; failed_traces: number; active_traces: number
  dropped_records: number; storage_bytes: number; queue_depth: number; points: DiagnosticPoint[]
  operations: { name: string; count: number; errors: number; average_duration_ms: number }[]
  usage: { provider: string; model?: string; input_tokens: number; output_tokens: number; known_runs: number }[]
  features: { name: string; count: number }[]; runtime: { goroutines: number; heap_bytes: number }; settings: DiagnosticSettings
}
export type DiagnosticFilter = { project_id?: string; task_id?: string; provider?: string; status?: string; severity?: string; q?: string; since?: string; until?: string; limit?: number; offset?: number }
export type DiagnosticExport = { schema_version: number; exported_at: string; traces: TraceSummary[]; spans: DiagnosticSpan[]; logs: DiagnosticLog[]; truncated: boolean }
export function diagnosticQuery(filter: DiagnosticFilter = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== '') query.set(key, String(value))
  return query.size ? `?${query}` : ''
}
const root = '/api/v1/diagnostics'
export const diagnosticsAPI = {
  overview: (config: BackendConfig, filter: DiagnosticFilter, signal?: AbortSignal) => requestJSON<Overview>(config, `${root}/overview${diagnosticQuery(filter)}`, signal ? { signal } : undefined),
  traces: (config: BackendConfig, filter: DiagnosticFilter, signal?: AbortSignal) => requestJSON<Page<TraceSummary>>(config, `${root}/traces${diagnosticQuery({ limit: 100, ...filter })}`, signal ? { signal } : undefined),
  trace: (config: BackendConfig, id: string, signal?: AbortSignal) => requestJSON<TraceDetail>(config, `${root}/traces/${encodeURIComponent(id)}`, signal ? { signal } : undefined),
  logs: (config: BackendConfig, filter: DiagnosticFilter, signal?: AbortSignal) => requestJSON<Page<DiagnosticLog>>(config, `${root}/logs${diagnosticQuery({ limit: 100, ...filter })}`, signal ? { signal } : undefined),
  settings: (config: BackendConfig, signal?: AbortSignal) => requestJSON<DiagnosticSettings>(config, `${root}/settings`, signal ? { signal } : undefined),
  saveSettings: (config: BackendConfig, settings: DiagnosticSettings) => requestJSON<DiagnosticSettings>(config, `${root}/settings`, { method: 'PUT', body: JSON.stringify(settings) }),
  clear: (config: BackendConfig) => requestJSON<void>(config, `${root}/history`, { method: 'DELETE' }),
  export: (config: BackendConfig, filter: DiagnosticFilter) => requestJSON<DiagnosticExport>(config, `${root}/export${diagnosticQuery(filter)}`),
}

// The export is reconstructed from the content-free DTO allowlist before download.
export function sanitizedExport(bundle: DiagnosticExport): DiagnosticExport {
  const pickSpan = (s: DiagnosticSpan): DiagnosticSpan => ({ trace_id: s.trace_id, span_id: s.span_id, parent_span_id: s.parent_span_id, name: s.name, start_time: s.start_time, end_time: s.end_time, duration_ms: s.duration_ms, status: s.status, project_id: s.project_id, task_id: s.task_id, run_id: s.run_id, session_id: s.session_id, provider: s.provider, model: s.model, attempt: s.attempt, label: s.label, description: s.description, http_method: s.http_method, http_route: s.http_route, http_status_code: s.http_status_code, input_tokens: s.input_tokens, output_tokens: s.output_tokens })
  return { schema_version: bundle.schema_version, exported_at: bundle.exported_at, truncated: bundle.truncated, traces: (bundle.traces ?? []).map(s => ({ ...pickSpan(s), span_count: s.span_count })), spans: (bundle.spans ?? []).map(pickSpan), logs: (bundle.logs ?? []).map(l => ({ id: l.id, trace_id: l.trace_id, span_id: l.span_id, timestamp: l.timestamp, name: l.name, severity: l.severity, project_id: l.project_id, task_id: l.task_id, run_id: l.run_id, session_id: l.session_id, provider: l.provider, model: l.model, attempt: l.attempt, label: l.label, description: l.description, http_method: l.http_method, http_route: l.http_route, http_status_code: l.http_status_code, duration_ms: l.duration_ms })) }
}
