import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@core/api/client'
import { UsageStatusBar } from './UsageStatusBar'

vi.mock('@core/api/client', () => ({ fetchRateLimits: vi.fn(), refreshRateLimits: vi.fn() }))
vi.mock('@ui/tooltip-wrapper', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture-a' }
const other = { baseUrl: 'http://localhost:4015', apiToken: 'fixture-b' }
const limits: api.RateLimitState = { codex: { provider: 'codex', status: 'ok', updated_at: 1, session: { used_percent: 10, window_minutes: 300 } } }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.mocked(api.fetchRateLimits).mockResolvedValue(limits)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('UsageStatusBar', () => {
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
})
