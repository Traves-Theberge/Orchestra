import type { RetryEntry, RunningEntry } from '@/lib/orchestra-types'

function byIssueIdentifierAsc<T extends { issue_identifier: string }>(a: T, b: T): number {
  return a.issue_identifier.localeCompare(b.issue_identifier)
}

export function getSortedRunningEntries(entries: RunningEntry[]): RunningEntry[] {
  return [...entries].sort(byIssueIdentifierAsc)
}

export function getSortedRetryEntries(entries: RetryEntry[]): RetryEntry[] {
  return [...entries].sort((a, b) => {
    const due = a.due_at.localeCompare(b.due_at)
    if (due !== 0) {
      return due
    }
    const issue = byIssueIdentifierAsc(a, b)
    if (issue !== 0) {
      return issue
    }
    return a.attempt - b.attempt
  })
}
