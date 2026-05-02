import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackendConfig } from '@core/api/client'
import { browseTrackerItems } from '@core/api/client'
import type { WorkItem, WorkItemFilter } from '@/entities/tracker/types'

const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  items: WorkItem[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

/** Build a stable cache key from configId + filter. Exported for tests. */
export function trackerCacheKey(configId: string, filter?: WorkItemFilter): string {
  const normalized = filter
    ? {
        states: filter.states ? [...filter.states].sort() : undefined,
        labels: filter.labels ? [...filter.labels].sort() : undefined,
        assigneeId: filter.assigneeId,
        search: filter.search,
      }
    : {}
  return `${configId}::${JSON.stringify(normalized)}`
}

/** Clear all cached entries. Exported for tests and explicit refresh. */
export function clearTrackerCache(): void {
  cache.clear()
}

/** Read the cached entry for a key if it's still fresh. Exported for tests. */
export function readTrackerCache(key: string): WorkItem[] | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt >= CACHE_TTL_MS) return null
  return entry.items
}

interface UseTrackerWorkItemsResult {
  items: WorkItem[]
  loading: boolean
  error: Error | null
  refresh: () => void
}

/**
 * Fetches WorkItems from a tracker config with a 5-minute TTL cache.
 * Returns an empty list immediately when configId or config is null.
 */
export function useTrackerWorkItems(
  config: BackendConfig | null,
  configId: string | null,
  filter?: WorkItemFilter,
): UseTrackerWorkItemsResult {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const filterKey = filter
    ? JSON.stringify({
        states: filter.states ? [...filter.states].sort() : undefined,
        labels: filter.labels ? [...filter.labels].sort() : undefined,
        assigneeId: filter.assigneeId,
        search: filter.search,
      })
    : ''

  const fetchItems = useCallback(async () => {
    if (!config || !configId) return

    const key = trackerCacheKey(configId, filter)
    const cached = readTrackerCache(key)
    if (cached) {
      setItems(cached)
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)
    try {
      const data = await browseTrackerItems(config, configId, {
        states: filter?.states,
      })
      cache.set(key, { items: data, fetchedAt: Date.now() })
      setItems(data)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err as Error)
      }
    } finally {
      setLoading(false)
    }
  }, [config, configId, filterKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!config || !configId) {
      setItems([])
      setLoading(false)
      return
    }
    fetchItems()
    return () => abortRef.current?.abort()
  }, [config, configId, filterKey, fetchItems])

  const refresh = useCallback(() => {
    if (!configId) return
    cache.delete(trackerCacheKey(configId, filter))
    fetchItems()
  }, [configId, filterKey, fetchItems]) // eslint-disable-line react-hooks/exhaustive-deps

  return { items, loading, error, refresh }
}
