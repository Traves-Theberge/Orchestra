import { Plus } from 'lucide-react'

import { Skeleton } from '@ui/skeleton'
import type { IssueUpdatePayload } from '@core/api/client'
import type { Project } from '@core/api/types'

import { type ColumnDef } from '../types'
import { IssueCard } from './IssueCard'

type Props = {
  column: ColumnDef
  loadingState: boolean
  isDraggingOver: boolean
  isBeingDragged: boolean
  projects: Project[]
  availableAgents: string[]
  onColumnDragStart: (e: React.DragEvent, columnId: string) => void
  onColumnDragOver: (e: React.DragEvent, columnId: string) => void
  onColumnDragLeave: () => void
  onColumnDrop: (e: React.DragEvent, columnId: string) => void
  onIssueDragStart: (e: React.DragEvent, identifier: string) => void
  onCreateClick: (columnId: string) => void
  onInspectIssue: (identifier: string) => Promise<void>
  onIssueUpdate?: (identifier: string, updates: IssueUpdatePayload) => Promise<void>
  onStopSession?: (identifier: string) => Promise<void>
  onIssueDelete?: (identifier: string) => Promise<void>
  onRequestDelete: (target: { identifier: string; title?: string }) => void
}

export function KanbanColumn({
  column,
  loadingState,
  isDraggingOver,
  isBeingDragged,
  projects,
  availableAgents,
  onColumnDragStart,
  onColumnDragOver,
  onColumnDragLeave,
  onColumnDrop,
  onIssueDragStart,
  onCreateClick,
  onInspectIssue,
  onIssueUpdate,
  onStopSession,
  onIssueDelete,
  onRequestDelete,
}: Props) {
  return (
    <div
      className={`flex flex-col min-h-0 transition-opacity ${isBeingDragged ? 'opacity-30' : ''}`}
      onDragOver={(e) => onColumnDragOver(e, column.id)}
      onDragLeave={onColumnDragLeave}
      onDrop={(e) => onColumnDrop(e, column.id)}
    >
      <div
        className="flex cursor-grab items-center gap-2 p-3 active:cursor-grabbing shrink-0"
        draggable
        onDragStart={(e) => onColumnDragStart(e, column.id)}
      >
        <span className={`block h-2 w-2 rounded-full shrink-0 ${column.dot}`} />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-foreground/40 flex-1 truncate">{column.title}</span>
        {column.items.length > 0 && (
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground/35 bg-muted/50 px-1.5 py-0.5 rounded-full leading-none">{column.items.length}</span>
        )}
      </div>

      <div className={`flex-1 min-h-0 flex flex-col mx-1 mb-1 rounded-xl overflow-hidden transition-all ${
        isDraggingOver
          ? 'ring-1 ring-primary/40 bg-primary/[0.03]'
          : 'bg-muted/[0.03]'
      }`}>
        <div className="flex-1 flex flex-col gap-1.5 p-2 min-h-0 overflow-y-auto overflow-x-hidden">
          {loadingState ? (
            Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-20 w-full rounded-lg" />)
          ) : column.items.length === 0 ? (
            column.id === 'backlog' ? (
              <button
                type="button"
                className="w-full min-h-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/30 hover:border-border/60 hover:bg-foreground/[0.02] transition-all group/empty"
                onClick={() => onCreateClick(column.id)}
              >
                <div className="size-6 rounded-full bg-muted/50 grid place-items-center group-hover/empty:bg-primary/10 transition-colors">
                  <Plus className="size-3 text-muted-foreground/40 group-hover/empty:text-primary transition-colors" />
                </div>
                <p className="text-[10.5px] font-medium text-muted-foreground/40 group-hover/empty:text-muted-foreground/70 transition-colors">Add task</p>
              </button>
            ) : (
              <div className="w-full min-h-full flex items-center justify-center rounded-lg border border-dashed border-border/30">
                <p className="text-[10px] text-muted-foreground/25 font-medium">Empty</p>
              </div>
            )
          ) : (
            column.items.map((item) => (
              <IssueCard
                key={item.issue_id}
                item={item}
                columnDot={column.dot}
                projects={projects}
                availableAgents={availableAgents}
                onInspectIssue={onInspectIssue}
                onIssueUpdate={onIssueUpdate}
                onStopSession={onStopSession}
                onIssueDelete={onIssueDelete}
                onRequestDelete={onRequestDelete}
                onDragStart={onIssueDragStart}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
