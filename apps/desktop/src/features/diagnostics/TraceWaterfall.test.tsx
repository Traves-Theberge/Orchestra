import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildWaterfall, TraceWaterfall } from './TraceWaterfall'
import type { DiagnosticSpan, TraceDetail } from './api'

const span = (id: string, parent = '', start = 0, duration = 100, attempt = 0): DiagnosticSpan => ({ trace_id: 'trace', span_id: id, parent_span_id: parent, name: id, start_time: new Date(start).toISOString(), end_time: new Date(start + duration).toISOString(), duration_ms: duration, status: 'ok', project_id: 'project', task_id: 'task', run_id: '', session_id: '', provider: '', model: '', attempt })
describe('diagnostic waterfall', () => {
  it('finds a nested operation while retaining its ancestor path and removes unrelated work', () => {
    const root = span('root'); const child = span('provider.tool', 'root'); const other = span('unrelated', 'root')
    render(<TraceWaterfall detail={{ trace: { ...root, span_count: 3 }, spans: [root, child, other], logs: [], partial: false }} />)
    fireEvent.change(screen.getByLabelText('Find operation'), { target: { value: 'provider.tool' } })
    expect(screen.getByRole('button', { name: 'Select root span' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select provider.tool span' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select unrelated span' })).toBeNull()
  })
  it('shows recorded HTTP evidence without unrelated provider or token fields', () => {
    const request = { ...span('http'), name: 'http.request', http_method: 'GET', http_route: '/api/v1/state', http_status_code: 200 }
    render(<TraceWaterfall detail={{ trace: { ...request, span_count: 1 }, spans: [request], logs: [], partial: false }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select http.request span' }))
    const details = screen.getByTestId('span-details')
    expect(details).toHaveTextContent('/api/v1/state')
    expect(details).toHaveTextContent('200')
    expect(details).not.toHaveTextContent('Input tokens')
    expect(details).not.toHaveTextContent('Provider')
  })
  it('preserves nested concurrent work and retries on a shared time axis', () => {
    const rows = buildWaterfall([span('root'), span('a', 'root', 10, 60, 1), span('b', 'root', 20, 50, 2)])
    expect(rows.map(row => [row.span.span_id, row.depth, row.offsetMs])).toEqual([['root', 0, 0], ['a', 1, 10], ['b', 1, 20]])
    expect(rows[1].durationMs).toBe(60)
  })
  it('renders every orphan and cyclic span once with an explicit warning', () => {
    const rows = buildWaterfall([span('orphan', 'missing'), span('a', 'b'), span('b', 'a')])
    expect(new Set(rows.map(row => row.span.span_id)).size).toBe(3)
    expect(rows.find(row => row.span.span_id === 'orphan')?.warning).toMatch(/parent/i)
    expect(rows.some(row => /cycle/i.test(row.warning ?? ''))).toBe(true)
  })
  it('keeps all ancestors for collapse beyond the indentation cap', () => {
    const spans = Array.from({ length: 80 }, (_, index) => span('node-' + index, index ? 'node-' + (index - 1) : ''))
    render(<TraceWaterfall detail={{ trace: { ...spans[0], span_count: 80 }, spans, logs: [], partial: false }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse node-0' }))
    expect(screen.queryByRole('button', { name: 'Select node-79 span' })).toBeNull()
    expect(buildWaterfall(spans)[79].depth).toBeLessThanOrEqual(64)
  })
  it('shows the same elapsed duration in running bars and details', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2500)
    const running = { ...span('running'), status: 'running', end_time: undefined, duration_ms: 0 }
    render(<TraceWaterfall detail={{ trace: { ...running, span_count: 1 }, spans: [running], logs: [], partial: false }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select running span' }))
    expect(screen.getByTestId('span-bar-running')).toHaveTextContent('2500 ms')
    expect(screen.getByTestId('span-details')).toHaveTextContent('2500.0 ms (in progress)')
    vi.restoreAllMocks()
  })
  it('collapses children, supports zoom, and links selected span logs without inventing usage', () => {
    const root = span('root'); const child = span('child', 'root', 10, 30, 2)
    const detail: TraceDetail = { trace: { ...root, span_count: 2 }, spans: [root, child], partial: true, logs: [{ id: 'log', trace_id: 'trace', span_id: 'child', timestamp: child.start_time, name: 'tool.failed', severity: 'error' }] }
    render(<TraceWaterfall detail={detail} />)
    expect(screen.getByText(/partial trace/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /select child/i }))
    expect(screen.getByTestId('span-details')).toHaveTextContent('tool.failed')
    expect(screen.getByTestId('span-details')).toHaveTextContent('Unknown')
    fireEvent.click(screen.getByRole('button', { name: /collapse root/i }))
    expect(screen.queryByRole('button', { name: /select child/i })).toBeNull()
    fireEvent.change(screen.getByLabelText('Timeline zoom'), { target: { value: '2' } })
    expect(screen.getByLabelText('Timeline zoom')).toHaveValue('2')
  })
})
