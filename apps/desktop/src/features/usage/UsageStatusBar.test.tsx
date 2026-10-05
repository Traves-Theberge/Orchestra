import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@core/api/client'
import { useAppStore } from '@core/store'
import { UsageStatusBar } from './UsageStatusBar'

vi.mock('@core/api/client', () => ({ fetchRateLimits: vi.fn(), refreshRateLimits: vi.fn(), fetchUsageScanState: vi.fn(), fetchUsageSummary: vi.fn(), refreshUsage: vi.fn() }))
vi.mock('@ui/tooltip-wrapper', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture-a' }
const other = { baseUrl: 'http://localhost:4015', apiToken: 'fixture-b' }
const limits: api.RateLimitState = { codex: { provider: 'codex', status: 'ok', updated_at: 1, session: { used_percent: 10, window_minutes: 300 } } }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.mocked(api.fetchRateLimits).mockResolvedValue(limits)
  vi.mocked(api.fetchUsageScanState).mockImplementation(async (_config, provider) => ({ provider, enabled: provider === 'codex', is_scanning: false, has_any_data: provider === 'codex', source_path_exists: provider === 'codex' }))
  vi.mocked(api.fetchUsageSummary).mockImplementation(async (_config, provider) => ({ provider, total_tokens: 1234 } as api.UsageSummary))
  vi.mocked(api.refreshUsage).mockImplementation(async (_config, provider) => ({ provider, enabled: provider === 'codex', is_scanning: false, has_any_data: provider === 'codex', source_path_exists: provider === 'codex' }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('UsageStatusBar', () => {
  it('clears the prior account window while a new selection refreshes', async () => {
    let resolve!: (data: api.RateLimitState) => void
    vi.mocked(api.refreshRateLimits).mockImplementation(() => new Promise(r => { resolve = r }))
    render(<UsageStatusBar config={config} />)
    await screen.findByText('90%')
    fireEvent(window, new Event('orchestra-account-selection-changed'))
    expect(screen.queryByText('90%')).not.toBeInTheDocument()
    await act(async () => resolve({ codex: { provider: 'codex', account_id: 'second', account_label: 'Second', source: 'codex_app_server', status: 'ok', updated_at: 2, session: { used_percent: 50, window_minutes: 300 } } }))
    expect(await screen.findByText('50%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open all usage insights' }))
    expect(screen.getByRole('dialog', { name: 'Usage insights' })).toHaveTextContent('Second')
  })
  it('rejects old-profile observations and hides prior account utilization immediately', async () => {
    let resolve!: (data: api.RateLimitState) => void
    vi.mocked(api.fetchRateLimits).mockImplementation(c => c.baseUrl === other.baseUrl ? Promise.resolve({}) : new Promise(r => { resolve = r }))
    const { rerender } = render(<UsageStatusBar config={config} />)
    rerender(<UsageStatusBar config={other} />)
    await act(async () => resolve(limits))
    expect(screen.queryByText('90%')).not.toBeInTheDocument()
  })
  it('keeps rate-limit backoff visible and labels cached percentages', async () => {
    vi.mocked(api.refreshRateLimits).mockRejectedValue(new Error('429: retry in 60 seconds'))
    render(<UsageStatusBar config={config} />)
    await screen.findByText('90%')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh rate limits' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh rate limits' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Open Codex usage details' }))
    expect(await screen.findByText('Showing cached data. 429: retry in 60 seconds')).toBeInTheDocument()
  })
  it('shows a consolidated roster and routes to usage without claiming an account', async () => {
    render(<UsageStatusBar config={config} />)
    await screen.findByText('90%')
    fireEvent.click(screen.getByRole('button', { name: 'Open all usage insights' }))
    const roster = screen.getByRole('dialog', { name: 'Usage insights' })
    expect(roster).toHaveTextContent('Gemini')
    expect(roster).toHaveTextContent('Antigravity')
    expect(roster).toHaveTextContent('8gent')
    expect(roster).toHaveTextContent('OpenCode')
    expect(roster).toHaveTextContent('Quota not observed')
    expect(await screen.findByText('1.2k tokens · local 30d')).toBeInTheDocument()
    expect(roster).toHaveTextContent('Local tracking off')
    expect(roster).not.toHaveTextContent('System default')
    fireEvent.click(screen.getByRole('button', { name: /Usage details and history/ }))
    expect(useAppStore.getState().activeSection).toBe('WAREHOUSE')
    expect(screen.queryByRole('dialog', { name: 'Usage insights' })).not.toBeInTheDocument()
  })
  it('refreshes local histories and quota windows from the roster', async () => {
    vi.mocked(api.refreshRateLimits).mockResolvedValue(limits)
    render(<UsageStatusBar config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open all usage insights' }))
    await screen.findByText('1.2k tokens · local 30d')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh usage insights' }))
    await waitFor(() => expect(api.refreshUsage).toHaveBeenCalledWith(config, 'codex', true))
    expect(api.refreshRateLimits).toHaveBeenCalledWith(config)
  })
})
