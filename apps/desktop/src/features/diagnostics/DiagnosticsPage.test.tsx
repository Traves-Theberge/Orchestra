import { fireEvent, render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticsPage } from './DiagnosticsPage'
import { TaskTimeline } from './TaskTimeline'
import { requestJSON } from '@core/api/client'
vi.mock('@core/api/client', () => ({ requestJSON: vi.fn() }))
vi.mock('./EvilChartsMetrics', () => ({ EvilChartsMetrics: () => <div>Metrics chart</div> }))
const config = { baseUrl: 'http://localhost', apiToken: '' }
const settings = { enabled: false, retention_days: 7, metrics_retention_days: 30, max_storage_mb: 250 }
afterEach(() => { cleanup(); vi.resetAllMocks() })
describe('Diagnostics', () => {
  it('applies a bounded time preset and clears all filters together', async () => {
    vi.mocked(requestJSON).mockResolvedValue({ settings, points: [], operations: [], usage: [], features: [], runtime: {} })
    render(<DiagnosticsPage config={config} />)
    fireEvent.change(screen.getByLabelText('Project filter'), { target: { value: 'project-1' } })
    fireEvent.change(screen.getByLabelText('Time range'), { target: { value: '60' } })
    await waitFor(() => expect(vi.mocked(requestJSON).mock.calls.some(([, path]) => path.includes('since=') && path.includes('until=') && path.includes('project_id=project-1'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByLabelText('Project filter')).toHaveValue('')
    expect(screen.getByLabelText('Time range')).toHaveValue('all')
    await waitFor(() => expect(vi.mocked(requestJSON).mock.lastCall?.[1]).toBe('/api/v1/diagnostics/overview'))
  })
  it('displays descriptive HTTP evidence returned by the backend', async () => {
    vi.mocked(requestJSON).mockImplementation(async (_config, path) => path.includes('/overview') ? { settings, points: [], operations: [], usage: [], features: [], runtime: {} } : { items: [{ id: 1, timestamp: '2026-10-08T06:12:26Z', severity: 'info', name: 'http.completed', label: 'Read application state', description: 'The backend returned current application state.', http_method: 'GET', http_route: '/api/v1/state', http_status_code: 200, duration_ms: 24.2, trace_id: 'trace-http', span_id: 'span-http' }], total: 1, limit: 100, offset: 0 })
    render(<DiagnosticsPage config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    expect(await screen.findByText('Read application state')).toBeInTheDocument()
    expect(screen.getByText('The backend returned current application state.')).toBeInTheDocument()
    expect(screen.getByText(/GET \/api\/v1\/state.*HTTP 200.*24.2 ms/)).toBeInTheDocument()
  })
  it('labels unscoped HTTP logs as API activity and keeps correlation IDs in details', async () => {
    vi.mocked(requestJSON).mockImplementation(async (_config, path) => path.includes('/overview') ? { settings, points: [], operations: [], usage: [], features: [], runtime: {} } : { items: [{ id: 1, timestamp: '2026-10-08T06:12:26Z', severity: 'info', name: 'http.completed', trace_id: 'trace-http', span_id: 'span-http' }], total: 1, limit: 100, offset: 0 })
    render(<DiagnosticsPage config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    expect(await screen.findByText('API activity')).toBeInTheDocument()
    expect(screen.queryByText(/Task unavailable/)).toBeNull()
    const details = screen.getByText('Technical details').closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent('trace-http')
    expect(details).toHaveTextContent('span-http')
  })
  it('shows disconnected backend and does not request data', () => {
    render(<DiagnosticsPage config={null} />)
    expect(screen.getByText(/connect a backend/i)).toBeInTheDocument()
    expect(requestJSON).not.toHaveBeenCalled()
  })
  it('provides all views, disabled state and filters', async () => {
    vi.mocked(requestJSON).mockImplementation(async (_config, path) => path.includes('/settings') ? settings : path.includes('/overview') ? { settings, total_traces: 0, failed_traces: 0, active_traces: 0, dropped_records: 0, points: [], operations: [], usage: [], features: [], runtime: {} } : { items: [], total: 0, limit: 100, offset: 0 })
    render(<DiagnosticsPage config={config} />)
    await screen.findByText(/collection disabled/i)
    for (const label of ['Overview', 'Runs', 'Logs', 'Usage', 'Settings']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
    fireEvent.change(screen.getByLabelText('Project filter'), { target: { value: 'project-1' } })
    await waitFor(() => expect(vi.mocked(requestJSON).mock.calls.some(([, path]) => path.includes('project_id=project-1'))).toBe(true))
    expect(await screen.findByText(/no matching runs/i)).toBeInTheDocument()
  })
  it('shows errors and scopes task timeline queries to exact task and project', async () => {
    vi.mocked(requestJSON).mockRejectedValue(new Error('store unavailable'))
    render(<TaskTimeline config={config} taskId="task/1" projectId="project-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('store unavailable')
    expect(vi.mocked(requestJSON).mock.calls.some(([, path]) => path.includes('task_id=task%2F1') && path.includes('project_id=project-1'))).toBe(true)
  })
  it('discards results from an old backend after a profile change', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    vi.mocked(requestJSON).mockImplementation((cfg) => cfg.baseUrl === 'http://localhost' ? new Promise(resolve => { resolveOld = resolve }) : Promise.reject(new Error('new backend disconnected')))
    const view = render(<DiagnosticsPage config={config} />)
    view.rerender(<DiagnosticsPage config={{ ...config, baseUrl: 'http://new' }} />)
    await screen.findByText(/new backend disconnected/i)
    resolveOld({ settings, total_traces: 999, points: [], operations: [], usage: [], features: [], runtime: {} })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText('999')).toBeNull()
  })
  it('refreshes paused run lists and selected trace details together', async () => {
    let generation = 0
    const run = { trace_id: 'trace-1', span_id: 'root', parent_span_id: '', name: 'Run', start_time: '2026-10-07T00:00:00Z', duration_ms: 10, status: 'ok', provider: '', model: '', attempt: 0, project_id: '', task_id: '', run_id: '', session_id: '', span_count: 1 }
    vi.mocked(requestJSON).mockImplementation(async (_config, path) => path.includes('/overview') ? { settings, points: [], operations: [], usage: [], features: [], runtime: {} } : path.includes('/traces/trace-1') ? { trace: run, spans: [{ ...run, name: 'Operation ' + generation }], logs: [], partial: false } : { items: [{ ...run, name: 'Run ' + generation }], total: 1, limit: 100, offset: 0 })
    render(<DiagnosticsPage config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause live updates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect run Run 0 trace-1' }))
    await screen.findByRole('button', { name: 'Select Operation 0 span' })
    generation = 1
    fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnostics' }))
    await screen.findByRole('button', { name: 'Inspect run Run 1 trace-1' })
    await screen.findByRole('button', { name: 'Select Operation 1 span' })
  })
  it('refreshes paused logs and displays provider model usage', async () => {
    let generation = 0
    vi.mocked(requestJSON).mockImplementation(async (_config, path) => path.includes('/overview') ? { settings, points: [], operations: [], usage: [{ provider: 'codex', model: 'observed-model', input_tokens: 10, output_tokens: 20, known_runs: 1 }], features: [], runtime: {} } : { items: [{ id: 1, timestamp: '2026-10-07', severity: 'info', name: 'event-' + generation, trace_id: '', span_id: '' }], total: 1, limit: 100, offset: 0 })
    render(<DiagnosticsPage config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Usage' }))
    await screen.findByText('observed-model')
    fireEvent.click(screen.getByRole('button', { name: 'Pause live updates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    await screen.findByText(/event-0/)
    generation = 1
    fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnostics' }))
    await screen.findByText(/event-1/)
  })
  it('filters severity on the backend before log pagination', async () => {
    vi.mocked(requestJSON).mockImplementation(async (_config, path) => path.includes('/overview') ? { settings, points: [], operations: [], usage: [], features: [], runtime: {} } : { items: [], total: 0, limit: 100, offset: 0 })
    render(<DiagnosticsPage config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    fireEvent.change(screen.getByLabelText('Log severity filter'), { target: { value: 'error' } })
    await waitFor(() => expect(vi.mocked(requestJSON).mock.calls.some(([, path]) => path.includes('/logs?') && path.includes('severity=error') && path.includes('offset=0'))).toBe(true))
  })
  it('preserves filters while inactive and stops hidden section requests', async () => {
    vi.mocked(requestJSON).mockImplementation(async (_config, path) => path.includes('/overview') ? { settings, points: [], operations: [], usage: [], features: [], runtime: {} } : { items: [], total: 0, limit: 100, offset: 0 })
    const view = render(<DiagnosticsPage config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
    fireEvent.change(screen.getByLabelText('Project filter'), { target: { value: 'saved-project' } })
    await screen.findByText(/no matching runs/i)
    view.rerender(<DiagnosticsPage config={config} active={false} />)
    const calls = vi.mocked(requestJSON).mock.calls.length
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(requestJSON).toHaveBeenCalledTimes(calls)
    view.rerender(<DiagnosticsPage config={config} active />)
    expect(screen.getByLabelText('Project filter')).toHaveValue('saved-project')
    expect(screen.getByRole('button', { name: 'Runs' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('validates retention bounds and requires deliberate confirmation before clearing', async () => {
    vi.mocked(requestJSON).mockImplementation(async (_config, path) => path.includes('/settings') ? settings : path.includes('/overview') ? { settings, points: [], operations: [], usage: [], features: [], runtime: {} } : {})
    render(<DiagnosticsPage config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const clear = await screen.findByRole('button', { name: 'Clear diagnostic history' })
    expect(clear).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Metric retention (days)'), { target: { value: '6' } })
    expect(screen.getByRole('button', { name: 'Save diagnostics settings' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Metric retention (days)'), { target: { value: '3650' } })
    expect(screen.getByRole('button', { name: 'Save diagnostics settings' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Confirm clear diagnostic history'), { target: { value: 'CLEAR' } })
    fireEvent.click(clear)
    await waitFor(() => expect(requestJSON).toHaveBeenCalledWith(config, '/api/v1/diagnostics/history', { method: 'DELETE' }))
    await screen.findByText('Diagnostic history cleared.')
  })
})
