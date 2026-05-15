import { useEffect, useReducer } from 'react'

import type { BackendConfig, IssueListItem, IssueUpdatePayload } from '@core/api/client'
import type { Project, SnapshotPayload } from '@core/api/types'
import { useAppStore } from '@core/store'

import { boardReducer, initialBoardState } from './boardReducer'
import { useKanbanData } from './useKanbanData'
import { useKanbanDnD } from './useKanbanDnD'
import { BoardLoadingSkeleton } from './components/BoardLoadingSkeleton'
import { BoardTabs } from './components/BoardTabs'
import { BoardToolbar } from './components/BoardToolbar'
import { DeleteTaskDialog } from './components/DeleteTaskDialog'
import { FeedbackDialog } from './components/FeedbackDialog'
import { IssueListTable } from './components/IssueListTable'
import { KanbanColumn } from './components/KanbanColumn'
import { WorkItemsPanel } from './components/WorkItemsPanel'

const EMPTY_ISSUES: IssueListItem[] = []
const EMPTY_PROJECTS: Project[] = []
const EMPTY_AGENTS: string[] = []

export function KanbanBoard({
  config,
  project: _project,
  loadingState,
  snapshot,
  boardIssues = EMPTY_ISSUES,
  projects = EMPTY_PROJECTS,
  availableAgents = EMPTY_AGENTS,
  onInspectIssue,
  onIssueUpdate,
  onIssueDelete,
  onStopSession,
  onCreateIssue,
}: {
  config: BackendConfig | null
  project: Project | null
  loadingState: boolean
  snapshot: SnapshotPayload | null
  boardIssues?: IssueListItem[]
  projects?: Project[]
  availableAgents?: string[]
  onInspectIssue: (issueIdentifier: string) => Promise<void>
  onJumpToTerminal?: (identifier: string) => void
  onIssueUpdate?: (identifier: string, updates: IssueUpdatePayload) => Promise<void>
  onIssueDelete?: (identifier: string) => Promise<void>
  onStopSession?: (identifier: string) => Promise<void>
  onCreateIssue?: (state: string) => void
}) {
  const selectedProjectID = useAppStore(s => s.selectedProjectID)
  const setSelectedProjectID = useAppStore(s => s.setSelectedProjectID)

  const [state, dispatch] = useReducer(
    boardReducer,
    projects.length === 1 ? projects[0].id : 'all',
    initialBoardState,
  )

  useEffect(() => {
    if (projects.length === 1) {
      dispatch({ type: 'setProjectFilter', value: projects[0].id })
    }
  }, [projects])

  const { enrichedIssues, visibleIssues, orderedColumns } = useKanbanData(boardIssues, snapshot, state)
  const { handleIssueDragStart, handleColumnDragStart, handleDragOver, handleDrop } = useKanbanDnD({
    state,
    dispatch,
    boardIssues,
    onIssueUpdate,
  })

  const handleCreateClick = (columnId: string) => {
    if (columnId !== 'backlog') return
    onCreateIssue?.('Backlog')
  }

  const handleRequestDelete = (target: { identifier: string; title?: string }) =>
    dispatch({ type: 'openDeleteDialog', target })

  if (loadingState && enrichedIssues.length === 0) {
    return <BoardLoadingSkeleton />
  }

  const activeProject = projects.find(p => p.id === selectedProjectID) ?? null

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-5">
      <BoardTabs
        activeTab={state.activeTab}
        onTabChange={(tab) => dispatch({ type: 'setActiveTab', tab })}
        projects={projects}
        selectedProjectID={selectedProjectID}
        onSelectProject={setSelectedProjectID}
      />

      {state.activeTab === 'workitems' ? (
        <WorkItemsPanel config={config} activeProject={activeProject} />
      ) : null}

      {state.activeTab === 'board' ? (
        <>
          <BoardToolbar
            viewMode={state.viewMode}
            stateFilter={state.stateFilter}
            projectFilter={state.projectFilter}
            projects={projects}
            onCreateClick={() => handleCreateClick('backlog')}
            onStateFilterChange={(value) => dispatch({ type: 'setStateFilter', value })}
            onProjectFilterChange={(value) => dispatch({ type: 'setProjectFilter', value })}
            onViewModeChange={(mode) => dispatch({ type: 'setViewMode', mode })}
          />

          {state.dragValidationMsg && (
            <div className="mx-4 mb-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[11px] font-bold animate-in fade-in slide-in-from-top-2 duration-300">
              {state.dragValidationMsg}
            </div>
          )}

          {state.viewMode === 'board' ? (
            <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-4 pb-4">
              <div className="h-full grid gap-px min-w-[640px]" style={{ gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))' }}>
                {orderedColumns.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    column={column}
                    loadingState={loadingState}
                    isDraggingOver={state.isDraggingOver === column.id}
                    isBeingDragged={state.draggingColumnId === column.id}
                    projects={projects}
                    availableAgents={availableAgents}
                    onColumnDragStart={handleColumnDragStart}
                    onColumnDragOver={handleDragOver}
                    onColumnDragLeave={() => dispatch({ type: 'dragOverColumn', columnId: null })}
                    onColumnDrop={handleDrop}
                    onIssueDragStart={handleIssueDragStart}
                    onCreateClick={handleCreateClick}
                    onInspectIssue={onInspectIssue}
                    onIssueUpdate={onIssueUpdate}
                    onStopSession={onStopSession}
                    onIssueDelete={onIssueDelete}
                    onRequestDelete={handleRequestDelete}
                  />
                ))}
              </div>
            </div>
          ) : (
            <IssueListTable
              items={visibleIssues}
              availableAgents={availableAgents}
              onInspectIssue={onInspectIssue}
              onIssueUpdate={onIssueUpdate}
              onStopSession={onStopSession}
              onIssueDelete={onIssueDelete}
              onRequestDelete={handleRequestDelete}
            />
          )}

          <FeedbackDialog
            target={state.feedbackDialogTarget}
            text={state.feedbackText}
            pending={state.feedbackPending}
            onTextChange={(value) => dispatch({ type: 'setFeedbackText', value })}
            onClose={() => dispatch({ type: 'closeFeedbackDialog' })}
            onSubmit={async () => {
              if (!state.feedbackDialogTarget || !onIssueUpdate) return
              dispatch({ type: 'setFeedbackPending', pending: true })
              try {
                await onIssueUpdate(state.feedbackDialogTarget.identifier, {
                  state: state.feedbackDialogTarget.targetState,
                  feedback: state.feedbackText.trim(),
                })
                dispatch({ type: 'closeFeedbackDialog' })
              } finally {
                dispatch({ type: 'setFeedbackPending', pending: false })
              }
            }}
          />

          <DeleteTaskDialog
            open={state.deleteDialogOpen}
            target={state.issueToDelete}
            pending={state.deleteTaskPending}
            error={state.deleteTaskError}
            onOpenChange={(open) => { if (!open) dispatch({ type: 'closeDeleteDialog' }) }}
            onCancel={() => dispatch({ type: 'closeDeleteDialog' })}
            onConfirm={async () => {
              if (state.issueToDelete && onIssueDelete) {
                dispatch({ type: 'setDeleteTaskPending', pending: true })
                dispatch({ type: 'setDeleteTaskError', error: '' })
                try {
                  await onIssueDelete(state.issueToDelete.identifier)
                  dispatch({ type: 'closeDeleteDialog' })
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Failed to delete task'
                  dispatch({ type: 'setDeleteTaskError', error: message })
                } finally {
                  dispatch({ type: 'setDeleteTaskPending', pending: false })
                }
                return
              }
              dispatch({ type: 'closeDeleteDialog' })
            }}
          />
        </>
      ) : null}
    </div>
  )
}
