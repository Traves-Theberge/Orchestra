import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@core/api/client'
import { useUsage } from './use-usage'

vi.mock('@core/api/client', () => ({
  fetchUsageScanState: vi.fn(), setUsageEnabled: vi.fn(), refreshUsage: vi.fn(),
  fetchUsageSummary: vi.fn(), fetchUsageDaily: vi.fn(), fetchUsageBreakdown: vi.fn(),
  fetchUsageSessions: vi.fn(), fetchRateLimits: vi.fn(), refreshRateLimits: vi.fn(),
}))
const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture-a' }
const other = { baseUrl: 'http://localhost:4015', apiToken: 'fixture-b' }
const scan: api.UsageScanState = { provider: 'codex', enabled: true, is_scanning: false, has_any_data: true, source_path_exists: true, last_scan_completed_at: 1 }
const summary = (input: number, range: api.UsageRange = '30d'): api.UsageSummary => ({ provider: 'codex', scope: 'all', range, sessions: 1, turns: 1, zero_cache_read_turns: 0, input_tokens: input, cached_input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: input, has_any_data: true, has_inferred_pricing: false })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.fetchRateLimits).mockResolvedValue({})
  vi.mocked(api.refreshRateLimits).mockResolvedValue({})
  vi.mocked(api.fetchUsageScanState).mockImplementation(async (_config, provider) => ({ ...scan, provider, enabled: provider === 'codex' }))
  vi.mocked(api.fetchUsageSummary).mockResolvedValue(summary(10))
  vi.mocked(api.fetchUsageDaily).mockResolvedValue([])
  vi.mocked(api.fetchUsageBreakdown).mockResolvedValue([])
  vi.mocked(api.fetchUsageSessions).mockResolvedValue([])
})
afterEach(cleanup)

describe('usage observation ownership', () => {
  it('ignores summaries from an older range and clears the prior range immediately', async () => {
    const old = deferred<api.UsageSummary>()
    vi.mocked(api.fetchUsageSummary).mockImplementation(async (_config, _provider, _scope, range) => range === '30d' ? old.promise : summary(20, range))
    const { result } = renderHook(() => useUsage(config))
    await waitFor(() => expect(api.fetchUsageSummary).toHaveBeenCalled())
    act(() => result.current.setRange('7d'))
    expect(result.current.bundles.codex.summary).toBeNull()
    await waitFor(() => expect(result.current.bundles.codex.summary?.input_tokens).toBe(20))
    await act(async () => old.resolve(summary(999)))
    expect(result.current.bundles.codex.summary?.input_tokens).toBe(20)
  })
  it('rejects a delayed old-profile rate limit before it can start scans', async () => {
    const old = deferred<api.RateLimitState>()
    vi.mocked(api.fetchRateLimits).mockImplementation(async c => c.baseUrl === config.baseUrl ? old.promise : {})
    const { result, rerender } = renderHook(({ selected }: { selected: api.BackendConfig | null }) => useUsage(selected), { initialProps: { selected: config as api.BackendConfig | null } })
    rerender({ selected: other })
    await waitFor(() => expect(result.current.bundles.codex.summary?.input_tokens).toBe(10))
    await act(async () => old.resolve({ codex: { provider: 'codex', status: 'error', updated_at: 1, error: 'old account' } }))
    expect(result.current.rateLimits).toEqual({})
    expect(api.fetchUsageScanState).not.toHaveBeenCalledWith(config, expect.anything())
    rerender({ selected: null })
    expect(result.current.bundles.codex.summary).toBeNull()
    expect(result.current.rateLimits).toBeNull()
  })
  it('keeps a 429 observation failure visible while loading local usage independently', async () => {
    vi.mocked(api.fetchRateLimits).mockRejectedValue(new Error('429: retry in 60 seconds'))
    const { result } = renderHook(() => useUsage(config))
    await waitFor(() => expect(result.current.bundles.codex.summary?.input_tokens).toBe(10))
    expect(result.current.rateLimitError).toBe('429: retry in 60 seconds')
    expect(result.current.rateLimits).toBeNull()
  })
  it('does not let an old enabled-toggle alter a different profile', async () => {
    const old = deferred<api.UsageScanState>()
    vi.mocked(api.setUsageEnabled).mockReturnValue(old.promise)
    const { result, rerender } = renderHook(({ selected }) => useUsage(selected), { initialProps: { selected: config } })
    await waitFor(() => expect(result.current.bundles.codex.summary).not.toBeNull())
    let pending!: Promise<void>
    act(() => { pending = result.current.toggleProvider('codex', false) })
    rerender({ selected: other })
    await waitFor(() => expect(result.current.bundles.codex.summary).not.toBeNull())
    await act(async () => { old.resolve({ ...scan, enabled: false }); await pending })
    expect(result.current.bundles.codex.scanState?.enabled).toBe(true)
  })
})
