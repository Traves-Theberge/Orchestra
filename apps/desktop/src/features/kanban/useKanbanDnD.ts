import type { Dispatch } from 'react'

import type { IssueListItem, IssueUpdatePayload } from '@core/api/client'

import type { BoardAction, BoardState } from './boardReducer'
import { COLUMN_TO_STATE, STATE_TO_COLUMN } from './types'

const ALLOWED_DRAG_TRANSITIONS: Record<string, string[]> = {
  backlog: ['todo'],
  todo: ['progress'],
  progress: [],
  review: ['todo', 'done'],
  done: [],
}

function isNoDragTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('[data-no-drag="true"]')
}

interface UseKanbanDnDArgs {
  state: BoardState
  dispatch: Dispatch<BoardAction>
  boardIssues: IssueListItem[]
  onIssueUpdate?: (identifier: string, updates: IssueUpdatePayload) => Promise<void>
}

export function useKanbanDnD({ state, dispatch, boardIssues, onIssueUpdate }: UseKanbanDnDArgs) {
  const handleIssueDragStart = (e: React.DragEvent, issueIdentifier: string) => {
    if (isNoDragTarget(e.target)) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('issueIdentifier', issueIdentifier)
    e.dataTransfer.setData('type', 'issue')
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleColumnDragStart = (e: React.DragEvent, columnId: string) => {
    e.dataTransfer.setData('columnId', columnId)
    e.dataTransfer.setData('type', 'column')
    dispatch({ type: 'dragStartColumn', columnId })
  }

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    dispatch({ type: 'dragOverColumn', columnId })
  }

  const handleDrop = async (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault()
    dispatch({ type: 'dragEnd' })

    const type = e.dataTransfer.getData('type')
    if (type === 'column') {
      const sourceColumnId = e.dataTransfer.getData('columnId')
      if (!sourceColumnId || sourceColumnId === targetColumnId) return

      const newOrder = [...state.columnOrder]
      const sourceIdx = newOrder.indexOf(sourceColumnId)
      const targetIdx = newOrder.indexOf(targetColumnId)
      newOrder.splice(sourceIdx, 1)
      newOrder.splice(targetIdx, 0, sourceColumnId)
      dispatch({ type: 'setColumnOrder', order: newOrder })
      return
    }

    const issueIdentifier = e.dataTransfer.getData('issueIdentifier')
    if (!issueIdentifier || !onIssueUpdate) return

    const issue = boardIssues.find(
      (i) => (i.identifier || i.issue_identifier) === issueIdentifier,
    )
    if (!issue) return

    const currentColumnId = STATE_TO_COLUMN[issue.state] || ''
    if (currentColumnId === targetColumnId) return

    const allowed = ALLOWED_DRAG_TRANSITIONS[currentColumnId]
    if (!allowed || !allowed.includes(targetColumnId)) return

    if (currentColumnId === 'backlog' && targetColumnId === 'todo') {
      const missing: string[] = []
      if (!issue.title?.trim()) missing.push('title')
      if (!issue.description?.trim()) missing.push('description')
      if (!issue.assignee_id || issue.assignee_id === 'Unassigned') missing.push('assignee')
      if (!issue.project_id) missing.push('project')
      if (missing.length > 0) {
        const message = `Cannot move to Todo — missing: ${missing.join(', ')}. Open the task to fill in required fields.`
        dispatch({ type: 'setDragValidationMsg', message })
        setTimeout(() => dispatch({ type: 'setDragValidationMsg', message: null }), 5000)
        return
      }
    }

    const nextState = COLUMN_TO_STATE[targetColumnId]
    if (!nextState) return

    if (currentColumnId === 'review' && (targetColumnId === 'todo' || targetColumnId === 'progress')) {
      dispatch({
        type: 'openFeedbackDialog',
        target: { identifier: issueIdentifier, targetState: nextState },
      })
      return
    }

    await onIssueUpdate(issueIdentifier, { state: nextState })
  }

  return { handleIssueDragStart, handleColumnDragStart, handleDragOver, handleDrop }
}
