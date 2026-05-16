import {
  Activity,
  AlertTriangle,
  Coins,
  DatabaseZap,
  FolderKanban,
  Gauge,
  RefreshCw,
  Sparkles,
  Waypoints,
} from 'lucide-react'
import type { BackendConfig, ProviderRateLimits } from '@core/api/client'
import { useUsage, USAGE_PROVIDERS, type ProviderUsageBundle } from './use-usage'
import { providerLabel, ProviderIcon } from './provider-meta'
import { FilterMenu, scopeLabel, rangeLabel } from './FilterMenu'
import { StatCard } from './StatCard'
import { WindowSection, timeAgo } from './rate-limit-ui'
import { useNow } from '@/hooks'
import {
  formatCost,
  formatNumber,
  formatTokens,
  formatUpdatedAt,
  formatSessionTime,
} from './format'
import type { UsageScope, UsageRange } from '@core/api/client'

export function UsagePage({ config }: { config: BackendConfig | null }) {
  const usage = useUsage(config)
  const { scope, range, setScope, setRange, bundles, rateLimits, refreshProvider, toggleProvider } = usage

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="w-full p-6 space-y-4">
        <div>
          <h1 className="text-base font-semibold text-foreground">Usage</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Per-agent token, model, and session stats from local CLI logs.
          </p>
        </div>
        <RateLimitsCard rateLimits={rateLimits} />
        {USAGE_PROVIDERS.map((p) => (
          <ProviderPane
            key={p}
            bundle={bundles[p]}
            scope={scope}
            range={range}
            onScopeChange={setScope}
            onRangeChange={setRange}
            onRefresh={() => void refreshProvider(p, true)}
            onToggle={(enabled) => void toggleProvider(p, enabled)}
          />
        ))}
      </div>
    </div>
  )
}

function RateLimitsCard({ rateLimits }: { rateLimits: ReturnType<typeof useUsage>['rateLimits'] }) {
  const entries = USAGE_PROVIDERS.map((p) => ({ provider: p, limits: rateLimits?.[p] ?? null }))
  const anyHasData = entries.some(({ limits }) => limits?.session || limits?.weekly)

  return (
    <section className="space-y-3 surface p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Rate limits</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Live 5-hour session and weekly window utilization per agent.
        </p>
      </div>
      {!anyHasData && (
        <p className="text-xs text-muted-foreground">
          No live rate-limit data available yet; backend probes are not wired in.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {entries.map(({ provider, limits }) => (
          <RateLimitTile key={provider} provider={provider} limits={limits} />
        ))}
      </div>
    </section>
  )
}

function RateLimitTile({
  provider,
  limits,
}: {
  provider: typeof USAGE_PROVIDERS[number]
  limits: ProviderRateLimits | null
}) {
  const now = useNow(60_000)
  return (
    <div className="surface p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ProviderIcon provider={provider} size={14} />
          <span className="text-[12.5px] font-medium text-foreground">{providerLabel(provider)}</span>
        </div>
        {limits && limits.updated_at > 0 && (
          <span className="text-[10.5px] tabular-nums text-muted-foreground">
            {timeAgo(limits.updated_at, now)}
          </span>
        )}
      </div>
      <RateLimitTileBody limits={limits} />
    </div>
  )
}

function RateLimitTileBody({ limits }: { limits: ProviderRateLimits | null }) {
  if (!limits || limits.status === 'idle' || limits.status === 'fetching') {
    return <p className="text-[11.5px] text-muted-foreground">Loading…</p>
  }
  if (limits.status === 'unavailable') {
    return (
      <p className="text-[11.5px] text-muted-foreground">
        {limits.error ?? 'Unavailable on this account.'}
      </p>
    )
  }
  if (limits.status === 'error' && !limits.session && !limits.weekly) {
    return (
      <p className="text-[11.5px] text-muted-foreground">
        {limits.error ?? 'Unable to fetch rate limits.'}
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {limits.session && <WindowSection w={limits.session} label="Session (5h)" />}
      {limits.weekly && <WindowSection w={limits.weekly} label="Weekly" />}
      {limits.status === 'error' && (limits.session || limits.weekly) && (
        <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/70">
          <AlertTriangle size={10} className="shrink-0" />
          <span>Showing cached data; auto-refresh paused</span>
        </div>
      )}
    </div>
  )
}

function ProviderPane({
  bundle,
  scope,
  range,
  onScopeChange,
  onRangeChange,
  onRefresh,
  onToggle,
}: {
  bundle: ProviderUsageBundle
  scope: UsageScope
  range: UsageRange
  onScopeChange: (s: UsageScope) => void
  onRangeChange: (r: UsageRange) => void
  onRefresh: () => void
  onToggle: (enabled: boolean) => void
}) {
  const { provider, scanState, summary, modelBreakdown, projectBreakdown, sessions, loading, error } = bundle
  const enabled = scanState?.enabled ?? false
  const sourceMissing = scanState !== null && !scanState.source_path_exists

  if (!enabled) {
    return (
      <div className="surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">{providerLabel(provider)} Usage Tracking</h3>
            <p className="text-xs text-muted-foreground">
              {sourceMissing
                ? `No local logs found at ${scanState?.source_path ?? 'expected path'}.`
                : `Reads local ${providerLabel(provider)} usage logs to show token, model, and session stats.`}
            </p>
          </div>
          <ToggleSwitch
            checked={false}
            disabled={sourceMissing}
            onChange={() => onToggle(true)}
            label={`Enable ${providerLabel(provider)} usage analytics`}
          />
        </div>
      </div>
    )
  }

  const hasAnyData = summary?.has_any_data ?? scanState?.has_any_data ?? false
  const isScanning = scanState?.is_scanning ?? false
  const cacheReuseRate = summary?.cache_reuse_rate
  const turns = summary?.turns ?? 0
  const zeroCacheTurns = summary?.zero_cache_read_turns ?? 0
  const zeroCachePct = turns > 0 ? Math.round((zeroCacheTurns / turns) * 100) : null

  return (
    <div className="space-y-4 surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{providerLabel(provider)} Usage Tracking</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatUpdatedAt(scanState?.last_scan_completed_at)}
            {scanState?.last_scan_error ? ` • Last scan error: ${scanState.last_scan_error}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 self-start">
          <FilterMenu
            scope={scope}
            range={range}
            onScopeChange={onScopeChange}
            onRangeChange={onRangeChange}
          />
          <button
            type="button"
            onClick={onRefresh}
            disabled={isScanning || loading}
            aria-label={`Refresh ${providerLabel(provider)} usage`}
            title="Refresh"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${isScanning || loading ? 'animate-spin' : ''}`} />
          </button>
          <ToggleSwitch
            checked={true}
            onChange={() => onToggle(false)}
            label={`Disable ${providerLabel(provider)} usage analytics`}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {scopeLabel(scope)} • {rangeLabel(range)}
        </p>
        {summary?.has_inferred_pricing && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-500">
            <AlertTriangle className="size-3" />
            Cost includes inferred pricing for unknown models.
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {!hasAnyData ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-6 text-sm text-muted-foreground">
          No local {providerLabel(provider)} usage found yet for this scope.
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Input tokens"
              value={formatTokens(summary?.input_tokens ?? 0)}
              icon={<Sparkles className="size-4" />}
            />
            <StatCard
              label="Output tokens"
              value={formatTokens(summary?.output_tokens ?? 0)}
              icon={<Activity className="size-4" />}
            />
            <StatCard
              label="Cache read"
              value={formatTokens(summary?.cache_read_tokens ?? 0)}
              icon={<DatabaseZap className="size-4" />}
            />
            <StatCard
              label="Cache write"
              value={formatTokens(summary?.cache_write_tokens ?? 0)}
              icon={<Waypoints className="size-4" />}
            />
            <StatCard
              label="Cache reuse rate"
              value={
                cacheReuseRate !== null && cacheReuseRate !== undefined
                  ? `${Math.round(cacheReuseRate * 100)}%`
                  : 'n/a'
              }
              icon={<Gauge className="size-4" />}
            />
            <StatCard
              label="Zero-cache-read turns"
              value={zeroCachePct !== null ? `${zeroCachePct}%` : 'n/a'}
              icon={<DatabaseZap className="size-4" />}
            />
            <StatCard
              label="Sessions / Turns"
              value={`${formatNumber(summary?.sessions ?? 0)} / ${formatNumber(turns)}`}
              icon={<FolderKanban className="size-4" />}
            />
            <StatCard
              label="Est. API-equivalent cost"
              value={formatCost(summary?.estimated_cost_usd ?? null)}
              icon={<Coins className="size-4" />}
            />
          </div>
          <p className="px-1 text-xs text-muted-foreground">
            Cache reuse rate is calculated as cache read tokens / (input tokens + cache read tokens).
          </p>

          <div className="grid gap-4 xl:grid-cols-2">
            <BreakdownSection
              title="By model"
              topLabel="Top model"
              topValue={summary?.top_model}
              rows={modelBreakdown}
            />
            <BreakdownSection
              title="By project"
              topLabel="Top project"
              topValue={summary?.top_project}
              rows={projectBreakdown}
            />
          </div>

          <RecentSessionsSection rows={sessions} cacheReuseRate={cacheReuseRate ?? null} />
        </>
      )}
    </div>
  )
}

function BreakdownSection({
  title,
  topLabel,
  topValue,
  rows,
}: {
  title: string
  topLabel: string
  topValue?: string
  rows: ProviderUsageBundle['modelBreakdown']
}) {
  return (
    <section className="surface p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground">
          {topLabel}: {topValue ?? 'n/a'}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data.</p>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 5).map((row) => (
            <div key={row.key} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-foreground" title={row.label}>
                  {row.label || '(unknown)'}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatTokens(row.input_tokens + row.output_tokens)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {formatNumber(row.sessions)} sessions • {formatNumber(row.turns)} turns
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function RecentSessionsSection({
  rows,
  cacheReuseRate,
}: {
  rows: ProviderUsageBundle['sessions']
  cacheReuseRate: number | null
}) {
  return (
    <section className="surface p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-foreground">Recent sessions</h4>
        <p className="text-xs text-muted-foreground">
          Cache reuse rate: {cacheReuseRate !== null ? `${Math.round(cacheReuseRate * 100)}%` : 'n/a'}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sessions in window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="p-2 font-medium">Last active</th>
                <th className="p-2 font-medium">Project</th>
                <th className="p-2 font-medium">Model</th>
                <th className="p-2 font-medium">Turns</th>
                <th className="p-2 font-medium">Input</th>
                <th className="p-2 font-medium">Output</th>
                <th className="p-2 font-medium">Cache</th>
                <th className="p-2 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.provider}::${row.session_id}`}
                  className="border-b border-border/40 last:border-b-0"
                >
                  <td className="p-2 text-muted-foreground tabular-nums">
                    {formatSessionTime(row.last_active_at)}
                  </td>
                  <td className="p-2 text-foreground">
                    <span className="truncate" title={row.project_label}>
                      {row.project_label || row.session_id.slice(0, 8)}
                    </span>
                    {row.branch && (
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        {row.branch}
                      </span>
                    )}
                  </td>
                  <td className="p-2 font-mono text-[12px] text-muted-foreground">
                    {row.model ?? 'Unknown'}
                  </td>
                  <td className="p-2 text-muted-foreground tabular-nums">{row.turns}</td>
                  <td className="p-2 text-muted-foreground tabular-nums">
                    {formatTokens(row.input_tokens)}
                  </td>
                  <td className="p-2 text-muted-foreground tabular-nums">
                    {formatTokens(row.output_tokens)}
                  </td>
                  <td className="p-2 text-muted-foreground tabular-nums">
                    {formatTokens(row.cache_read_tokens + row.cache_write_tokens)}
                  </td>
                  <td className="p-2 text-foreground tabular-nums">
                    {formatCost(row.estimated_cost_usd ?? null)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-foreground' : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
