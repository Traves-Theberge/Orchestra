import type { BackendConfig } from '@/lib/orchestra-client'
import type { EventEnvelope, SnapshotPayload } from '@/lib/orchestra-types'

type EventSourceLike = {
  addEventListener: (type: string, listener: (event: unknown) => void) => void
  close: () => void
  onerror: ((event: Event) => void) | null
}

type RuntimeSyncHandlers = {
  onSnapshot: (snapshot: SnapshotPayload) => void
  onTimelineEvent: (eventType: string, envelope: EventEnvelope) => void
  onStatus: (message: string) => void
  onError: (message: string) => void
}

type RuntimeSyncDeps = {
  fetchSnapshot: (config: BackendConfig) => Promise<SnapshotPayload>
  normalizeSnapshot: (value: unknown) => SnapshotPayload
  normalizeEnvelope: (value: unknown, fallbackType: string) => EventEnvelope
  createEventSource: (url: string) => EventSourceLike
  setIntervalFn: (cb: () => void, ms: number) => number
  clearIntervalFn: (id: number) => void
  setTimeoutFn: (cb: () => void, ms: number) => number
  clearTimeoutFn: (id: number) => void
}

const lifecycleEventTypes = [
  'run_event',
  'run_started',
  'run_failed',
  'run_continues',
  'run_succeeded',
  'retry_scheduled',
  'hook_started',
  'hook_completed',
  'hook_failed',
]

function reconnectDelayMs(attempt: number): number {
  const base = 3000
  const max = 30000
  return Math.min(base * Math.pow(2, Math.max(0, attempt - 1)), max)
}

export function startRuntimeSync(config: BackendConfig, handlers: RuntimeSyncHandlers, deps: RuntimeSyncDeps): { stop: () => void; startPolling: () => void; stopPolling: () => void } {
  let closed = false
  let stream: EventSourceLike | null = null
  let reconnectTimer: number | null = null
  let pollTimer: number | null = null
  let reconnectAttempt = 0

  const loadSnapshot = async () => {
    try {
      const snapshot = await deps.fetchSnapshot(config)
      if (!closed) {
        handlers.onSnapshot(snapshot)
      }
    } catch (error) {
      if (!closed) {
        const text = error instanceof Error ? error.message : 'unexpected error'
        handlers.onError(`state load failed: ${text}`)
      }
    }
  }

  const stopPolling = () => {
    if (pollTimer != null) {
      deps.clearIntervalFn(pollTimer)
      pollTimer = null
    }
  }

  const startPolling = () => {
    if (pollTimer != null) {
      return
    }
    pollTimer = deps.setIntervalFn(() => {
      void loadSnapshot()
    }, 2000)
  }

  const attachStream = () => {
    if (config.apiToken && config.apiToken.trim() !== '') {
      handlers.onStatus('SSE disabled while bearer token is set (polling mode)')
      startPolling()
      return
    }

    if (!config.baseUrl || config.baseUrl.trim() === '') {
      handlers.onError('SSE disabled: invalid base URL.')
      startPolling()
      return
    }

    try {
      stream = deps.createEventSource(new URL('/api/v1/events', config.baseUrl).toString())
    } catch (e) {
      handlers.onError(`SSE disabled: failed to create EventSource: ${e instanceof Error ? e.message : 'unknown error'}`)
      startPolling()
      return
    }

    const seenEventKeys = new Set<string>()

    stream.addEventListener('open', () => {
      const wasReconnecting = reconnectAttempt > 0
      reconnectAttempt = 0
      stopPolling()
      handlers.onStatus('SSE Live')
      // Spec 5.1: Refetch full state on reconnect to ensure consistency after a disconnect span.
      if (wasReconnecting) {
        void loadSnapshot()
      }
    })

    stream.addEventListener('snapshot', (event) => {
      try {
        const parsed = deps.normalizeSnapshot((event as { data?: string }).data ? JSON.parse((event as { data: string }).data) : null)
        handlers.onSnapshot(parsed)
      } catch {
        handlers.onError('failed to parse snapshot event')
      }
    })

    const pushEnvelope = (eventType: string, dataText: string) => {
      try {
        const parsed = deps.normalizeEnvelope(JSON.parse(dataText), eventType)

        // Spec 5.3: Deduplicate retry events by (issue_id, attempt, error) identity.
        if (eventType === 'retry_scheduled') {
          const issueId = (parsed.data.issue_id as string) || ''
          const attempt = (parsed.data.attempt as number) || 0
          const error = (parsed.data.error as string) || ''
          const key = `${issueId}-${attempt}-${error}`
          if (seenEventKeys.has(key)) {
            return
          }
          seenEventKeys.add(key)
        }

        handlers.onTimelineEvent(eventType, parsed)
      } catch {
        handlers.onTimelineEvent(eventType, {
          type: eventType,
          timestamp: new Date().toISOString(),
          data: { raw: dataText },
        })
      }
    }

    for (const eventType of lifecycleEventTypes) {
      stream.addEventListener(eventType, (event) => {
        pushEnvelope(eventType, (event as { data?: string }).data ?? '')
      })
    }

    stream.onerror = () => {
      handlers.onStatus('SSE disconnected (polling fallback)')
      startPolling()
      if (stream) {
        stream.close()
        stream = null
      }
      if (reconnectTimer == null) {
        reconnectAttempt += 1
        const delayMs = reconnectDelayMs(reconnectAttempt)
        reconnectTimer = deps.setTimeoutFn(() => {
          reconnectTimer = null
          attachStream()
        }, delayMs)
      }
    }
  }

  void loadSnapshot()
  attachStream()

  return {
    stop: () => {
      closed = true
      if (stream) {
        stream.close()
      }
      if (reconnectTimer != null) {
        deps.clearTimeoutFn(reconnectTimer)
      }
      stopPolling()
    },
    startPolling,
    stopPolling,
  }
}
