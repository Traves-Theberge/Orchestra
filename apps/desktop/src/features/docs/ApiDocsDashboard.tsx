import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Code2, Loader2, RefreshCw, Search } from 'lucide-react'
import { parse } from 'yaml'
import { fetchOpenAPISpec, toDisplayError, type BackendConfig } from '@core/api/client'

type Operation = {
  method: string
  path: string
  summary?: string
  description?: string
  operationId?: string
  tags?: string[]
  parameters?: Array<Record<string, unknown>>
  requestBody?: Record<string, unknown>
  responses?: Record<string, Record<string, unknown>>
}

type OpenAPIDocument = {
  openapi?: string
  info?: { title?: string; version?: string; description?: string }
  paths?: Record<string, Record<string, unknown>>
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const
const methodColors: Record<string, string> = {
  GET: 'text-emerald-500 bg-emerald-500/10',
  POST: 'text-blue-500 bg-blue-500/10',
  PUT: 'text-amber-500 bg-amber-500/10',
  PATCH: 'text-violet-500 bg-violet-500/10',
  DELETE: 'text-rose-500 bg-rose-500/10',
}

function listOperations(document: OpenAPIDocument | null): Operation[] {
  const output: Operation[] = []
  for (const [path, pathItem] of Object.entries(document?.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const value = pathItem[method]
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
      output.push({ method: method.toUpperCase(), path, ...(value as Omit<Operation, 'method' | 'path'>) })
    }
  }
  return output.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function ApiDocsDashboard({ config }: { config: BackendConfig }) {
  const [result, setResult] = useState<{ key: string; document: OpenAPIDocument | null; error: string | null } | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const requestKey = JSON.stringify([config.baseUrl, config.apiToken, refreshKey])
  const loading = result?.key !== requestKey
  const document = loading ? null : result.document
  const error = loading ? null : result.error

  useEffect(() => {
    let active = true
    fetchOpenAPISpec(config)
      .then((source) => {
        const parsed = parse(source) as OpenAPIDocument
        if (!parsed || typeof parsed !== 'object' || !parsed.paths) {
          throw new Error('The backend returned an invalid OpenAPI document.')
        }
        if (active) setResult({ key: requestKey, document: parsed, error: null })
      })
      .catch((cause: unknown) => {
        if (active) setResult({ key: requestKey, document: null, error: toDisplayError(cause) })
      })
    return () => { active = false }
  }, [config, requestKey])

  const operations = useMemo(() => listOperations(document), [document])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return operations
    return operations.filter((operation) => [
      operation.method,
      operation.path,
      operation.summary,
      operation.description,
      operation.operationId,
      ...(operation.tags ?? []),
    ].some((value) => value?.toLowerCase().includes(needle)))
  }, [operations, query])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border/50 px-8 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-primary">
              <Code2 size={16} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">API Reference</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{document?.info?.title || 'Orchestra API'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              OpenAPI {document?.openapi || '3.x'}{document?.info?.version ? ` · Version ${document.info.version}` : ''}
              {' · '}{operations.length} operations
            </p>
            {document?.info?.description && <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{document.info.description}</p>}
          </div>
          <button type="button" onClick={() => setRefreshKey(value => value + 1)} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground" aria-label="Reload API reference">
            <RefreshCw size={14} /> Reload
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 min-h-0 flex-col overflow-hidden px-8">
        <div className="shrink-0 py-5">
          <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 text-muted-foreground focus-within:ring-1 focus-within:ring-primary">
            <Search size={15} />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter by path, method, summary, or tag" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60" aria-label="Filter API operations" />
            <span className="text-xs tabular-nums">{filtered.length}/{operations.length}</span>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-auto pb-8">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading API reference…</div>
          ) : error ? (
            <div role="alert" className="mx-auto mt-8 max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-5">
              <h2 className="font-medium">API reference unavailable</h2>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
              <button type="button" onClick={() => setRefreshKey(value => value + 1)} className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">Try again</button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No API operations match that filter.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((operation) => {
                const key = `${operation.method} ${operation.path}`
                const isExpanded = expanded === key
                return (
                  <article key={key} className="overflow-hidden rounded-lg border border-border bg-card">
                    <button type="button" onClick={() => setExpanded(isExpanded ? null : key)} aria-expanded={isExpanded} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30">
                      {isExpanded ? <ChevronDown size={15} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={15} className="shrink-0 text-muted-foreground" />}
                      <span className={`w-[4.5rem] shrink-0 rounded px-2 py-1 text-center font-mono text-[11px] font-bold ${methodColors[operation.method] ?? 'bg-muted text-foreground'}`}>{operation.method}</span>
                      <code className="min-w-0 shrink-0 text-[13px] font-medium">{operation.path}</code>
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{operation.summary || operation.operationId || ''}</span>
                      {!!operation.tags?.length && <span className="hidden rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground md:inline-flex">{operation.tags[0]}</span>}
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border/70 px-5 py-4">
                        {operation.description && <p className="mb-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{operation.description}</p>}
                        {operation.parameters?.length ? <Detail title="Parameters" value={operation.parameters} /> : null}
                        {operation.requestBody ? <Detail title="Request body" value={operation.requestBody} /> : null}
                        {operation.responses ? <Detail title="Responses" value={operation.responses} /> : null}
                        {operation.operationId && <p className="mt-4 text-xs text-muted-foreground">Operation ID: <code>{operation.operationId}</code></p>}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Detail({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <pre className="max-h-72 overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-5"><code>{pretty(value)}</code></pre>
    </section>
  )
}
