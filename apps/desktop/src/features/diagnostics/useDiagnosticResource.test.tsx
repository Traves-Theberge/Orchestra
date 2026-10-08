import { act, renderHook, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDiagnosticResource } from './useDiagnosticResource'
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
describe('diagnostics polling', () => {
  it('aborts reads on scope changes and unmount', async () => {
    const signals: AbortSignal[] = []
    const fetcher = vi.fn((signal: AbortSignal) => { signals.push(signal); return new Promise<string>(() => {}) })
    const hook = renderHook(({ scope }) => useDiagnosticResource(scope, fetcher, true), { initialProps: { scope: 'old' } })
    expect(signals[0].aborted).toBe(false)
    hook.rerender({ scope: 'new' })
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    hook.unmount()
    expect(signals[1].aborted).toBe(true)
  })
  it('keeps current evidence on pause and cancels pending polling on unmount', async () => {
    const fetcher = vi.fn().mockResolvedValue({ count: 42 })
    const hook = renderHook(({ live }) => useDiagnosticResource('scope', fetcher, true, live), { initialProps: { live: true } })
    await waitFor(() => expect(hook.result.current.data).toEqual({ count: 42 }))
    hook.rerender({ live: false })
    expect(hook.result.current.data).toEqual({ count: 42 })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    vi.useFakeTimers(); const calls = fetcher.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(fetcher).toHaveBeenCalledTimes(calls)
    hook.unmount()
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(fetcher).toHaveBeenCalledTimes(calls)
  })
  it('never polls while the document is hidden and refreshes on visibility', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const fetcher = vi.fn().mockResolvedValue('fresh')
    const hook = renderHook(() => useDiagnosticResource('scope', fetcher, true))
    expect(fetcher).not.toHaveBeenCalled()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(hook.result.current.data).toBe('fresh'))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
