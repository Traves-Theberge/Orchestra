import type { RetryEntry, RunningEntry } from '@core/api/types'

/**
 * Comparator that sorts entries by issue identifier in ascending alphabetical order.
 * @param a - First entry.
 * @param b - Second entry.
 * @returns Negative, zero, or positive comparison result.
 */
function byIssueIdentifierAsc<T extends { issue_identifier: string }>(a: T, b: T): number {
  return a.issue_identifier.localeCompare(b.issue_identifier)
}

/**
 * Returns a sorted copy of running entries, ordered by issue identifier ascending.
 * @param entries - The unsorted running entries.
 * @returns A new sorted array.
 */
export function getSortedRunningEntries(entries: RunningEntry[]): RunningEntry[] {
  return entries.toSorted(byIssueIdentifierAsc)
}

/**
 * Returns a sorted copy of retry entries, ordered by due_at ascending,
 * then by issue identifier, then by attempt number.
 * @param entries - The unsorted retry entries.
 * @returns A new sorted array.
 */
export function getSortedRetryEntries(entries: RetryEntry[]): RetryEntry[] {
  return entries.toSorted((a, b) => {
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
