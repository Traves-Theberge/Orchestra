import type { BackendConfig } from '@core/api/client'
import type { EventEnvelope, SnapshotPayload } from '@core/api/types'

/** Minimal interface for an EventSource-compatible stream connection. */
type EventSourceLike = {
  addEventListener: (type: string, listener: (event: unknown) => void) => void
  close: () => void
  onerror: ((event: Event) => void) | null
}

/** Callback handlers invoked by the runtime sync loop. */
type RuntimeSyncHandlers = {
  /** Called when a full runtime snapshot is received or refreshed. */
  onSnapshot: (snapshot: SnapshotPayload) => void
  /** Called when an individual SSE lifecycle event arrives. */
  onTimelineEvent: (eventType: string, envelope: EventEnvelope) => void
  /** Called with informational status messages (e.g. "SSE Live"). */
  onStatus: (message: string) => void
  /** Called when an error occurs during sync. */
  onError: (message: string) => void
  /** Called when a GitHub connection or disconnection event is received. */
  onGitHubChange?: (eventType: string, projectId: string) => void
  /** Called with the run payload of an AUTOMATION_RUN_UPDATED event. */
  onAutomationRun?: (run: Record<string, unknown>) => void
}

/**
 * Injectable dependencies for the runtime sync loop, enabling testability
 * by allowing replacement of fetch, timers, and EventSource.
 */
type RuntimeSyncDeps = {
  /** Fetches a full snapshot from the backend. */
  fetchSnapshot: (config: BackendConfig) => Promise<SnapshotPayload>
  /** Normalizes raw snapshot data into a typed payload. */
  normalizeSnapshot: (value: unknown) => SnapshotPayload
  /** Normalizes raw event data into a typed envelope. */
  normalizeEnvelope: (value: unknown, fallbackType: string) => EventEnvelope
  /** Creates an EventSource connection to the given URL. */
  createEventSource: (url: string) => EventSourceLike
  /** setInterval replacement for dependency injection. */
  setIntervalFn: (cb: () => void, ms: number) => number
  /** clearInterval replacement for dependency injection. */
  clearIntervalFn: (id: number) => void
  /** setTimeout replacement for dependency injection. */
  setTimeoutFn: (cb: () => void, ms: number) => number
  /** clearTimeout replacement for dependency injection. */
  clearTimeoutFn: (id: number) => void
}

/** SSE event types that represent orchestrator lifecycle transitions. */
const lifecycleEventTypes = [
  'RUN_EVENT',
  'RUN_STARTED',
  'RUN_FAILED',
  'RUN_CONTINUES',
  'RUN_SUCCEEDED',
  'RETRY_SCHEDULED',
  'HOOK_STARTED',
  'HOOK_COMPLETED',
  'HOOK_FAILED',
]

/**
 * Computes an exponential backoff delay for SSE reconnection attempts.
 * @param attempt - The reconnection attempt number (1-based).
 * @returns Delay in milliseconds, capped at 30 seconds.
 */
function reconnectDelayMs(attempt: number): number {
  const base = 3000
  const max = 30000
  return Math.min(base * Math.pow(2, Math.max(0, attempt - 1)), max)
}

/**
 * Starts a real-time sync connection to the backend using SSE with automatic
 * reconnection and polling fallback. Returns controls to stop the sync or
 * manually toggle snapshot polling.
 */
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
    if (!config.baseUrl || config.baseUrl.trim() === '') {
      handlers.onError('SSE disabled: invalid base URL.')
      startPolling()
      return
    }

    try {
      const sseUrl = new URL('/api/v1/events', config.baseUrl)
      if (config.apiToken && config.apiToken.trim() !== '') {
        sseUrl.searchParams.set('token', config.apiToken.trim())
      }
      stream = deps.createEventSource(sseUrl.toString())
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
        if (eventType === 'RETRY_SCHEDULED') {
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

    // GitHub connection/disconnection events trigger a project list refresh.
    for (const ghEventType of ['GITHUB_CONNECTED', 'GITHUB_DISCONNECTED']) {
      stream.addEventListener(ghEventType, (event) => {
        try {
          const dataText = (event as { data?: string }).data ?? ''
          const parsed = dataText ? JSON.parse(dataText) as Record<string, unknown> : {}
          const projectId = (parsed.project_id as string) || ''
          if (handlers.onGitHubChange) {
            handlers.onGitHubChange(ghEventType, projectId)
          }
        } catch {
          if (handlers.onGitHubChange) {
            handlers.onGitHubChange(ghEventType, '')
          }
        }
      })
    }

    stream.addEventListener('AUTOMATION_RUN_UPDATED', (event) => {
      if (!handlers.onAutomationRun) return
      try {
        const dataText = (event as { data?: string }).data ?? ''
        const parsed = dataText ? JSON.parse(dataText) as Record<string, unknown> : {}
        // The backend wraps payloads in an event envelope ({ type, timestamp, data }).
        const run = parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
          ? parsed.data as Record<string, unknown>
          : parsed
        handlers.onAutomationRun(run)
      } catch {
        handlers.onAutomationRun({})
      }
    })

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
