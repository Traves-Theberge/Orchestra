import { ZoomControl } from '@layout/ZoomControl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, RefreshCw, ChevronRight, Settings2 } from 'lucide-react'
import { useAppStore } from '@core/store'
import {
  type BackendConfig,
  type UsageProvider,
  type QuotaProvider,
  type ProviderRateLimits,
  type RateLimitState,
  type UsageSummary,
  fetchRateLimits,
  refreshRateLimits,
  fetchUsageScanState,
  fetchUsageSummary,
  refreshUsage,
} from '@core/api/client'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { providerLabel, ProviderIcon } from './provider-meta'
import {
  MiniBar,
  WindowSection,
  remainingPct,
  timeAgo,
  windowLabel,
} from './rate-limit-ui'
import { useNow } from '@/hooks'
import { formatTokens } from './format'

// Orca's status bar tracks only the providers that actually have plan windows.
// Gemini and OpenCode have no comparable rate-limit concept, so they don't
// belong in the bar — they're still tracked on the Usage page for token data.
const BAR_PROVIDERS: UsageProvider[] = ['claude', 'codex']
const ROSTER_PROVIDERS: QuotaProvider[] = ['claude', 'codex', 'antigravity', 'opencode', '8gent', 'gemini']
const POLL_MS = 5 * 60 * 1000     // 5 min — quota windows are slow-moving
const FOCUS_MIN_MS = 30 * 1000    // refetch on focus if older than 30s

export function UsageStatusBar({ config, generatedAt }: { config: BackendConfig | null; generatedAt?: string }) {
  const [rateLimits, setRateLimits] = useState<RateLimitState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const lastFetchRef = useRef(0)
  const profileKey = JSON.stringify([config?.baseUrl, config?.apiToken])
  const profile = useRef({ key: profileKey, generation: 0 })
  if (profile.current.key !== profileKey) profile.current = { key: profileKey, generation: profile.current.generation + 1 }
  const [dataKey, setDataKey] = useState(profileKey)
  const requestToken = useRef(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // Match Orca: only collapse to icon-only when the bar is genuinely too
  // short to show text. The mini progress bar stays visible alongside text.
  const iconOnly = width < 280

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const loadAll = useCallback(
    async (force: boolean) => {
      if (!config) return
      const generation = profile.current.generation
      const token = ++requestToken.current
      const fresh = () => profile.current.key === profileKey && profile.current.generation === generation && token === requestToken.current
      lastFetchRef.current = Date.now()
      try {
        const limits = force ? await refreshRateLimits(config) : await fetchRateLimits(config)
        if (!fresh()) return
        setRateLimits(limits)
      } catch (err) {
        if (!fresh()) return
        setRateLimits(previous => Object.fromEntries(BAR_PROVIDERS.map(p => [p, { ...previous?.[p], provider: p, status: 'error', error: err instanceof Error ? err.message : 'Unable to observe rate limits', updated_at: previous?.[p]?.updated_at ?? 0 }])) as RateLimitState)
      }
    },
    [config, profileKey],
  )

  useEffect(() => {
    setDataKey(profileKey)
    setRateLimits(null)
    setRefreshing(false)
    if (!config) return
    void loadAll(false)
    const id = window.setInterval(() => void loadAll(false), POLL_MS)
    const onFocus = () => {
      if (Date.now() - lastFetchRef.current > FOCUS_MIN_MS) void loadAll(false)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      profile.current.generation++
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [config, loadAll, profileKey])

  useEffect(() => {
    if (!config) return
    const changed = () => { setRateLimits(null); void loadAll(true) }
    window.addEventListener('orchestra-account-selection-changed', changed)
    return () => window.removeEventListener('orchestra-account-selection-changed', changed)
  }, [config, loadAll])

  const handleRefresh = useCallback(async () => {
    const generation = profile.current.generation
    setRefreshing(true)
    try {
      await loadAll(true)
    } finally {
      if (profile.current.key === profileKey && profile.current.generation === generation) setRefreshing(false)
    }
  }, [loadAll, profileKey])

  const visibleLimits = dataKey === profileKey ? rateLimits : null
  const anyFetching = BAR_PROVIDERS.some((p) => visibleLimits?.[p]?.status === 'fetching')

  if (!config) return null

  return (
    <div
      ref={containerRef}
      className="flex items-center h-6 min-h-[24px] px-3 border-t border-border bg-[var(--bg-titlebar,var(--card))] text-xs select-none shrink-0"
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {BAR_PROVIDERS.map((p) => (
          <ProviderSegment
            key={p}
            provider={p}
            limits={visibleLimits?.[p] ?? null}
            iconOnly={iconOnly}
          />
        ))}
        <UsageRoster config={config} limits={visibleLimits} refreshing={refreshing} onRefresh={() => void handleRefresh()} />
        <AppTooltip content="Refresh usage data">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center justify-center p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
            aria-label="Refresh rate limits"
          >
            <RefreshCw size={11} className={refreshing || anyFetching ? 'animate-spin' : ''} />
          </button>
        </AppTooltip>
      </div>
      {generatedAt && (
        <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums shrink-0 pl-4">{generatedAt}</span>
      )}
      <ZoomControl />
    </div>
  )
}

type HistoryObservation = { kind: 'off' | 'empty' | 'error' | 'ready' | 'unsupported'; summary?: UsageSummary }

function UsageRoster({ config, limits, refreshing, onRefresh }: { config: BackendConfig; limits: RateLimitState | null; refreshing: boolean; onRefresh: () => void }) {
  const [open, setOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [historySnapshot, setHistorySnapshot] = useState<{ key: string; rows: Record<QuotaProvider, HistoryObservation> } | null>(null)
  const historyKey = JSON.stringify([config.baseUrl, config.apiToken, refreshKey])
  const history = historySnapshot?.key === historyKey ? historySnapshot.rows : null
  const ref = useRef<HTMLDivElement>(null)
  const setActiveSection = useAppStore(state => state.setActiveSection)

  useEffect(() => {
    if (!open) return
    let active = true
    void Promise.all(ROSTER_PROVIDERS.map(async (provider): Promise<[QuotaProvider, HistoryObservation]> => {
      if (provider === 'antigravity' || provider === '8gent') return [provider, { kind: 'unsupported' }]
      try {
        const scan = await fetchUsageScanState(config, provider)
        if (!scan.enabled) return [provider, { kind: 'off' }]
        const observed = refreshKey > 0 ? await refreshUsage(config, provider, true) : scan
        if (!observed.has_any_data) return [provider, { kind: 'empty' }]
        return [provider, { kind: 'ready', summary: await fetchUsageSummary(config, provider, 'all', '30d') }]
      } catch {
        return [provider, { kind: 'error' }]
      }
    })).then(rows => {
      if (active) setHistorySnapshot({ key: historyKey, rows: Object.fromEntries(rows) as Record<QuotaProvider, HistoryObservation> })
    })
    return () => { active = false }
  }, [config, historyKey, open, refreshKey])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return <div ref={ref} className="relative shrink-0">
    <button type="button" aria-label="Open all usage insights" aria-expanded={open} onClick={() => setOpen(value => !value)} className={`inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition-colors hover:bg-muted ${open ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}><Activity size={12} /><span>Usage</span></button>
    {open && <div role="dialog" aria-label="Usage insights" className="absolute bottom-full left-0 z-50 mb-1.5 w-80 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5"><span className="text-xs font-semibold">Usage insights</span><button type="button" aria-label="Refresh usage insights" disabled={refreshing} onClick={() => { setRefreshKey(value => value + 1); onRefresh() }} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /></button></div>
      <div className="divide-y divide-border/40">{ROSTER_PROVIDERS.map(provider => {
        const observation = limits?.[provider]
        const window = observation?.session ?? observation?.weekly
        const summary = window ? `${remainingPct(window)}% ${windowLabel(window)} remaining` : observation?.status === 'error' ? 'Observation failed' : observation?.status === 'unavailable' ? 'Quota window unavailable' : 'Quota not observed'
        const local = history?.[provider]
        const localText = !local ? 'Checking local history…' : local.kind === 'ready' && local.summary ? `${formatTokens(local.summary.total_tokens)} tokens · local 30d` : local.kind === 'off' ? 'Local tracking off' : local.kind === 'empty' ? 'No local history' : 'Local history unavailable'
        return <button type="button" key={provider} onClick={() => { setOpen(false); setActiveSection('SETTINGS'); const s = useAppStore.getState(); s.setActiveSettingsSection('usage'); s.scrollToSettingsSection?.('usage') }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent/60"><ProviderIcon provider={provider} size={16} /><span className="min-w-0 flex-1"><span title={providerLabel(provider)} className="block truncate text-xs font-medium">{providerLabel(provider)}{observation?.account_label ? <span className="ml-1 font-normal text-muted-foreground">· {observation.account_label}</span> : null}</span><span className="block truncate text-[10px] text-muted-foreground/70">{localText}</span></span><span className="max-w-32 shrink-0 truncate text-[10px] text-muted-foreground">{summary}</span><ChevronRight size={12} className="shrink-0 text-muted-foreground" /></button>
      })}</div>
      <button type="button" onClick={() => { setOpen(false); setActiveSection('SETTINGS'); const s = useAppStore.getState(); s.setActiveSettingsSection('usage'); s.scrollToSettingsSection?.('usage') }} className="flex w-full items-center justify-between border-t border-border/60 px-3 py-2.5 text-xs font-medium hover:bg-accent/60">Usage details and history <ChevronRight size={13} /></button>
    </div>}
  </div>
}

function ProviderSegment({
  provider,
  limits,
  iconOnly,
}: {
  provider: UsageProvider
  limits: ProviderRateLimits | null
  iconOnly: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 h-6 px-1.5 rounded transition-colors ${
          open ? 'bg-muted text-foreground' : 'hover:bg-muted text-foreground/85 hover:text-foreground'
        }`}
        aria-label={`Open ${providerLabel(provider)} usage details`}
      >
        <SegmentBody limits={limits} provider={provider} iconOnly={iconOnly} />
      </button>
      {open && <DetailPopover provider={provider} limits={limits} />}
    </div>
  )
}

function SegmentBody({
  provider,
  limits,
  iconOnly,
}: {
  provider: UsageProvider
  limits: ProviderRateLimits | null
  iconOnly: boolean
}) {
  // Idle / loading — no data yet
  if (!limits || limits.status === 'idle') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <ProviderIcon provider={provider} size={12} />
        <span className="animate-pulse">···</span>
      </span>
    )
  }

  // Fetching with no prior data
  if (limits.status === 'fetching' && !limits.session && !limits.weekly) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <ProviderIcon provider={provider} size={12} />
        <span className="animate-pulse">···</span>
      </span>
    )
  }

  // Unavailable (no plan / CLI not installed)
  if (limits.status === 'unavailable') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground/60">
        <ProviderIcon provider={provider} size={12} />
        {!iconOnly && <span>--</span>}
      </span>
    )
  }

  // An observation failure is unknown utilization, not loading or zero.
  if (limits.status === 'error' && !limits.session && !limits.weekly) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <ProviderIcon provider={provider} size={12} />
        <span title={limits.error}>Unknown</span>
      </span>
    )
  }

  // Ok / fetching-with-stale / error-with-stale: show real data.
  const sessionLeft = limits.session ? remainingPct(limits.session) : null
  const weeklyLeft = limits.weekly ? remainingPct(limits.weekly) : null

  // Match Orca: neutral foreground text by default, only flip to red when
  // remaining capacity is critically low (<10%).
  const tone = (left: number) => (left < 10 ? 'text-red-400' : 'text-foreground/85')

  // In compact / icon-only mode the bar still surfaces a single primary
  // percentage so the user has a usable signal at narrow widths. We prefer
  // session left, falling back to weekly when only weekly is configured.
  const primaryLeft = sessionLeft ?? weeklyLeft

  return (
    <span className="inline-flex items-center gap-1.5">
      <ProviderIcon provider={provider} size={12} />
      {iconOnly ? (
        primaryLeft != null && (
          <span className={`text-[11px] tabular-nums font-medium ${tone(primaryLeft)}`}>
            {primaryLeft}%
          </span>
        )
      ) : (
        <>
          {limits.session && <MiniBar leftPct={sessionLeft ?? 0} />}
          {limits.session && (
            <span className={`text-[11px] tabular-nums font-medium ${tone(sessionLeft ?? 0)}`}>
              {sessionLeft}% {windowLabel(limits.session)}
            </span>
          )}
          {limits.session && limits.weekly && (
            <span className="text-muted-foreground/50">·</span>
          )}
          {limits.weekly && (
            <span className={`text-[11px] tabular-nums font-medium ${tone(weeklyLeft ?? 0)}`}>
              {weeklyLeft}% {windowLabel(limits.weekly)}
            </span>
          )}
        </>
      )}
    </span>
  )
}

function DetailPopover({
  provider,
  limits,
}: {
  provider: UsageProvider
  limits: ProviderRateLimits | null
}) {
  const setActiveSection = useAppStore((s) => s.setActiveSection)
  const setActiveAgentProvider = useAppStore((s) => s.setActiveAgentProvider)
  const setActiveAgentCategory = useAppStore((s) => s.setActiveAgentCategory)
  const now = useNow(60_000)
  const openHarnessSetup = () => {
    setActiveAgentProvider(provider === 'claude' ? 'claude' : 'codex')
    setActiveAgentCategory(provider === 'claude' ? 'settings' : 'config')
    setActiveSection('AGENTS')
  }
  return (
    <div className="absolute bottom-full left-0 mb-1.5 z-50 w-[300px] rounded-lg border border-border/60 bg-popover shadow-xl">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ProviderIcon provider={provider} size={14} />
          <span className="text-[13px] font-medium text-foreground">{providerLabel(provider)}</span>
        </div>
        {limits && limits.updated_at > 0 && (
          <span className="text-[10.5px] tabular-nums text-muted-foreground">
            {timeAgo(limits.updated_at, now)}
          </span>
        )}
      </div>

      <div className="h-px bg-border/60" />

      <div className="space-y-3 p-3">
        {!limits || limits.status === 'idle' || limits.status === 'fetching' ? (
          <p className="text-[12px] text-muted-foreground">Loading rate limits…</p>
        ) : limits.session || limits.weekly ? (
          <>
            {limits.session && <WindowSection w={limits.session} label="Session (5h)" />}
            {limits.weekly && <WindowSection w={limits.weekly} label="Weekly" />}
            {limits.status === 'error' && <p role="status" className="text-xs text-muted-foreground">Showing cached data. {limits.error}</p>}
          </>
        ) : limits.status === 'unavailable' ? (
          <p className="text-[12px] text-muted-foreground">
            {limits.error ?? `Rate limits unavailable for ${providerLabel(provider)}.`}
          </p>
        ) : (
          <p className="text-[12px] text-muted-foreground">{limits.error || 'Rate-limit utilization unknown.'}</p>
        )}
      </div>

      <div className="h-px bg-border/60" />
      <div className="p-1">
        <button
          type="button"
          onClick={() => { setActiveSection('SETTINGS'); const s = useAppStore.getState(); s.setActiveSettingsSection('usage'); s.scrollToSettingsSection?.('usage') }}
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[12px] text-foreground/85 hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
        >
          <span>Usage details and history</span>
          <ChevronRight size={12} className="text-muted-foreground/60" />
        </button>
        <button
          type="button"
          onClick={openHarnessSetup}
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[12px] text-foreground/85 hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
        >
          <span>Set up {providerLabel(provider)}</span>
          <Settings2 size={12} className="text-muted-foreground/60" />
        </button>
      </div>
    </div>
  )
}
