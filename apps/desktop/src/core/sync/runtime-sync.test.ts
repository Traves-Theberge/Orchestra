import { describe, expect, it, vi } from 'vitest'
import type { BackendConfig } from '@core/api/client'
import { normalizeEventEnvelope, normalizeSnapshotPayload } from '@core/api/client'
import { startRuntimeSync } from '@core/sync/runtime-sync'

class FakeEventSource {
  listeners: Record<string, Array<(event: unknown) => void>> = {}
  onerror: ((event: Event) => void) | null = null
  closed = false

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(listener)
  }

  emit(type: string, data: string) {
    const handlers = this.listeners[type] ?? []
    for (const handler of handlers) {
      handler({ data })
    }
  }

  close() {
    this.closed = true
  }
}

const baseConfig: BackendConfig = {
  baseUrl: 'http://127.0.0.1:4000',
  apiToken: '',
}

const snapshot = normalizeSnapshotPayload({
  generated_at: '2026-03-06T00:00:00Z',
  counts: { running: 0, retrying: 0 },
  running: [],
  retrying: [],
  codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
  rate_limits: null,
})

describe('startRuntimeSync', () => {
  it('forwards AUTOMATION_RUN_UPDATED run payloads from the event envelope', () => {
    const sources: FakeEventSource[] = []
    const runs: Record<string, unknown>[] = []
    const sync = startRuntimeSync(
      baseConfig,
      { onSnapshot: () => {}, onTimelineEvent: () => {}, onStatus: () => {}, onError: () => {}, onAutomationRun: (run) => runs.push(run) },
      {
        fetchSnapshot: vi.fn().mockResolvedValue(snapshot),
        normalizeSnapshot: normalizeSnapshotPayload,
        normalizeEnvelope: normalizeEventEnvelope,
        createEventSource: () => { const source = new FakeEventSource(); sources.push(source); return source },
        setIntervalFn: () => 0,
        clearIntervalFn: () => {},
        setTimeoutFn: () => 0,
        clearTimeoutFn: () => {},
      },
    )
    sources[0]?.emit('AUTOMATION_RUN_UPDATED', JSON.stringify({ type: 'AUTOMATION_RUN_UPDATED', timestamp: 'now', data: { id: 'run-1', status: 'running' } }))
    expect(runs).toEqual([{ id: 'run-1', status: 'running' }])
    sync.stop()
  })

  it('passes bearer token as query param when SSE is used', async () => {
    vi.useFakeTimers()

    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot)
    const createdSources: FakeEventSource[] = []
    const createdUrls: string[] = []

    const sync = startRuntimeSync(
      { ...baseConfig, apiToken: 'secret' },
      {
        onSnapshot: () => {},
        onTimelineEvent: () => {},
        onStatus: () => {},
        onError: () => {},
      },
      {
        fetchSnapshot,
        normalizeSnapshot: normalizeSnapshotPayload,
        normalizeEnvelope: normalizeEventEnvelope,
        createEventSource: (url) => {
          const source = new FakeEventSource()
          createdSources.push(source)
          createdUrls.push(url)
          return source
        },
        setIntervalFn: (cb, ms) => setInterval(cb, ms) as unknown as number,
        clearIntervalFn: (id) => clearInterval(id),
        setTimeoutFn: (cb, ms) => setTimeout(cb, ms) as unknown as number,
        clearTimeoutFn: (id) => clearTimeout(id),
      },
    )

    await vi.runOnlyPendingTimersAsync()

    expect(createdSources).toHaveLength(1)
    expect(createdUrls[0]).toContain('token=secret')

    sync.stop()
    vi.useRealTimers()
  })

  it('reconnects stream after error and uses polling fallback', async () => {
    vi.useFakeTimers()

    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot)
    const statusMessages: string[] = []
    const sources: FakeEventSource[] = []
    const timeoutDelays: number[] = []

    const sync = startRuntimeSync(
      baseConfig,
      {
        onSnapshot: () => {},
        onTimelineEvent: () => {},
        onStatus: (message) => statusMessages.push(message),
        onError: () => {},
      },
      {
        fetchSnapshot,
        normalizeSnapshot: normalizeSnapshotPayload,
        normalizeEnvelope: normalizeEventEnvelope,
        createEventSource: (_url) => {
          const source = new FakeEventSource()
          sources.push(source)
          return source
        },
        setIntervalFn: (cb, ms) => setInterval(cb, ms) as unknown as number,
        clearIntervalFn: (id) => clearInterval(id),
        setTimeoutFn: (cb, ms) => {
          timeoutDelays.push(ms)
          return setTimeout(cb, ms) as unknown as number
        },
        clearTimeoutFn: (id) => clearTimeout(id),
      },
    )

    expect(sources).toHaveLength(1)

    sources[0]?.onerror?.(new Event('error'))

    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchSnapshot).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(sources).toHaveLength(2)
    expect(sources[0]?.closed).toBe(true)
    expect(timeoutDelays).toEqual([3000])
    expect(statusMessages.some((message) => message.includes('SSE disconnected'))).toBe(true)

    sync.stop()
    vi.useRealTimers()
  })

  it('applies exponential reconnect backoff and resets after open', async () => {
    vi.useFakeTimers()

    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot)
    const sources: FakeEventSource[] = []
    const timeoutDelays: number[] = []

    const sync = startRuntimeSync(
      baseConfig,
      {
        onSnapshot: () => {},
        onTimelineEvent: () => {},
        onStatus: () => {},
        onError: () => {},
      },
      {
        fetchSnapshot,
        normalizeSnapshot: normalizeSnapshotPayload,
        normalizeEnvelope: normalizeEventEnvelope,
        createEventSource: () => {
          const source = new FakeEventSource()
          sources.push(source)
          return source
        },
        setIntervalFn: (cb, ms) => setInterval(cb, ms) as unknown as number,
        clearIntervalFn: (id) => clearInterval(id),
        setTimeoutFn: (cb, ms) => {
          timeoutDelays.push(ms)
          return setTimeout(cb, ms) as unknown as number
        },
        clearTimeoutFn: (id) => clearTimeout(id),
      },
    )

    sources[0]?.onerror?.(new Event('error'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(sources).toHaveLength(2)

    sources[1]?.onerror?.(new Event('error'))
    await vi.advanceTimersByTimeAsync(6000)
    expect(sources).toHaveLength(3)

    sources[2]?.emit('open', '{}')

    sources[2]?.onerror?.(new Event('error'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(sources).toHaveLength(4)

    expect(timeoutDelays).toEqual([3000, 6000, 3000])

    sync.stop()
    vi.useRealTimers()
  })

  it('does not create duplicate polling loops across repeated stream errors', async () => {
    vi.useFakeTimers()

    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot)
    const sources: FakeEventSource[] = []
    const timeoutDelays: number[] = []
    const intervalHandles = new Map<number, ReturnType<typeof setInterval>>()
    let nextIntervalId = 1
    let createdIntervals = 0

    const sync = startRuntimeSync(
      baseConfig,
      {
        onSnapshot: () => {},
        onTimelineEvent: () => {},
        onStatus: () => {},
        onError: () => {},
      },
      {
        fetchSnapshot,
        normalizeSnapshot: normalizeSnapshotPayload,
        normalizeEnvelope: normalizeEventEnvelope,
        createEventSource: () => {
          const source = new FakeEventSource()
          sources.push(source)
          return source
        },
        setIntervalFn: (cb, ms) => {
          const id = nextIntervalId
          nextIntervalId += 1
          createdIntervals += 1
          intervalHandles.set(id, setInterval(cb, ms))
          return id
        },
        clearIntervalFn: (id) => {
          const handle = intervalHandles.get(id)
          if (handle) {
            clearInterval(handle)
            intervalHandles.delete(id)
          }
        },
        setTimeoutFn: (cb, ms) => {
          timeoutDelays.push(ms)
          return setTimeout(cb, ms) as unknown as number
        },
        clearTimeoutFn: (id) => clearTimeout(id),
      },
    )

    expect(sources).toHaveLength(1)

    sources[0]?.onerror?.(new Event('error'))
    sources[0]?.onerror?.(new Event('error'))

    expect(createdIntervals).toBe(1)
    expect(timeoutDelays).toEqual([3000])

    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchSnapshot).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(sources).toHaveLength(2)

    sources[1]?.emit('open', '{}')
    await vi.advanceTimersByTimeAsync(4000)
    // 3 calls: Initial + Poll during error + Open after reconnect
    expect(fetchSnapshot).toHaveBeenCalledTimes(3)

    sync.stop()
    vi.useRealTimers()
  })

  it('keeps timer and stream counts bounded during reconnect churn', async () => {
    vi.useFakeTimers()

    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot)
    const sources: FakeEventSource[] = []
    const intervalHandles = new Map<number, ReturnType<typeof setInterval>>()
    const timeoutHandles = new Map<number, ReturnType<typeof setTimeout>>()
    let nextIntervalId = 1
    let nextTimeoutId = 1
    let maxActiveIntervals = 0
    let maxActiveTimeouts = 0

    const sync = startRuntimeSync(
      baseConfig,
      {
        onSnapshot: () => {},
        onTimelineEvent: () => {},
        onStatus: () => {},
        onError: () => {},
      },
      {
        fetchSnapshot,
        normalizeSnapshot: normalizeSnapshotPayload,
        normalizeEnvelope: normalizeEventEnvelope,
        createEventSource: () => {
          const source = new FakeEventSource()
          sources.push(source)
          return source
        },
        setIntervalFn: (cb, ms) => {
          const id = nextIntervalId
          nextIntervalId += 1
          intervalHandles.set(id, setInterval(cb, ms))
          maxActiveIntervals = Math.max(maxActiveIntervals, intervalHandles.size)
          return id
        },
        clearIntervalFn: (id) => {
          const handle = intervalHandles.get(id)
          if (handle) {
            clearInterval(handle)
            intervalHandles.delete(id)
          }
        },
        setTimeoutFn: (cb, ms) => {
          const id = nextTimeoutId
          nextTimeoutId += 1
          const handle = setTimeout(() => {
            timeoutHandles.delete(id)
            cb()
          }, ms)
          timeoutHandles.set(id, handle)
          maxActiveTimeouts = Math.max(maxActiveTimeouts, timeoutHandles.size)
          return id
        },
        clearTimeoutFn: (id) => {
          const handle = timeoutHandles.get(id)
          if (handle) {
            clearTimeout(handle)
            timeoutHandles.delete(id)
          }
        },
      },
    )

    expect(sources).toHaveLength(1)

    for (let cycle = 0; cycle < 5; cycle += 1) {
      const activeSource = sources[sources.length - 1]
      activeSource?.onerror?.(new Event('error'))

      expect(intervalHandles.size).toBe(1)
      expect(timeoutHandles.size).toBe(1)

      await vi.advanceTimersByTimeAsync(3000)
      expect(sources).toHaveLength(cycle + 2)

      const nextSource = sources[sources.length - 1]
      nextSource?.emit('open', '{}')

      await vi.advanceTimersByTimeAsync(2500)
      expect(intervalHandles.size).toBe(0)
      expect(timeoutHandles.size).toBe(0)
    }

    expect(maxActiveIntervals).toBe(1)
    expect(maxActiveTimeouts).toBe(1)
    expect(fetchSnapshot).toHaveBeenCalledTimes(11)

    sync.stop()
    vi.useRealTimers()
  })

  it('cancels pending reconnect work on stop', async () => {
    vi.useFakeTimers()

    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot)
    const sources: FakeEventSource[] = []
    const timeoutHandles = new Map<number, ReturnType<typeof setTimeout>>()
    let nextTimeoutId = 1

    const sync = startRuntimeSync(
      baseConfig,
      {
        onSnapshot: () => {},
        onTimelineEvent: () => {},
        onStatus: () => {},
        onError: () => {},
      },
      {
        fetchSnapshot,
        normalizeSnapshot: normalizeSnapshotPayload,
        normalizeEnvelope: normalizeEventEnvelope,
        createEventSource: () => {
          const source = new FakeEventSource()
          sources.push(source)
          return source
        },
        setIntervalFn: (cb, ms) => setInterval(cb, ms) as unknown as number,
        clearIntervalFn: (id) => clearInterval(id),
        setTimeoutFn: (cb, ms) => {
          const id = nextTimeoutId
          nextTimeoutId += 1
          const handle = setTimeout(() => {
            timeoutHandles.delete(id)
            cb()
          }, ms)
          timeoutHandles.set(id, handle)
          return id
        },
        clearTimeoutFn: (id) => {
          const handle = timeoutHandles.get(id)
          if (handle) {
            clearTimeout(handle)
            timeoutHandles.delete(id)
          }
        },
      },
    )

    expect(sources).toHaveLength(1)
    sources[0]?.onerror?.(new Event('error'))
    expect(timeoutHandles.size).toBe(1)

    sync.stop()
    await vi.advanceTimersByTimeAsync(10000)

    expect(timeoutHandles.size).toBe(0)
    expect(sources).toHaveLength(1)

    vi.useRealTimers()
  })
})
