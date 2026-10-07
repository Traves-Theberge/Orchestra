import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsagePage } from './UsagePage'
import { useUsage, USAGE_PROVIDERS, type UsageState } from './use-usage'

vi.mock('./use-usage', () => ({ useUsage: vi.fn(), USAGE_PROVIDERS: ['claude', 'codex', 'gemini', 'opencode', 'omp'] }))
const state = (): UsageState => ({
  scope: 'all', range: '30d', setScope: vi.fn(), setRange: vi.fn(), rateLimits: null, rateLimitError: null,
  refreshAll: vi.fn(), refreshProvider: vi.fn(), toggleProvider: vi.fn(),
  bundles: Object.fromEntries(USAGE_PROVIDERS.map(provider => [provider, { provider, scanState: null, summary: null, daily: [], modelBreakdown: [], projectBreakdown: [], sessions: [], loading: false, error: null }])) as unknown as UsageState['bundles'],
})
beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)
describe('UsagePage evidence labels', () => {
  it('shows unknown observations without pretending analytics are disabled or usage is zero', () => {
    const data = state()
    data.bundles.codex.error = 'Backend disconnected'
    data.rateLimitError = '429: retry in 60 seconds'
    vi.mocked(useUsage).mockReturnValue(data)
    render(<UsagePage config={null} />)
    expect(screen.getByText('Usage state unknown: Backend disconnected')).toBeInTheDocument()
    expect(screen.getByText(/Rate-limit observation failed: 429/)).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Enable Codex usage analytics' })).not.toBeInTheDocument()
    expect(screen.getByText('Gemini CLI (legacy logs) Usage Tracking')).toBeInTheDocument()
  })
  it('labels missing summary values unknown and all displayed costs as estimates', () => {
    const data = state()
    data.bundles.codex.scanState = { provider: 'codex', enabled: true, is_scanning: false, source_path_exists: true, has_any_data: true }
    data.bundles.codex.sessions = [{ provider: 'codex', session_id: 'fixture-session', project_label: '', model: '', branch: '', last_active_at: '', duration_minutes: 0, turns: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, estimated_cost_usd: 0, has_inferred_pricing: false }]
    vi.mocked(useUsage).mockReturnValue(data)
    render(<UsagePage config={null} />)
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(3)
    expect(screen.getByText('Unknown / Unknown')).toBeInTheDocument()
    expect(screen.getByText(/not subscription charges or invoices/)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Est. API-equivalent cost' })).toBeInTheDocument()
    expect(screen.getByText('$0.0000')).toBeInTheDocument()
  })
  it('tracks OMP as a real usage provider rather than an unsupported history harness', () => {
    vi.mocked(useUsage).mockReturnValue(state())
    render(<UsagePage config={null} />)
    expect(screen.getByText('OMP Usage Tracking')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'OMP local history' })).not.toBeInTheDocument()
  })
})
