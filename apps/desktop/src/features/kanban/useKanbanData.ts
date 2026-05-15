import { useMemo } from 'react'

import type { IssueListItem } from '@core/api/client'
import type { SnapshotPayload } from '@core/api/types'

import type { BoardState } from './boardReducer'
import type { ColumnDef, EnrichedIssue } from './types'

const stateIs = (s: string, target: string) => s.toLowerCase() === target.toLowerCase()

export function useKanbanData(
  boardIssues: IssueListItem[],
  snapshot: SnapshotPayload | null,
  state: BoardState,
) {
  const enrichedIssues = useMemo<EnrichedIssue[]>(() => boardIssues.map((issue) => {
    const issueID = issue.issue_id || issue.id || ''
    let lane: EnrichedIssue['lane'] = null
    let detail = issue.title || issue.description || 'No Title'
    let at = issue.created_at || ''

    if (snapshot) {
      const running = snapshot.running?.find((r) => r.issue_id === issueID)
      if (running) {
        lane = 'running'
        detail = running.last_message || running.last_event || detail
        at = running.last_event_at || running.started_at || at
      } else {
        const retrying = snapshot.retrying?.find((r) => r.issue_id === issueID)
        if (retrying) {
          lane = 'retrying'
          detail = retrying.error || `attempt ${retrying.attempt}`
          at = retrying.due_at || at
        }
      }
    }

    return {
      ...issue,
      issue_id: issueID,
      issue_identifier: issue.identifier || issue.issue_identifier,
      lane,
      detail,
      at,
    }
  }), [boardIssues, snapshot])

  const visibleIssues = useMemo(() => enrichedIssues.filter((item) => {
    const stateMatch = state.stateFilter === 'all' || item.state === state.stateFilter
    const projectMatch = state.projectFilter === 'all' || item.project_id === state.projectFilter
    return stateMatch && projectMatch
  }), [enrichedIssues, state.stateFilter, state.projectFilter])

  const columns = useMemo<ColumnDef[]>(() => [
    { id: 'backlog', title: 'Backlog', items: visibleIssues.filter(i => stateIs(i.state, 'Backlog')), dot: 'bg-muted-foreground/40' },
    { id: 'todo', title: 'To Do', items: visibleIssues.filter(i => stateIs(i.state, 'Todo')), dot: 'bg-foreground/60' },
    { id: 'progress', title: 'In Progress', items: visibleIssues.filter(i => stateIs(i.state, 'In Progress')), dot: 'bg-violet-500' },
    { id: 'review', title: 'Review', items: visibleIssues.filter(i => stateIs(i.state, 'Review')), dot: 'bg-blue-500' },
    { id: 'done', title: 'Done', items: visibleIssues.filter(i => stateIs(i.state, 'Done')), dot: 'bg-emerald-500' },
  ], [visibleIssues])

  const orderedColumns = state.columnOrder.map((id) => columns.find((column) => column.id === id)!)

  return { enrichedIssues, visibleIssues, columns, orderedColumns }
}
