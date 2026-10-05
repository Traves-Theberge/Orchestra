import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchIssueDetail } from '@core/api/client'
import { useIssueLookup } from './use-issue-lookup'

vi.mock('@core/api/client', () => ({
  fetchIssueDetail: vi.fn(),
  isUnauthorizedError: vi.fn(() => false),
  toDisplayError: (error: unknown) => error instanceof Error ? error.message : String(error),
}))

const config = { baseUrl: 'http://127.0.0.1:4010', apiToken: 'fixture' }

beforeEach(() => vi.clearAllMocks())

describe('useIssueLookup', () => {
  it('retains the current task result when a same-task refresh fails', async () => {
    const currentTask = { id: 'task-1', identifier: 'ORC-1', title: 'Existing task' }
    vi.mocked(fetchIssueDetail)
      .mockResolvedValueOnce(currentTask as never)
      .mockRejectedValueOnce(new Error('Backend temporarily unavailable'))
    const setStatusMessage = vi.fn()
    const { result } = renderHook(() => useIssueLookup(config, setStatusMessage))

    await act(async () => { await result.current.executeIssueLookup('ORC-1') })
    expect(result.current.issueLookupResult).toEqual(currentTask)

    await act(async () => { await result.current.executeIssueLookup('ORC-1') })

    expect(result.current.issueLookupResult).toEqual(currentTask)
    expect(result.current.issueLookupError).toBe('Backend temporarily unavailable')
    expect(result.current.issueLookupPending).toBe(false)
  })
})
