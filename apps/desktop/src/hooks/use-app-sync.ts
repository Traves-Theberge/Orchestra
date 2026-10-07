import { useEffect, useRef } from 'react'
import {
  fetchIssues,
  fetchProjects,
  fetchState,
  isUnauthorizedError,
  normalizeEventEnvelope,
  normalizeSnapshotPayload,
  postRefresh,
  toDisplayError,
  type BackendConfig,
} from '@core/api/client'
import { startRuntimeSync } from '@core/sync/runtime-sync'
import { applySnapshotUpdate } from '@core/sync/runtime-store'
import { useAppStore } from '@core/store'
import { handleAutomationRunEvent } from '@features/automations/lib/run-events'

interface UseAppSyncOpts {
  issueLookupId: string
  executeIssueLookup: (id: string) => Promise<void>
  playNotification: (id: string) => void
  /** OS notification + sound with custom text (automation runs). */
  notify?: (title: string, body: string) => void
  setErrorMessage: (message: string) => void
}

interface UseAppSyncResult {
  handleRefresh: () => Promise<void>
  handleTogglePolling: () => void
  generatedAt: string
}

/**
 * Manages the runtime SSE/polling sync loop, board refresh, and polling toggle.
 * Uses refs for volatile callbacks so the effect only re-runs when config changes.
 */
export function useAppSync(
  config: BackendConfig | null,
  opts: UseAppSyncOpts,
): UseAppSyncResult {
  const syncControls = useRef<{ startPolling: () => void; stopPolling: () => void } | null>(null)
  const lastIssueFetchRef = useRef(0)

  // Keep mutable refs so the SSE callbacks always see the latest values without
  // adding them to the effect dependency array (avoids stale closures).
  const issueLookupIdRef = useRef(opts.issueLookupId)
  const executeIssueLookupRef = useRef(opts.executeIssueLookup)
  const playNotificationRef = useRef(opts.playNotification)
  const notifyRef = useRef(opts.notify)
  const setErrorMessageRef = useRef(opts.setErrorMessage)

  // Update refs every render
  issueLookupIdRef.current = opts.issueLookupId
  executeIssueLookupRef.current = opts.executeIssueLookup
  playNotificationRef.current = opts.playNotification
  notifyRef.current = opts.notify
  setErrorMessageRef.current = opts.setErrorMessage

  // Main SSE/polling sync effect — only re-runs when config changes
  useEffect(() => {
    if (!config) return

    const sync = startRuntimeSync(
      config,
      {
        onSnapshot: (next) => {
          const store = useAppStore.getState()
          store.setSnapshot(applySnapshotUpdate(store.snapshot, next))
          store.setLoadingState(false)
          setErrorMessageRef.current('')
          // Fetch board issues (throttled to once per 10 s)
          const now = Date.now()
          if (now - lastIssueFetchRef.current > 10000) {
            lastIssueFetchRef.current = now
            fetchIssues(config).then(issues => useAppStore.getState().setBoardIssues(issues)).catch(() => {})
            const currentId = issueLookupIdRef.current
            // GitHub backlog issues (GH-*) live only on the client, so the backend
            // would 404; and nothing needs refreshing while the inspector is closed.
            if (currentId && !currentId.startsWith('GH-') && useAppStore.getState().inspectDialogOpen) {
              void executeIssueLookupRef.current(currentId)
            }
          }
        },
        onTimelineEvent: (eventType, envelope) => {
          useAppStore.getState().addTimelineEvent({ type: envelope.type, at: envelope.timestamp, data: envelope.data })
          if (eventType === 'RUN_SUCCEEDED') {
            const issueIdentifier = (envelope.data.issue_identifier as string) || ''
            fetchIssues(config).then((issues) => {
              useAppStore.getState().setBoardIssues(issues)
              const issue = issues.find(i => (i.identifier || i.issue_identifier) === issueIdentifier)
              if (issue && issue.state === 'Review') {
                playNotificationRef.current(issueIdentifier)
              }
            }).catch(() => {})
            lastIssueFetchRef.current = Date.now()
            if (issueIdentifier) {
              void executeIssueLookupRef.current(issueIdentifier)
            }
          }
        },
        onStatus: (message) => {
          useAppStore.getState().setStatusMessage(message)
        },
        onError: (message) => {
          setErrorMessageRef.current(message)
          if (isUnauthorizedError(message) || message.includes('unauthorized:')) {
            useAppStore.getState().setStatusMessage('Protected host detected. Add bearer token in Settings -> Backend Configuration.')
          }
          useAppStore.getState().setLoadingState(false)
        },
        onAutomationRun: (run) => {
          handleAutomationRunEvent(run, (title, body) => notifyRef.current?.(title, body))
        },
        onGitHubChange: (_eventType, _projectId) => {
          fetchProjects(config).then(projs => useAppStore.getState().setProjects(projs)).catch(() => {})
        },
      },
      {
        fetchSnapshot: fetchState,
        normalizeSnapshot: normalizeSnapshotPayload,
        normalizeEnvelope: normalizeEventEnvelope,
        createEventSource: (url) => new EventSource(url),
        setIntervalFn: (cb, ms) => window.setInterval(cb, ms),
        clearIntervalFn: (id) => window.clearInterval(id),
        setTimeoutFn: (cb, ms) => window.setTimeout(cb, ms),
        clearTimeoutFn: (id) => window.clearTimeout(id),
      },
    )

    syncControls.current = { startPolling: sync.startPolling, stopPolling: sync.stopPolling }

    return () => {
      sync.stop()
      syncControls.current = null
    }
  }, [config])

  // Listen for data mutations from the embedded agent
  useEffect(() => {
    if (!config) return
    const handler = () => {
      fetchIssues(config).then(issues => useAppStore.getState().setBoardIssues(issues)).catch(() => {})
    }
    window.addEventListener('orchestra-data-changed', handler)
    return () => window.removeEventListener('orchestra-data-changed', handler)
  }, [config])

  const handleRefresh = async () => {
    if (!config) return
    const store = useAppStore.getState()
    store.setRefreshPending(true)
    store.setStatusMessage('')
    setErrorMessageRef.current('')
    try {
      await postRefresh(config)
      const [updatedIssues, updatedProjects] = await Promise.all([
        fetchIssues(config),
        fetchProjects(config),
      ])
      store.setBoardIssues(updatedIssues)
      store.setProjects(updatedProjects)
      store.setGithubBacklogIssues([])
      store.setStatusMessage('Refresh queued successfully.')
    } catch (err) {
      const message = toDisplayError(err)
      setErrorMessageRef.current(`refresh failed: ${message}`)
      if (isUnauthorizedError(err) || message.startsWith('unauthorized:')) {
        store.setStatusMessage('Protected host detected. Add bearer token in Settings -> Backend Configuration.')
      }
    } finally {
      store.setRefreshPending(false)
    }
  }

  const handleTogglePolling = () => {
    if (!syncControls.current) return
    const store = useAppStore.getState()
    if (store.usePolling) {
      syncControls.current.stopPolling()
      store.setStatusMessage('Switched to SSE live stream.')
    } else {
      syncControls.current.startPolling()
      store.setStatusMessage('Switched to high-frequency polling.')
    }
    store.setUsePolling(!store.usePolling)
  }

  const snapshot = useAppStore(s => s.snapshot)
  const generatedAt = snapshot?.generated_at
    ? new Date(snapshot.generated_at).toLocaleString()
    : 'waiting for first snapshot'

  return { handleRefresh, handleTogglePolling, generatedAt }
}
