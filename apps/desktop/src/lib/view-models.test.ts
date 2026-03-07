import { describe, expect, it } from 'vitest'
import { getSortedRetryEntries, getSortedRunningEntries } from '@/lib/view-models'

describe('getSortedRunningEntries', () => {
  it('sorts running entries by issue identifier', () => {
    const sorted = getSortedRunningEntries([
      { issue_id: '3', issue_identifier: 'OPS-20', state: 'running' },
      { issue_id: '2', issue_identifier: 'OPS-10', state: 'running' },
      { issue_id: '1', issue_identifier: 'OPS-2', state: 'running' },
    ])

    expect(sorted.map((entry) => entry.issue_identifier)).toEqual(['OPS-10', 'OPS-2', 'OPS-20'])
  })

  it('does not mutate input array', () => {
    const input = [
      { issue_id: '2', issue_identifier: 'OPS-B', state: 'running' },
      { issue_id: '1', issue_identifier: 'OPS-A', state: 'running' },
    ]
    void getSortedRunningEntries(input)
    expect(input.map((entry) => entry.issue_identifier)).toEqual(['OPS-B', 'OPS-A'])
  })
})

describe('getSortedRetryEntries', () => {
  it('sorts retry entries by due_at then issue identifier then attempt', () => {
    const sorted = getSortedRetryEntries([
      { issue_id: '1', issue_identifier: 'OPS-B', state: 'retrying', attempt: 2, due_at: '2026-03-06T00:10:00Z', error: '' },
      { issue_id: '2', issue_identifier: 'OPS-A', state: 'retrying', attempt: 3, due_at: '2026-03-06T00:05:00Z', error: '' },
      { issue_id: '3', issue_identifier: 'OPS-A', state: 'retrying', attempt: 1, due_at: '2026-03-06T00:10:00Z', error: '' },
      { issue_id: '4', issue_identifier: 'OPS-A', state: 'retrying', attempt: 0, due_at: '2026-03-06T00:10:00Z', error: '' },
    ])

    expect(sorted.map((entry) => `${entry.due_at}|${entry.issue_identifier}|${entry.attempt}`)).toEqual([
      '2026-03-06T00:05:00Z|OPS-A|3',
      '2026-03-06T00:10:00Z|OPS-A|0',
      '2026-03-06T00:10:00Z|OPS-A|1',
      '2026-03-06T00:10:00Z|OPS-B|2',
    ])
  })
})
