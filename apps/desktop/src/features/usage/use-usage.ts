import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type BackendConfig,
  type UsageProvider,
  type UsageScope,
  type UsageRange,
  type UsageScanState,
  type UsageSummary,
  type UsageDailyPoint,
  type UsageBreakdownRow,
  type UsageSessionRow,
  type RateLimitState,
  fetchUsageScanState,
  setUsageEnabled,
  refreshUsage,
  fetchUsageSummary,
  fetchUsageDaily,
  fetchUsageBreakdown,
  fetchUsageSessions,
  fetchRateLimits,
  refreshRateLimits,
} from '@core/api/client'

export const USAGE_PROVIDERS: UsageProvider[] = ['claude', 'codex', 'gemini', 'opencode']

export type ProviderUsageBundle = {
  provider: UsageProvider
  scanState: UsageScanState | null
  summary: UsageSummary | null
  daily: UsageDailyPoint[]
  modelBreakdown: UsageBreakdownRow[]
  projectBreakdown: UsageBreakdownRow[]
  sessions: UsageSessionRow[]
  loading: boolean
  error: string | null
}

export type UsageState = {
  scope: UsageScope
  range: UsageRange
  setScope: (scope: UsageScope) => void
  setRange: (range: UsageRange) => void
  bundles: Record<UsageProvider, ProviderUsageBundle>
  rateLimits: RateLimitState | null
  rateLimitError: string | null
  refreshAll: (force?: boolean) => Promise<void>
  refreshProvider: (provider: UsageProvider, force?: boolean) => Promise<void>
  toggleProvider: (provider: UsageProvider, enabled: boolean) => Promise<void>
}

const emptyBundle = (provider: UsageProvider): ProviderUsageBundle => ({
  provider,
  scanState: null,
  summary: null,
  daily: [],
  modelBreakdown: [],
  projectBreakdown: [],
  sessions: [],
  loading: false,
  error: null,
})
const emptyBundles = () => Object.fromEntries(USAGE_PROVIDERS.map(p => [p, emptyBundle(p)])) as Record<UsageProvider, ProviderUsageBundle>

export function useUsage(config: BackendConfig | null): UsageState {
  const [scope, setScope] = useState<UsageScope>('all')
  const [range, setRange] = useState<UsageRange>('30d')
  const [rateLimits, setRateLimits] = useState<RateLimitState | null>(null)
  const [rateLimitError, setRateLimitError] = useState<string | null>(null)
  const queryKey = JSON.stringify([config?.baseUrl, config?.apiToken, scope, range])
  const query = useRef({ key: queryKey, generation: 0 })
  if (query.current.key !== queryKey) query.current = { key: queryKey, generation: query.current.generation + 1 }
  const [dataKey, setDataKey] = useState(queryKey)
  const rateToken = useRef(0)
  const [bundles, setBundles] = useState<Record<UsageProvider, ProviderUsageBundle>>(() => ({
    claude: emptyBundle('claude'),
    codex: emptyBundle('codex'),
    gemini: emptyBundle('gemini'),
    opencode: emptyBundle('opencode'),
  }))

  // Per-provider request token. Each call increments the token; stale resolutions
  // (from a prior scope/range) compare against the current token and bail.
  const requestToken = useRef<Record<UsageProvider, number>>({
    claude: 0, codex: 0, gemini: 0, opencode: 0,
  })

  const loadProvider = useCallback(
    async (provider: UsageProvider, force = false): Promise<void> => {
      if (!config) return
      const generation = query.current.generation
      const token = ++requestToken.current[provider]
      const isFresh = () => query.current.key === queryKey && query.current.generation === generation && requestToken.current[provider] === token
      setBundles((b) => ({ ...b, [provider]: { ...b[provider], loading: true, error: null } }))
      try {
        const scanState = await fetchUsageScanState(config, provider)
        if (!isFresh()) return
        let next = scanState
        if (scanState.enabled && (force || !scanState.last_scan_completed_at)) {
          next = await refreshUsage(config, provider, force)
          if (!isFresh()) return
        }
        if (!next.enabled || !next.has_any_data) {
          setBundles((b) => ({
            ...b,
            [provider]: {
              ...emptyBundle(provider),
              scanState: next,
            },
          }))
          return
        }
        const [summary, daily, modelBreakdown, projectBreakdown, sessions] = await Promise.all([
          fetchUsageSummary(config, provider, scope, range),
          fetchUsageDaily(config, provider, scope, range),
          fetchUsageBreakdown(config, provider, scope, range, 'model'),
          fetchUsageBreakdown(config, provider, scope, range, 'project'),
          fetchUsageSessions(config, provider, scope, range, 25),
        ])
        if (!isFresh()) return
        setBundles((b) => ({
          ...b,
          [provider]: {
            provider,
            scanState: next,
            summary,
            daily,
            modelBreakdown,
            projectBreakdown,
            sessions,
            loading: false,
            error: null,
          },
        }))
      } catch (err) {
        if (!isFresh()) return
        setBundles((b) => ({
          ...b,
          [provider]: {
            ...b[provider],
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load usage',
          },
        }))
      }
    },
    [config, scope, range, queryKey],
  )

  const loadAll = useCallback(
    async (force = false) => {
      if (!config) return
      const generation = query.current.generation
      const token = ++rateToken.current
      const fresh = () => query.current.key === queryKey && query.current.generation === generation && rateToken.current === token
      try {
        const limits = await fetchRateLimits(config)
        if (!fresh()) return
        setRateLimits(limits)
        setRateLimitError(null)
      } catch (err) {
        if (!fresh()) return
        setRateLimitError(err instanceof Error ? err.message : 'Unable to observe rate limits')
      }
      if (!fresh()) return
      await Promise.all(USAGE_PROVIDERS.map((p) => loadProvider(p, force)))
    },
    [config, loadProvider, queryKey],
  )

  // Reload when config / scope / range changes.
  useEffect(() => {
    setDataKey(queryKey)
    setBundles(emptyBundles())
    setRateLimits(null)
    setRateLimitError(null)
    void loadAll(false)
    return () => { query.current.generation++ }
  }, [loadAll, queryKey])

  const toggleProvider = useCallback(
    async (provider: UsageProvider, enabled: boolean) => {
      if (!config) return
      const generation = query.current.generation
      const token = ++requestToken.current[provider]
      const fresh = () => query.current.key === queryKey && query.current.generation === generation && requestToken.current[provider] === token
      try {
        const next = await setUsageEnabled(config, provider, enabled)
        if (!fresh()) return
        setBundles((b) => ({
          ...b,
          [provider]: { ...emptyBundle(provider), scanState: next },
        }))
        if (enabled) {
          await loadProvider(provider, true)
        }
      } catch (err) {
        if (!fresh()) return
        setBundles((b) => ({
          ...b,
          [provider]: {
            ...b[provider],
            error: err instanceof Error ? err.message : 'Failed to toggle provider',
          },
        }))
      }
    },
    [config, loadProvider, queryKey],
  )

  const refreshAll = useCallback(
    async (force = true) => {
      if (!config) return
      const generation = query.current.generation
      const token = ++rateToken.current
      const fresh = () => query.current.key === queryKey && query.current.generation === generation && rateToken.current === token
      try {
        const limits = await refreshRateLimits(config)
        if (!fresh()) return
        setRateLimits(limits)
        setRateLimitError(null)
      } catch (err) {
        if (!fresh()) return
        setRateLimitError(err instanceof Error ? err.message : 'Unable to observe rate limits')
      }
      if (!fresh()) return
      await Promise.all(USAGE_PROVIDERS.map((p) => loadProvider(p, force)))
    },
    [config, loadProvider, queryKey],
  )

  return useMemo<UsageState>(
    () => ({
      scope,
      range,
      setScope,
      setRange,
      bundles: dataKey === queryKey ? bundles : emptyBundles(),
      rateLimits: dataKey === queryKey ? rateLimits : null,
      rateLimitError: dataKey === queryKey ? rateLimitError : null,
      refreshAll,
      refreshProvider: loadProvider,
      toggleProvider,
    }),
    [scope, range, bundles, rateLimits, rateLimitError, dataKey, queryKey, refreshAll, loadProvider, toggleProvider],
  )
}
