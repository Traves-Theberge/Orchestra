import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, ChevronRight, Settings2 } from 'lucide-react'
import { useAppStore } from '@core/store'
import {
  type BackendConfig,
  type UsageProvider,
  type ProviderRateLimits,
  type RateLimitState,
  fetchRateLimits,
  refreshRateLimits,
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

// Orca's status bar tracks only the providers that actually have plan windows.
// Gemini and OpenCode have no comparable rate-limit concept, so they don't
// belong in the bar — they're still tracked on the Usage page for token data.
const BAR_PROVIDERS: UsageProvider[] = ['claude', 'codex']
const POLL_MS = 5 * 60 * 1000     // 5 min — quota windows are slow-moving
const FOCUS_MIN_MS = 30 * 1000    // refetch on focus if older than 30s

export function UsageStatusBar({ config, generatedAt }: { config: BackendConfig | null; generatedAt?: string }) {
  const [rateLimits, setRateLimits] = useState<RateLimitState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const lastFetchRef = useRef(0)

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
      lastFetchRef.current = Date.now()
      try {
        const limits = force ? await refreshRateLimits(config) : await fetchRateLimits(config)
        setRateLimits(limits)
      } catch {
        // non-fatal
      }
    },
    [config],
  )

  useEffect(() => {
    if (!config) return
    void loadAll(false)
    const id = window.setInterval(() => void loadAll(false), POLL_MS)
    const onFocus = () => {
      if (Date.now() - lastFetchRef.current > FOCUS_MIN_MS) void loadAll(false)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [config, loadAll])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await loadAll(true)
    } finally {
      setRefreshing(false)
    }
  }, [loadAll])

  const anyFetching = BAR_PROVIDERS.some((p) => rateLimits?.[p]?.status === 'fetching')

  if (!config) return null

  return (
    <div
      ref={containerRef}
      className="flex items-center h-6 min-h-[24px] px-3 border-t border-border bg-[var(--bg-titlebar,var(--card))] text-xs select-none shrink-0 overflow-hidden"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
        {BAR_PROVIDERS.map((p) => (
          <ProviderSegment
            key={p}
            provider={p}
            limits={rateLimits?.[p] ?? null}
            iconOnly={iconOnly}
          />
        ))}
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
    </div>
  )
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

  // Error with no data — render quietly as a loader rather than a warning.
  if (limits.status === 'error' && !limits.session && !limits.weekly) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <ProviderIcon provider={provider} size={12} />
        <span className="animate-pulse">···</span>
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
  const setSettingsInitialTab = useAppStore((s) => s.setSettingsInitialTab)
  const now = useNow(60_000)
  const openAccountSettings = () => {
    setSettingsInitialTab('agents')
    setActiveSection('SETTINGS')
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
          </>
        ) : limits.status === 'unavailable' ? (
          <p className="text-[12px] text-muted-foreground">
            {sanitizeRateLimitMessage(limits.error) ?? `Rate limits unavailable for ${providerLabel(provider)}.`}
          </p>
        ) : (
          <p className="text-[12px] text-muted-foreground">Loading rate limits…</p>
        )}
      </div>

      {/* Account / configuration footer — mirrors Orca */}
      <div className="h-px bg-border/60" />
      <div className="p-1">
        <p className="px-2 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60">
          {providerLabel(provider)} Account
        </p>
        <button
          type="button"
          onClick={openAccountSettings}
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[12px] text-foreground/85 hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
        >
          <span>System default</span>
          <ChevronRight size={12} className="text-muted-foreground/60" />
        </button>
        <button
          type="button"
          onClick={openAccountSettings}
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[12px] text-foreground/85 hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
        >
          <span>Manage Accounts…</span>
          <Settings2 size={12} className="text-muted-foreground/60" />
        </button>
      </div>
    </div>
  )
}

// Strip rate-limit / 429 backoff messages from any backend error string —
// these are noise the user can't act on and a stale daemon may keep emitting
// them after the underlying limit has cleared.
function sanitizeRateLimitMessage(msg: string | undefined | null): string | null {
  if (!msg) return null
  if (/rate.?limit|refresh paused|retry in|backing off|429/i.test(msg)) return null
  return msg
}
