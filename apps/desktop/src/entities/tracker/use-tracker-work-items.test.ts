import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  trackerCacheKey,
  clearTrackerCache,
  readTrackerCache,
  useTrackerWorkItems,
} from './use-tracker-work-items'
import type { BackendConfig } from '@core/api/client'
import type { WorkItem } from '@/entities/tracker/types'

// ---------------------------------------------------------------------------
// Mock the API client
// ---------------------------------------------------------------------------
vi.mock('@core/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@core/api/client')>()
  return {
    ...actual,
    browseTrackerItems: vi.fn(),
    browseProjectTrackerItems: vi.fn(),
  }
})

import { browseTrackerItems } from '@core/api/client'
const mockBrowse = vi.mocked(browseTrackerItems)

const config: BackendConfig = { baseUrl: 'http://127.0.0.1:4000', apiToken: 'test-token' }

const makeItem = (id: string): WorkItem => ({
  id,
  identifier: id,
  source: 'sqlite',
  title: `Item ${id}`,
  description: '',
  state: 'Todo',
  priority: 0,
  url: '',
  labels: [],
  assignees: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  extra: {},
})

// ---------------------------------------------------------------------------
// trackerCacheKey
// ---------------------------------------------------------------------------
describe('trackerCacheKey', () => {
  it('produces the same key regardless of state ordering', () => {
    const a = trackerCacheKey('cfg-1', { states: ['Todo', 'Done'] })
    const b = trackerCacheKey('cfg-1', { states: ['Done', 'Todo'] })
    expect(a).toBe(b)
  })

  it('produces different keys for different configIds', () => {
    const a = trackerCacheKey('cfg-1', {})
    const b = trackerCacheKey('cfg-2', {})
    expect(a).not.toBe(b)
  })

  it('handles undefined filter', () => {
    const key = trackerCacheKey('cfg-1')
    expect(key).toMatch(/^cfg-1::/)
  })

  it('produces different keys for different filters', () => {
    const a = trackerCacheKey('cfg-1', { states: ['Todo'] })
    const b = trackerCacheKey('cfg-1', { states: ['Done'] })
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// readTrackerCache + clearTrackerCache
// ---------------------------------------------------------------------------
describe('readTrackerCache + clearTrackerCache', () => {
  beforeEach(() => clearTrackerCache())

  it('returns null for missing keys', () => {
    expect(readTrackerCache('missing')).toBeNull()
  })

  it('clearTrackerCache removes all entries', () => {
    clearTrackerCache()
    expect(readTrackerCache(trackerCacheKey('cfg-1'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// useTrackerWorkItems hook
// ---------------------------------------------------------------------------
describe('useTrackerWorkItems', () => {
  beforeEach(() => {
    clearTrackerCache()
    mockBrowse.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty + not loading when config is null', () => {
    const { result } = renderHook(() => useTrackerWorkItems(null, 'cfg-1'))
    expect(result.current.items).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('returns empty + not loading when configId is null', () => {
    const { result } = renderHook(() => useTrackerWorkItems(config, null))
    expect(result.current.items).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('fetches items and sets them on success', async () => {
    const items = [makeItem('item-1'), makeItem('item-2')]
    mockBrowse.mockResolvedValueOnce(items)

    const { result } = renderHook(() => useTrackerWorkItems(config, 'cfg-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toEqual(items)
    expect(result.current.error).toBeNull()
    expect(mockBrowse).toHaveBeenCalledTimes(1)
  })

  it('serves cached results without re-fetching', async () => {
    const items = [makeItem('item-cached')]
    mockBrowse.mockResolvedValueOnce(items)

    const { result: r1 } = renderHook(() => useTrackerWorkItems(config, 'cfg-1'))
    await waitFor(() => expect(r1.current.loading).toBe(false))

    // Second hook instance — should use cache, not call the API again
    const { result: r2 } = renderHook(() => useTrackerWorkItems(config, 'cfg-1'))
    await waitFor(() => expect(r2.current.loading).toBe(false))

    expect(r2.current.items).toEqual(items)
    expect(mockBrowse).toHaveBeenCalledTimes(1)
  })

  it('sets error state on fetch failure', async () => {
    mockBrowse.mockRejectedValueOnce(new Error('network error'))

    const { result } = renderHook(() => useTrackerWorkItems(config, 'cfg-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('network error')
    expect(result.current.items).toEqual([])
  })

  it('refresh clears cache and re-fetches', async () => {
    const items1 = [makeItem('v1')]
    const items2 = [makeItem('v2')]
    mockBrowse.mockResolvedValueOnce(items1).mockResolvedValueOnce(items2)

    const { result } = renderHook(() => useTrackerWorkItems(config, 'cfg-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toEqual(items1)

    result.current.refresh()
    await waitFor(() => expect(result.current.items).toEqual(items2))
    expect(mockBrowse).toHaveBeenCalledTimes(2)
  })
})
