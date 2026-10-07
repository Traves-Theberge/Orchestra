import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plug, RefreshCw, Zap } from 'lucide-react'
import { fetchMcpServerStatus, probeMcpServer, type BackendConfig, type McpServerStatus, type McpServerStatusValue } from '@core/api/client'
import { Button } from '@ui/button'
import { cn } from '@core/utils/cn'
import { harnessLabel } from '../lib/agent-display'

const STATUS: Record<McpServerStatusValue, { label: string; dot: string; text: string }> = {
  connected: { label: 'Connected', dot: 'bg-emerald-500', text: 'text-foreground' },
  disabled: { label: 'Disabled', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  failed: { label: 'Failed', dot: 'bg-red-500', text: 'text-red-500' },
  needs_auth: { label: 'Needs auth', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  unknown: { label: 'Unknown', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
}

export function McpStatusBadge({ status }: { status: string }) {
  const meta = STATUS[status as McpServerStatusValue] ?? STATUS.unknown
  return <span data-testid="mcp-status" data-status={status} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] leading-4', meta.text)}>
    <span aria-hidden="true" className={cn('size-1.5 rounded-full', meta.dot)} />{meta.label}
  </span>
}

const sourceLabel = (server: McpServerStatus) => server.source === 'orchestra' ? 'Orchestra' : server.harness ? harnessLabel(server.harness) : 'Harness'

/**
 * Orchestra-managed and harness-native MCP servers with probe status.
 * With `harness`, shows Orchestra servers plus that harness's own servers.
 */
export function McpStatusPanel({ config, harness, compact = false }: { config: BackendConfig; harness?: string; compact?: boolean }) {
  const [servers, setServers] = useState<McpServerStatus[]>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [probing, setProbing] = useState<Record<string, boolean>>({})
  const load = useCallback(async () => {
    setLoading(true)
    try { setServers(await fetchMcpServerStatus(config)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'MCP status unavailable') }
    finally { setLoading(false) }
  }, [config])
  useEffect(() => { void load() }, [load])
  const probe = async (server: McpServerStatus) => {
    setProbing(previous => ({ ...previous, [server.name]: true }))
    try {
      const next = await probeMcpServer(config, server.name)
      setServers(previous => previous?.map(item => item.name === server.name && item.source === server.source ? { ...item, ...next } : item))
    } catch (cause) {
      setServers(previous => previous?.map(item => item.name === server.name && item.source === server.source ? { ...item, status: 'failed', error: cause instanceof Error ? cause.message : 'Probe failed' } : item))
    } finally { setProbing(previous => ({ ...previous, [server.name]: false })) }
  }
  const visible = (servers ?? []).filter(server => !harness || server.source === 'orchestra' || !server.harness || server.harness.toLowerCase() === harness.toLowerCase())
  return (
    <section aria-label="MCP server status" className={cn('flex min-h-0 flex-col', compact ? 'px-[18px] pt-[18px]' : 'h-full px-6 py-5')}>
      <div className="mb-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {!compact && <div className="mb-1 flex items-center gap-2 text-muted-foreground"><Plug className="size-4" /><span className="text-[11px] font-medium uppercase tracking-wide">MCP</span></div>}
          <h2 className={cn('font-semibold tracking-tight', compact ? 'text-[13px]' : 'text-[18px]')}>{compact ? 'Server status' : 'MCP servers'}</h2>
          {!compact && <p className="mt-1 text-[13px] text-muted-foreground">Orchestra-managed servers are passed to every harness run; harness-native servers keep loading from each harness's own config.</p>}
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Refresh
        </Button>
      </div>
      {error && <p role="alert" className="mb-2 text-[12px] text-red-500">{error}</p>}
      {!servers && !error && <p className="text-[12px] text-muted-foreground">Loading MCP status…</p>}
      {servers && !visible.length && <p className="text-[12px] text-muted-foreground">No MCP servers configured.</p>}
      {visible.length > 0 && (
        <ul className={cn('divide-y divide-border/50 overflow-y-auto', compact && 'max-h-56')}>
          {visible.map(server => (
            <li key={`${server.source}:${server.harness ?? ''}:${server.name}`} data-testid="mcp-server-row" className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium">{server.name}</span>
                  <span className="rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground">{sourceLabel(server)}</span>
                  {server.type && <span className="text-[11px] text-muted-foreground">{server.type}</span>}
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{server.url || [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')}</p>
                {server.error && <p className="truncate text-[11px] text-red-500" title={server.error}>{server.error}</p>}
              </div>
              <McpStatusBadge status={server.status} />
              <Button variant="ghost" size="sm" aria-label={`Probe ${server.name}`} className="h-7 gap-1 text-xs text-muted-foreground" disabled={!!probing[server.name] || server.enabled === false} onClick={() => void probe(server)}>
                {probing[server.name] ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}Probe
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
