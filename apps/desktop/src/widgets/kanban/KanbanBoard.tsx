import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CircleDashed,
  Folder,
  FolderTree,
  Layout,
  MoreHorizontal,
  Play,
  Rows,
  Square,
  Ticket,
  Trash2,
} from 'lucide-react'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { AppTooltip } from '@/components/ui/tooltip-wrapper'
import { AgentSelector, CustomDropdown, PriorityIcon, PriorityLabel } from '@/components/app-shell/shared/controls'
import type { IssueListItem, IssueUpdatePayload } from '@/lib/orchestra-client'
import type { Project, SnapshotPayload } from '@/lib/orchestra-types'

type EnrichedIssue = IssueListItem & {
  issue_id: string
  issue_identifier?: string
  lane: 'running' | 'retrying' | null
  detail: string
  at: string
}

export function KanbanBoard({
  loadingState,
  snapshot,
  boardIssues = [],
  projects = [],
  availableAgents = [],
  onInspectIssue,
  onJumpToTerminal,
  onIssueUpdate,
  onIssueDelete,
  onStopSession,
  onCreateIssue,
}: {
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
  const handleCreateClick = (columnId: string) => {
    if (!onCreateIssue) return
    const stateMap: Record<string, string> = {
      todo: 'Todo',
      progress: 'In Progress',
      done: 'Done',
    }
    onCreateIssue(stateMap[columnId] || 'Todo')
  }

  const [stateFilter, setStateFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [projectFilter, setProjectFilter] = useState<string>(projects.length === 1 ? projects[0].id : 'all')
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [issueToDelete, setIssueToDelete] = useState<{ identifier: string; title?: string } | null>(null)
  const [deleteTaskPending, setDeleteTaskPending] = useState(false)
  const [deleteTaskError, setDeleteTaskError] = useState('')
  const [isDraggingOver, setIsDraggingOver] = useState<string | null>(null)
  const [columnOrder, setColumnOrder] = useState<string[]>(['todo', 'progress', 'done'])
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null)

  const osOptions = useMemo(() => ({
    scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
    overflow: { x: 'hidden' as const, y: 'scroll' as const },
  }), [])

  useEffect(() => {
    if (projects.length === 1) {
      setProjectFilter(projects[0].id)
    }
  }, [projects])

  const isNoDragTarget = (target: EventTarget | null) => {
    return target instanceof Element && !!target.closest('[data-no-drag="true"]')
  }

  const handleDragStart = (e: React.DragEvent, issueIdentifier: string) => {
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
    setDraggingColumnId(columnId)
  }

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    setIsDraggingOver(columnId)
  }

  const handleDrop = async (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault()
    setIsDraggingOver(null)
    setDraggingColumnId(null)

    const type = e.dataTransfer.getData('type')
    if (type === 'column') {
      const sourceColumnId = e.dataTransfer.getData('columnId')
      if (!sourceColumnId || sourceColumnId === targetColumnId) return

      const newOrder = [...columnOrder]
      const sourceIdx = newOrder.indexOf(sourceColumnId)
      const targetIdx = newOrder.indexOf(targetColumnId)
      newOrder.splice(sourceIdx, 1)
      newOrder.splice(targetIdx, 0, sourceColumnId)
      setColumnOrder(newOrder)
      return
    }

    const issueIdentifier = e.dataTransfer.getData('issueIdentifier')
    if (!issueIdentifier || !onIssueUpdate) return

    const stateMap: Record<string, string> = {
      todo: 'Todo',
      progress: 'In Progress',
      done: 'Done',
    }

    const nextState = stateMap[targetColumnId]
    if (nextState) {
      await onIssueUpdate(issueIdentifier, { state: nextState })
    }
  }

  const enrichedIssues = boardIssues.map((issue) => {
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
  })

  const uniqueStates = Array.from(new Set(enrichedIssues.map((item) => item.state))).sort()

  const filterItem = (item: EnrichedIssue) => {
    const stateMatch = stateFilter === 'all' || item.state === stateFilter
    const priorityMatch = priorityFilter === 'all' || String(item.priority ?? 0) === priorityFilter
    const projectMatch = projectFilter === 'all' || item.project_id === projectFilter
    return stateMatch && priorityMatch && projectMatch
  }

  const todoItems = enrichedIssues.filter((i) => i.state === 'Todo').filter(filterItem)
  const inProgressItems = enrichedIssues.filter((i) => i.state === 'In Progress').filter(filterItem)
  const doneItemsList = enrichedIssues.filter((i) => i.state === 'Done').filter(filterItem)

  const columns = [
    { id: 'todo', title: 'To Do', items: todoItems, icon: <div className="h-2 w-2 rounded-full border-2 border-muted-foreground" /> },
    { id: 'progress', title: 'In Progress', items: inProgressItems, icon: <div className="h-2 w-2 rounded-full border-2 border-amber-500 bg-amber-500" /> },
    { id: 'done', title: 'Done', items: doneItemsList, icon: <div className="h-2 w-2 rounded-full bg-primary" /> },
  ]

  const orderedColumns = columnOrder.map((id) => columns.find((column) => column.id === id)!)
  const filteredList = enrichedIssues.filter(filterItem)

  const getActionIssueRef = (item: EnrichedIssue): string => item.issue_identifier || item.issue_id || ''

  if (loadingState && enrichedIssues.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-0 space-y-6">
        <div className="flex items-center gap-3 border-b border-border/40 pb-4 shrink-0">
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="h-8 w-40 rounded-md" />
        </div>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 overflow-hidden">
          {['todo', 'progress', 'done'].map((column) => (
            <div key={column} className="flex flex-col min-h-0 space-y-4">
              <div className="flex items-center justify-between px-2 shrink-0">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-2 w-2 rounded-full" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
                <Skeleton className="h-4 w-6 rounded-full" />
              </div>
              <div className="flex-1 space-y-3 overflow-hidden p-1">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="bg-card/40 border border-border/50 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <Skeleton className="h-4 w-16 rounded" />
                      <Skeleton className="h-4 w-4 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-full rounded" />
                    <Skeleton className="h-3 w-2/3 rounded" />
                    <div className="pt-2 flex gap-2">
                      <Skeleton className="h-4 w-12 rounded-full" />
                      <Skeleton className="h-4 w-12 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1">
            <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground/60">State</span>
            <CustomDropdown
              className="w-40"
              value={stateFilter}
              options={[
                { label: 'All States', value: 'all', icon: <CircleDashed className="h-3 w-3" /> },
                ...uniqueStates.map((state) => ({ label: state, value: state, icon: <div className="h-1.5 w-1.5 rounded-full bg-primary" /> })),
              ]}
              onChange={setStateFilter}
            />
          </div>

          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1">
            <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground/60">Priority</span>
            <CustomDropdown
              className="w-40"
              value={priorityFilter}
              options={[
                { label: 'All Priorities', value: 'all', icon: <MoreHorizontal className="h-3 w-3" /> },
                { label: 'No Priority', value: '0', icon: <PriorityIcon priority={0} className="h-3 w-3" /> },
                { label: 'Low', value: '1', icon: <PriorityIcon priority={1} className="h-3 w-3" /> },
                { label: 'Medium', value: '2', icon: <PriorityIcon priority={2} className="h-3 w-3" /> },
                { label: 'High', value: '3', icon: <PriorityIcon priority={3} className="h-3 w-3" /> },
                { label: 'Urgent', value: '4', icon: <PriorityIcon priority={4} className="h-3 w-3" /> },
              ]}
              onChange={setPriorityFilter}
            />
          </div>

          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1">
            <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground/60">Project</span>
            <CustomDropdown
              className="w-56"
              value={projectFilter}
              options={[
                { label: 'All Projects', value: 'all', icon: <FolderTree className="h-3 w-3" /> },
                ...projects.map((project) => ({ label: project.name, value: project.id, icon: <Folder className="h-3 w-3" /> })),
              ]}
              onChange={setProjectFilter}
            />
          </div>

          {(stateFilter !== 'all' || priorityFilter !== 'all' || projectFilter !== 'all') ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                setStateFilter('all')
                setPriorityFilter('all')
                setProjectFilter('all')
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-1 rounded-lg border bg-muted/20 p-1">
          <AppTooltip content="Board View">
            <button
              onClick={() => setViewMode('board')}
              className={`grid h-7 w-8 place-items-center rounded-md transition-all ${viewMode === 'board' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Layout className="h-3.5 w-3.5" />
            </button>
          </AppTooltip>
          <AppTooltip content="List View">
            <button
              onClick={() => setViewMode('list')}
              className={`grid h-7 w-8 place-items-center rounded-md transition-all ${viewMode === 'list' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Rows className="h-3.5 w-3.5" />
            </button>
          </AppTooltip>
        </div>
      </div>

      {viewMode === 'board' ? (
        <div className="flex-1 grid grid-cols-1 gap-6 lg:grid-cols-3 min-h-0">
          {orderedColumns.map((column) => (
            <div
              key={column.id}
              className={`flex flex-col gap-3 transition-opacity min-h-0 ${draggingColumnId === column.id ? 'opacity-40' : ''}`}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={() => setIsDraggingOver(null)}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              <div
                className="flex cursor-grab items-center justify-between px-1 active:cursor-grabbing shrink-0"
                draggable
                onDragStart={(e) => handleColumnDragStart(e, column.id)}
              >
                <div className="flex items-center gap-2">
                  {column.icon}
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{column.title}</h3>
                  <span className="text-[11px] font-medium text-muted-foreground/50">{column.items.length}</span>
                </div>
                <AppTooltip content={`Create Task in ${column.title}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:bg-muted/50"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCreateClick(column.id)
                    }}
                  >
                    <span className="text-lg font-light">+</span>
                  </Button>
                </AppTooltip>
              </div>

              <OverlayScrollbarsComponent
                element="div"
                options={osOptions}
                className={`flex-1 flex flex-col gap-2 rounded-xl p-1.5 transition-colors min-h-0 ${isDraggingOver === column.id ? 'bg-primary/5 ring-2 ring-primary/20 ring-inset' : 'bg-muted/10'}`}
              >
                {loadingState ? (
                  Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-28 w-full rounded-lg" />)
                ) : column.items.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                    <div className="mb-2 h-8 w-8 rounded-full border-2 border-dashed border-muted-foreground/20" />
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40">Empty</p>
                  </div>
                ) : (
                  column.items.map((item) => {
                    const priority = Number(item.priority ?? 0)
                    const priorityBorderClass =
                      priority === 4 ? 'hover:border-red-500/40' :
                        priority === 3 ? 'hover:border-amber-500/40' :
                          priority === 2 ? 'hover:border-blue-500/40' :
                            'hover:border-primary/20'

                    return (
                      <Card
                        key={item.issue_id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, getActionIssueRef(item))}
                        className={`group relative cursor-grab border-transparent bg-card p-3.5 shadow-sm transition-all duration-300 ${priorityBorderClass} hover:shadow-xl hover:shadow-primary/5 active:cursor-grabbing active:scale-[0.98] rounded-xl`}
                        onClick={() => void onInspectIssue(getActionIssueRef(item))}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AppTooltip content={<PriorityLabel priority={priority} />}>
                              <div className="p-1 rounded-md bg-muted/50 border border-border/50">
                                <PriorityIcon priority={priority} className="h-2.5 w-2.5" />
                              </div>
                            </AppTooltip>
                            <span className="font-mono text-[9px] font-black uppercase tracking-tight text-muted-foreground/60 group-hover:text-primary transition-colors">
                              {item.issue_identifier}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/30 tabular-nums">
                              {item.at
                                ? new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : item.due_at
                                  ? 'Retry'
                                  : ''}
                            </span>
                            <div
                              data-no-drag="true"
                              className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0"
                            >
                              {item.state === 'Todo' && item.assignee_id && item.assignee_id !== 'Unassigned' && onIssueUpdate && (
                                <AppTooltip content="Launch agent session">
                                  <button
                                    type="button"
                                    data-no-drag="true"
                                    className="p-1 rounded-md text-emerald-500/60 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void onIssueUpdate(getActionIssueRef(item), { state: 'In Progress' })
                                    }}
                                  >
                                    <Play className="h-2.5 w-2.5 fill-current" />
                                  </button>
                                </AppTooltip>
                              )}
                              {item.state === 'In Progress' && onStopSession && (
                                <AppTooltip content="Stop session">
                                  <button
                                    type="button"
                                    data-no-drag="true"
                                    className="p-1 rounded-md text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 transition-all"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void onStopSession(getActionIssueRef(item))
                                    }}
                                  >
                                    <Square className="h-2 w-2 fill-current" />
                                  </button>
                                </AppTooltip>
                              )}
                              {onIssueDelete && (
                                <AppTooltip content="Permanently delete">
                                  <button
                                    type="button"
                                    data-no-drag="true"
                                    aria-label={`Delete task ${item.issue_identifier}`}
                                    className="p-1 rounded-md text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10 transition-all"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setDeleteTaskError('')
                                        setIssueToDelete({ identifier: getActionIssueRef(item), title: item.title })
                                        setDeleteDialogOpen(true)
                                      }}
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </button>
                                </AppTooltip>
                              )}
                            </div>
                          </div>
                        </div>
                        <p className="mt-2.5 line-clamp-2 text-[12px] font-bold leading-[1.4] text-foreground/90 group-hover:text-foreground transition-colors">
                          {item.title || item.description || item.last_message || item.error || 'No message'}
                        </p>
                        {Array.isArray(item.labels) && item.labels.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1">
                            {item.labels.slice(0, 2).map((label: string) => (
                              <Badge key={label} variant="outline" className="px-1 py-0 text-[8px] font-black uppercase tracking-widest bg-muted/30 text-muted-foreground/60 border-border/40">
                                {label}
                              </Badge>
                            ))}
                            {item.labels.length > 2 && <span className="text-[8px] font-black text-muted-foreground/30">+{item.labels.length - 2}</span>}
                          </div>
                        )}
                        <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-2.5">
                          <div data-no-drag="true">
                            <AgentSelector
                              value={item.assignee_id || ''}
                              agents={availableAgents}
                              onChange={(value) => {
                                if (onIssueUpdate) {
                                   void onIssueUpdate(getActionIssueRef(item), { assignee_id: value })
                                }
                              }}
                            />
                          </div>
                          {item.session_id ? (
                            <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[8px] font-black uppercase tracking-widest text-amber-500 animate-in fade-in duration-500">
                              <Activity className="h-2 w-2 animate-pulse" />
                              <span>Live</span>
                            </div>
                          ) : null}
                        </div>
                      </Card>
                    )
                  })
                )}
              </OverlayScrollbarsComponent>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 rounded-xl border bg-card/50 shadow-lg overflow-hidden min-h-0 flex flex-col">
          {filteredList.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-muted-foreground/40">
              <Ticket className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm italic uppercase tracking-widest font-bold">No tasks match current filters</p>
            </div>
          ) : (
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-muted/80 backdrop-blur text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                    <th className="px-4 py-3 w-24">ID</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3 w-32">Assignee</th>
                    <th className="px-4 py-3 w-28">Status</th>
                    <th className="px-4 py-3 w-28">Priority</th>
                    <th className="px-4 py-3 w-32 text-right">Activity</th>
                    <th className="px-4 py-3 w-20 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredList.map((item) => (
                    <tr
                      key={item.issue_id}
                      className="group hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => void onInspectIssue(getActionIssueRef(item))}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-xs font-bold text-primary">{item.issue_identifier}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                            {item.title || item.detail || 'No Title'}
                          </span>
                          {item.lane === 'running' && (
                            <div className="flex items-center gap-1.5 text-[10px] text-amber-500 font-bold uppercase tracking-tighter">
                              <Activity className="h-3 w-3" />
                              Active session
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <AgentSelector
                          value={item.assignee_id || ''}
                          agents={availableAgents}
                          onChange={(value) => {
                            if (onIssueUpdate) {
                                void onIssueUpdate(getActionIssueRef(item), { assignee_id: value })
                            }
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className={`h-1.5 w-1.5 rounded-full ${item.state === 'Done' ? 'bg-primary' : item.state === 'In Progress' ? 'bg-amber-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
                          <span className="text-xs font-medium text-muted-foreground">{item.state}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <PriorityIcon priority={Number(item.priority ?? 0)} className="h-3.5 w-3.5" />
                          <span className="text-xs text-muted-foreground">
                            <PriorityLabel priority={Number(item.priority ?? 0)} />
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="text-[10px] font-mono text-muted-foreground/60">
                          {item.at ? new Date(item.at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {item.state === 'Todo' && item.assignee_id && item.assignee_id !== 'Unassigned' && onIssueUpdate && (
                            <button
                              type="button"
                              className="p-1 rounded-md text-emerald-500/60 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all active:scale-95"
                              onClick={(e) => {
                                e.stopPropagation()
                                void onIssueUpdate(getActionIssueRef(item), { state: 'In Progress' })
                              }}
                            >
                              <Play className="h-3.5 w-3.5 fill-current" />
                            </button>
                          )}
                          {item.state === 'In Progress' && onStopSession && (
                            <button
                              type="button"
                              className="p-1 rounded-md text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 transition-all active:scale-95"
                              onClick={(e) => {
                                e.stopPropagation()
                                void onStopSession(getActionIssueRef(item))
                              }}
                            >
                              <Square className="h-3 w-3 fill-current" />
                            </button>
                          )}
                          {onIssueDelete && (
                            <button
                              type="button"
                              aria-label={`Delete task ${item.issue_identifier}`}
                              className="p-1 rounded-md text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10 transition-all cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteTaskError('')
                                setIssueToDelete({ identifier: getActionIssueRef(item), title: item.title })
                                setDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="h-5 w-5" />
              Delete Task
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this task? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {issueToDelete && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-mono text-primary">{issueToDelete.identifier}</p>
                {issueToDelete.title && (
                  <p className="mt-1 text-sm text-muted-foreground">{issueToDelete.title}</p>
                )}
              </div>
            )}
            {deleteTaskError ? (
              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {deleteTaskError}
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
                setIssueToDelete(null)
                setDeleteTaskError('')
              }}
              disabled={deleteTaskPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (issueToDelete && onIssueDelete) {
                  setDeleteTaskPending(true)
                  setDeleteTaskError('')
                  try {
                    await onIssueDelete(issueToDelete.identifier)
                    setDeleteDialogOpen(false)
                    setIssueToDelete(null)
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'Failed to delete task'
                    setDeleteTaskError(message)
                    // Keep dialog open so the operator can retry after inline error feedback.
                  } finally {
                    setDeleteTaskPending(false)
                  }
                  return
                }
                setDeleteDialogOpen(false)
                setIssueToDelete(null)
              }}
              disabled={deleteTaskPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleteTaskPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
