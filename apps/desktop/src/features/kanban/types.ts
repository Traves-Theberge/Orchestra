import type { IssueListItem } from '@core/api/client'

export type EnrichedIssue = IssueListItem & {
  issue_id: string
  issue_identifier?: string
  lane: 'running' | 'retrying' | null
  detail: string
  at: string
}

export type ColumnDef = {
  id: string
  title: string
  items: EnrichedIssue[]
  dot: string
}

export const COLUMN_TO_STATE: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

export const STATE_TO_COLUMN: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMN_TO_STATE).map(([k, v]) => [v, k]),
)

export const INITIAL_COLUMN_ORDER: string[] = ['backlog', 'todo', 'progress', 'review', 'done']

export const getActionIssueRef = (item: EnrichedIssue): string =>
  item.issue_identifier || item.issue_id || ''

export const getBacklogMissingFields = (item: EnrichedIssue): string[] => {
  const missing: string[] = []
  if (!item.title?.trim()) missing.push('title')
  if (!item.description?.trim()) missing.push('description')
  if (!item.assignee_id || item.assignee_id === 'Unassigned') missing.push('assignee')
  if (!item.project_id) missing.push('project')
  return missing
}
