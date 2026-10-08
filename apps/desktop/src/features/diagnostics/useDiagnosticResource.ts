import { useCallback, useEffect, useRef, useState } from 'react'

/** Serial polling, visibility gating, and generation fencing prevent stale backend data. */
export function useDiagnosticResource<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>, enabled: boolean, live = true, refreshRevision = 0): { data?: T; error?: string; loading: boolean; updated?: Date; refresh: () => void } {
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ key: string; data?: T; error?: string; loading: boolean; updated?: Date }>({ key, loading: enabled })
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    let activeRequest: AbortController | undefined
    setState(previous => previous.key === key ? previous : { key, loading: enabled })
    async function load() {
      if (disposed || busy || !enabled || document.visibilityState === 'hidden') return
      busy = true
      const controller = new AbortController()
      activeRequest = controller
      const timeout = setTimeout(() => controller.abort(), 30000)
      try {
        const data = await fetchRef.current(controller.signal)
        if (!disposed) setState({ key, data, loading: false, updated: new Date() })
      } catch (error) {
        if (!disposed) setState(previous => ({ ...previous, key, loading: false, error: error instanceof Error ? error.message : 'Diagnostics request failed' }))
      } finally {
        clearTimeout(timeout)
        busy = false
        if (!disposed && enabled && live && !document.hidden) timer = setTimeout(() => void load(), 5000)
      }
    }
    const visibility = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'hidden') void load()
    }
    void load()
    document.addEventListener('visibilitychange', visibility)
    return () => { disposed = true; activeRequest?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [key, enabled, live, revision, refreshRevision])
  return { ...(state.key === key ? state : { loading: enabled }), refresh }
}
