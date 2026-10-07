import { cloneElement, Fragment, lazy, Suspense, useEffect, useId, useState, useRef, type ReactElement, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertCircle,
  ChevronDown,
  CircleDashed,
  Folder,
  FolderTree,
  Github,
  Layout,
  Play,
  Plus,
  Rows,
  Search,
  Square,
  ClipboardList,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@ui/button'
import { Card } from '@ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog'
import { Skeleton } from '@ui/skeleton'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { AgentSelector, CustomDropdown } from '@layout/shared/controls'
import type { BackendConfig, IssueListItem, IssueUpdatePayload } from '@core/api/client'
import type { Project, SnapshotPayload } from '@core/api/types'
import { useAppStore } from '@core/store'

const TrackerViewer = lazy(() => import('@features/tracker').then(m => ({ default: m.TrackerViewer })))

type EnrichedIssue = IssueListItem & {
  issue_id: string
  issue_identifier?: string
  lane: 'running' | 'retrying' | null
  detail: string
  at: string
}

const COLUMN_TO_STATE: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

const normalizeState = (state: string | undefined) => state?.trim().toLowerCase() ?? ''
const getIssueActionRef = (issue: IssueListItem): string =>
  issue.identifier || issue.issue_identifier || issue.issue_id || issue.id || ''

const normalizeSearchText = (value: string) =>
  value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

const matchesSearch = (query: string, fields: Array<string | undefined>) => {
  const tokens = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const searchable = normalizeSearchText(fields.filter(Boolean).join(' '))
  return tokens.every((token) => searchable.includes(token))
}

const DRAG_TYPE_KEY = 'application/x-orchestra-kanban-type'
const DRAG_ISSUE_KEY = 'application/x-orchestra-kanban-issue'
const DRAG_COLUMN_KEY = 'application/x-orchestra-kanban-column'

const EMPTY_ISSUES: IssueListItem[] = []
const EMPTY_PROJECTS: Project[] = []
const EMPTY_AGENTS: string[] = []
const SKELETON_ROW_KEYS = ['s1', 's2', 's3'] as const

// Columns and the list only virtualize past this size, so everyday boards keep
// plain DOM (and their CSS transitions) while thousands of tasks stay smooth.
const VIRTUALIZE_AT = 60

/** Renders only the visible cards of a long column; the scroll element is the column body. */
function VirtualCards<T>({ items, getKey, render }: { items: T[]; getKey: (item: T) => string; render: (item: T) => ReactNode }) {
  const anchorRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => anchorRef.current?.parentElement ?? null,
    estimateSize: () => 104,
    overscan: 8,
    getItemKey: (index) => getKey(items[index]),
  })
  return (
    <div ref={anchorRef} className="relative w-full shrink-0" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => (
        <div key={row.key} data-index={row.index} ref={virtualizer.measureElement} className="absolute left-0 top-0 w-full pb-1.5" style={{ transform: `translateY(${row.start}px)` }}>
          {render(items[row.index])}
        </div>
      ))}
    </div>
  )
}

/** Table-body rows for long lists, padded above and below so the scrollbar stays true. */
function VirtualTableRows<T>({ items, getKey, render, scrollRef, columns }: { items: T[]; getKey: (item: T) => string; render: (item: T) => ReactElement; scrollRef: RefObject<HTMLDivElement | null>; columns: number }) {
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 10,
    getItemKey: (index) => getKey(items[index]),
  })
  const rows = virtualizer.getVirtualItems()
  const top = rows[0]?.start ?? 0
  const bottom = virtualizer.getTotalSize() - (rows.at(-1)?.end ?? 0)
  return (
    <>
      {top > 0 && <tr aria-hidden="true"><td colSpan={columns} style={{ height: top, padding: 0 }} /></tr>}
      {rows.map((row) => (
        <Fragment key={row.key}>{cloneElement(render(items[row.index]) as ReactElement<Record<string, unknown>>, { ref: virtualizer.measureElement, 'data-index': row.index })}</Fragment>
      ))}
      {bottom > 0 && <tr aria-hidden="true"><td colSpan={columns} style={{ height: bottom, padding: 0 }} /></tr>}
    </>
  )
}

// Which columns a card may be dropped on, by source column.
const DRAG_TRANSITIONS: Record<string, string[]> = {
  backlog: ['todo'],
  todo: ['progress'],
  progress: [],      // Auto-moves to review on completion
  review: ['todo', 'done'],
  done: [],          // Terminal
}

/**
 * Hides the browser's drag preview. Chromium snapshots the card's area inside
 * the scrolling column (picking up neighbouring cards) and renders it
 * translucent, so the board draws its own preview that follows the pointer.
 */
let transparentDragImage: HTMLImageElement | null = null
function hideNativeDragImage(e: React.DragEvent) {
  if (typeof Image === 'undefined' || !e.dataTransfer.setDragImage) return
  if (!transparentDragImage) {
    transparentDragImage = new Image()
    transparentDragImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  }
  e.dataTransfer.setDragImage(transparentDragImage, 0, 0)
}

export function KanbanBoard({
  config,
  project,
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
  const [activeTab, setActiveTab] = useState<'board' | 'workitems'>('board')
  const selectedProjectID = useAppStore(s => s.selectedProjectID)
  const setSelectedProjectID = useAppStore(s => s.setSelectedProjectID)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const projectPickerTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!projectPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setProjectPickerOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setProjectPickerOpen(false)
        projectPickerTriggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [projectPickerOpen])

  const handleCreateClick = (columnId: string) => {
    if (columnId !== 'backlog') return
    if (!onCreateIssue) return
    onCreateIssue('Backlog')
  }

  const [stateFilter, setStateFilter] = useState<string>('all')
  const [projectFilter, setProjectFilter] = useState<string>(projects.length === 1 ? projects[0].id : 'all')
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')
  const [taskSearch, setTaskSearch] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [issueToDelete, setIssueToDelete] = useState<{ identifier: string; title?: string } | null>(null)
  const [deleteTaskPending, setDeleteTaskPending] = useState(false)
  const [deleteTaskError, setDeleteTaskError] = useState('')
  const [isDraggingOver, setIsDraggingOver] = useState<string | null>(null)
  const [dragValidationMsg, setDragValidationMsg] = useState<string | null>(null)
  const [columnOrder, setColumnOrder] = useState<string[]>(['backlog', 'todo', 'progress', 'review', 'done'])
  const [feedbackDialogTarget, setFeedbackDialogTarget] = useState<{ identifier: string; targetState: string } | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackPending, setFeedbackPending] = useState(false)
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null)
  const [draggingIssueId, setDraggingIssueId] = useState<string | null>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const [dragPreview, setDragPreview] = useState<{ item: EnrichedIssue; width: number; offsetX: number; offsetY: number; x: number; y: number } | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const feedbackId = useId()


  // "/" jumps to task search unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (!searchRef.current) return
      event.preventDefault()
      searchRef.current.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (projects.length === 1) {
      setProjectFilter(projects[0].id)
    }
  }, [projects])

  // Selecting a project elsewhere (sidebar, Work Items picker) narrows the board to it.
  const followedProjectId = useRef(project?.id)
  useEffect(() => {
    if (!project?.id || project.id === followedProjectId.current) return
    followedProjectId.current = project.id
    if (projects.some((candidate) => candidate.id === project.id)) setProjectFilter(project.id)
  }, [project?.id, projects])

  const isNoDragTarget = (target: EventTarget | null) => {
    return target instanceof Element && !!target.closest('[data-no-drag="true"]')
  }

  const handleDragStart = (e: React.DragEvent<HTMLElement>, issueIdentifier: string) => {
    if (isNoDragTarget(e.target)) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData(DRAG_ISSUE_KEY, issueIdentifier)
    e.dataTransfer.setData(DRAG_TYPE_KEY, 'issue')
    e.dataTransfer.effectAllowed = 'move'
    hideNativeDragImage(e)
    const rect = e.currentTarget.getBoundingClientRect()
    const item = enrichedIssues.find((candidate) => getIssueActionRef(candidate) === issueIdentifier)
    if (item) setDragPreview({ item, width: rect.width, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, x: rect.left, y: rect.top })
    // Defer so the drag has started before the source card dims.
    requestAnimationFrame(() => setDraggingIssueId(issueIdentifier))
  }

  // Move the preview with the pointer straight in the DOM, no re-render per frame.
  useEffect(() => {
    if (!dragPreview) return
    const { offsetX, offsetY } = dragPreview
    const onDragOver = (event: DragEvent) => {
      if (!event.clientX && !event.clientY) return
      const node = previewRef.current
      if (node) node.style.transform = `translate(${event.clientX - offsetX}px, ${event.clientY - offsetY}px)`
    }
    document.addEventListener('dragover', onDragOver)
    return () => document.removeEventListener('dragover', onDragOver)
  }, [dragPreview])

  const handleDragEnd = () => {
    setDragPreview(null)
    setDraggingIssueId(null)
    setDraggingColumnId(null)
    setIsDraggingOver(null)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    // dragleave also fires when moving onto a child; only clear on leaving the column.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
    setIsDraggingOver(null)
  }

  const handleColumnDragStart = (e: React.DragEvent, columnId: string) => {
    e.dataTransfer.setData(DRAG_COLUMN_KEY, columnId)
    e.dataTransfer.setData(DRAG_TYPE_KEY, 'column')
    setDraggingColumnId(columnId)
  }

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    if (dragSourceColumn && !dropTargets.includes(columnId)) {
      e.dataTransfer.dropEffect = 'none'
      setIsDraggingOver(null)
      return
    }
    setIsDraggingOver(columnId)
  }

  const handleDrop = async (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault()
    setIsDraggingOver(null)
    setDraggingColumnId(null)
    setDraggingIssueId(null)
    setDragPreview(null)

    const type = e.dataTransfer.getData(DRAG_TYPE_KEY)
    if (type === 'column') {
      const sourceColumnId = e.dataTransfer.getData(DRAG_COLUMN_KEY)
      if (!sourceColumnId || sourceColumnId === targetColumnId) return

      const newOrder = [...columnOrder]
      const sourceIdx = newOrder.indexOf(sourceColumnId)
      const targetIdx = newOrder.indexOf(targetColumnId)
      newOrder.splice(sourceIdx, 1)
      newOrder.splice(targetIdx, 0, sourceColumnId)
      setColumnOrder(newOrder)
      return
    }

    const issueIdentifier = e.dataTransfer.getData(DRAG_ISSUE_KEY)
    if (!issueIdentifier || !onIssueUpdate) return


    // Find the issue being dragged to determine its current column
    const issue = boardIssues.find((i) => getIssueActionRef(i) === issueIdentifier)
    if (!issue) return

    const currentColumnId = Object.entries(COLUMN_TO_STATE).find(
      ([, state]) => normalizeState(state) === normalizeState(issue.state),
    )?.[0] || ''
    if (currentColumnId === targetColumnId) return

    // Check if the transition is allowed
    const allowed = DRAG_TRANSITIONS[currentColumnId]
    if (!allowed || !allowed.includes(targetColumnId)) return

    // Backlog → Todo: validate required fields first
    if (currentColumnId === 'backlog' && targetColumnId === 'todo') {
      const missing = getBacklogMissingFields(issue)
      if (missing.length > 0) {
        setDragValidationMsg(`Cannot move to Todo — missing: ${missing.join(', ')}. Open the task to fill in required fields.`)
        setTimeout(() => setDragValidationMsg(null), 5000)
        return
      }
    }

    const nextState = COLUMN_TO_STATE[targetColumnId]
    if (!nextState) return

    // Review → Todo/In Progress: requires feedback via dialog
    if (currentColumnId === 'review' && (targetColumnId === 'todo' || targetColumnId === 'progress')) {
      setFeedbackText('')
      setFeedbackDialogTarget({ identifier: issueIdentifier, targetState: nextState })
      return
    }

    await onIssueUpdate(issueIdentifier, { state: nextState })
  }

  const enrichedIssues = boardIssues.map((issue) => {
    const issueID = issue.issue_id || issue.id || issue.identifier || issue.issue_identifier || ''
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
      issue_identifier: issue.identifier || issue.issue_identifier || issue.issue_id || issue.id,
      lane,
      detail,
      at,
    }
  })

  const filterItem = (item: EnrichedIssue) => {
    const stateMatch = stateFilter === 'all' || normalizeState(item.state) === normalizeState(stateFilter)
    const projectMatch = projectFilter === 'all' || item.project_id === projectFilter
    return stateMatch && projectMatch
  }

  const stateIs = (s: string, target: string) => normalizeState(s) === normalizeState(target)
  const visibleIssues = enrichedIssues.filter(filterItem)
  const backlogCandidates = visibleIssues.filter((i) => stateIs(i.state, 'Backlog'))
  const matchesTaskSearch = (item: EnrichedIssue) => {
    const assignee = item.assignee_id || ''
    const normalizedAssignee = assignee.replace(/^agent-/i, '')
    const projectName = projects.find((candidate) => candidate.id === item.project_id)?.name
    const assigneeKey = normalizeSearchText(assignee).replace(/^agent-/, '')
    const agentName = availableAgents.find((agent) => normalizeSearchText(agent).replace(/^agent-/, '') === assigneeKey)
    return matchesSearch(taskSearch, [
      item.title,
      item.description,
      item.issue_identifier,
      item.identifier,
      item.issue_id,
      item.id,
      assignee,
      normalizedAssignee,
      agentName,
      projectName,
      typeof item.provider === 'string' ? item.provider : undefined,
      item.last_message,
    ])
  }
  const backlogItems = backlogCandidates.filter(matchesTaskSearch)
  const searchedIssues = taskSearch.trim() ? visibleIssues.filter(matchesTaskSearch) : visibleIssues
  const todoItems = searchedIssues.filter((i) => stateIs(i.state, 'Todo'))
  const inProgressItems = searchedIssues.filter((i) => stateIs(i.state, 'In Progress'))
  const reviewItems = searchedIssues.filter((i) => stateIs(i.state, 'Review'))
  const doneItemsList = searchedIssues.filter((i) => stateIs(i.state, 'Done'))

  const columns: {
    id: string
    title: string
    items: EnrichedIssue[]
    dot: string
  }[] = [
    {
      id: 'backlog',
      title: 'Backlog',
      items: backlogItems,
      dot: 'bg-muted-foreground/40',
    },
    {
      id: 'todo',
      title: 'Planning',
      items: todoItems,
      dot: 'bg-foreground/60',
    },
    {
      id: 'progress',
      title: 'In Progress',
      items: inProgressItems,
      dot: 'bg-violet-500',
    },
    {
      id: 'review',
      title: 'Review',
      items: reviewItems,
      dot: 'bg-blue-500',
    },
    {
      id: 'done',
      title: 'Done',
      items: doneItemsList,
      dot: 'bg-emerald-500',
    },
  ]

  const orderedColumns = columnOrder.map((id) => columns.find((column) => column.id === id)!)
  const draggingItem = draggingIssueId ? enrichedIssues.find((item) => getIssueActionRef(item) === draggingIssueId) : undefined
  const dragSourceColumn = draggingItem ? Object.entries(COLUMN_TO_STATE).find(([, state]) => normalizeState(state) === normalizeState(draggingItem.state))?.[0] ?? '' : ''
  const dropTargets = dragSourceColumn ? DRAG_TRANSITIONS[dragSourceColumn] ?? [] : []
  const filteredList = enrichedIssues.filter((item) =>
    filterItem(item) && matchesTaskSearch(item),
  )

  const getActionIssueRef = (item: EnrichedIssue): string => getIssueActionRef(item)

  const getBacklogMissingFields = (item: Pick<IssueListItem, 'title' | 'description' | 'assignee_id' | 'project_id'>): string[] => {
    const missing: string[] = []
    if (!item.title?.trim()) missing.push('title')
    if (!item.description?.trim()) missing.push('description')
    if (!item.assignee_id?.trim() || item.assignee_id.trim().toLowerCase() === 'unassigned') missing.push('assignee')
    if (!item.project_id) missing.push('project')
    return missing
  }

  if (loadingState && enrichedIssues.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-0 gap-y-6">
        <div className="flex items-center gap-3 border-b border-border/40 pb-4 shrink-0">
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="h-8 w-40 rounded-md" />
        </div>
        <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 min-h-0">
        <div className="h-full grid gap-3 min-w-[640px]" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          {['backlog', 'todo', 'progress', 'review', 'done'].map((column) => (
            <div key={column} className="flex flex-col min-h-0 gap-y-4">
              <div className="flex items-center justify-between px-2 shrink-0">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-2 rounded-full" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
                <Skeleton className="h-4 w-6 rounded-full" />
              </div>
              <div className="flex-1 space-y-3 overflow-hidden p-1">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="bg-card/40 border border-border/50 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <Skeleton className="h-4 w-16 rounded" />
                      <Skeleton className="size-4 rounded-full" />
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
      </div>
    )
  }

  const activeProject = projects.find(p => p.id === selectedProjectID) ?? null

  const renderCard = (item: EnrichedIssue, column: { dot: string }) => (
      <div
        key={item.issue_id}
        draggable
        role="button"
        aria-label={`Task ${getActionIssueRef(item)}: ${item.title || item.description || 'Untitled'}`}
        data-testid={`kanban-task-${item.issue_id}`}
        tabIndex={0}
        onDragStart={(e) => handleDragStart(e, getActionIssueRef(item))}
        onDragEnd={handleDragEnd}
        className={`group relative cursor-grab rounded-lg border active:cursor-grabbing transition-[opacity,transform,box-shadow,border-color] duration-150 overflow-hidden ${draggingIssueId === getActionIssueRef(item) ? 'opacity-40 scale-[0.97] ' : ''}${
          item.lane === 'running'
            ? 'border-emerald-500/40 bg-emerald-500/[0.03] shadow-[0_0_12px_0_rgba(16,185,129,0.12)] hover:shadow-[0_0_16px_0_rgba(16,185,129,0.2)]'
            : item.lane === 'retrying'
            ? 'border-amber-500/40 bg-amber-500/[0.03] shadow-[0_0_10px_0_rgba(245,158,11,0.1)]'
            : item.state === 'In Progress'
            ? 'border-blue-500/20 bg-blue-500/[0.02]'
            : 'border-border/30 bg-card hover:border-border/60 hover:shadow-sm'
        }`}
        onClick={() => void onInspectIssue(getActionIssueRef(item))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            void onInspectIssue(getActionIssueRef(item))
          }
        }}
      >
        {/* Left accent */}
        <div className={`absolute left-0 top-0 bottom-0 w-[2px] ${
          item.lane === 'running'
            ? 'bg-emerald-500 animate-pulse'
            : item.lane === 'retrying'
            ? 'bg-amber-500 animate-pulse'
            : item.state === 'In Progress'
            ? 'bg-blue-400 opacity-40'
            : `${column.dot} opacity-60`
        }`} />

        <div className="pl-3 pr-2.5 pt-2.5 pb-2">
          {/* Top row: ID + actions */}
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className="font-mono text-[9px] font-semibold text-muted-foreground/30 tracking-wider">
              {item.issue_identifier}
            </span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" data-no-drag="true">
              {item.url && typeof item.url === 'string' && item.url.includes('github.com') && (
                <Github size={9} className="text-muted-foreground/30" />
              )}
              {item.state === 'Todo' && item.assignee_id && item.assignee_id !== 'Unassigned' && onIssueUpdate && (
                <AppTooltip content="Launch agent session">
                  <button type="button" data-no-drag="true" className="p-0.5 rounded hover:text-emerald-500 hover:bg-emerald-500/10 text-muted-foreground/40 transition-colors" onClick={(e) => { e.stopPropagation(); void onIssueUpdate(getActionIssueRef(item), { state: 'In Progress' }) }}>
                    <Play className="size-2.5 fill-current" />
                  </button>
                </AppTooltip>
              )}
              {item.state === 'In Progress' && onStopSession && (
                <AppTooltip content="Stop session">
                  <button type="button" data-no-drag="true" className="p-0.5 rounded hover:text-amber-500 hover:bg-amber-500/10 text-muted-foreground/40 transition-colors" onClick={(e) => { e.stopPropagation(); void onStopSession(getActionIssueRef(item)) }}>
                    <Square className="size-2 fill-current" />
                  </button>
                </AppTooltip>
              )}
              {onIssueDelete && (
                <AppTooltip content="Delete">
                  <button type="button" data-no-drag="true" aria-label={`Delete task ${item.issue_identifier}`} className="p-0.5 rounded hover:text-destructive hover:bg-destructive/10 text-muted-foreground/40 transition-colors" onClick={(e) => { e.stopPropagation(); setDeleteTaskError(''); setIssueToDelete({ identifier: getActionIssueRef(item), title: item.title }); setDeleteDialogOpen(true) }}>
                    <Trash2 className="size-2.5" />
                  </button>
                </AppTooltip>
              )}
            </div>
          </div>

          {/* Title */}
          <p className="line-clamp-2 text-[11.5px] font-medium leading-snug text-foreground/75 group-hover:text-foreground transition-colors mb-2.5">
            {item.title || item.description || item.last_message || item.error || 'Untitled'}
          </p>

          {/* Status ticker */}
          {item.lane === 'running' && (
            <div className="flex items-center gap-1.5 mb-2 overflow-hidden">
              <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <p className="text-[9px] text-emerald-600 dark:text-emerald-400 truncate font-medium">{item.detail}</p>
            </div>
          )}
          {item.lane === 'retrying' && (
            <div className="flex items-center gap-1.5 mb-2 overflow-hidden">
              <div className="size-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <p className="text-[9px] text-amber-600 dark:text-amber-400 truncate font-medium">{item.detail}</p>
            </div>
          )}
          {item.state === 'In Progress' && !item.lane && (
            <div className="flex items-center gap-1.5 mb-2">
              <div className="size-1.5 rounded-full bg-blue-400 shrink-0" />
              <p className="text-[9px] text-blue-400/60 font-medium">Queued</p>
            </div>
          )}

          {/* Backlog readiness indicator */}
          {stateIs(item.state, 'Backlog') && (() => {
            const missing = getBacklogMissingFields(item)
            if (missing.length === 0) return null
            return (
              <AppTooltip content={`Needs before queuing: ${missing.join(', ')}`}>
                <div className="flex items-center gap-1 mb-2 cursor-default" data-no-drag="true">
                  <AlertCircle className="size-2.5 text-amber-500/60 shrink-0" />
                  <span className="text-[8.5px] text-amber-500/60 font-medium truncate">Needs {missing.join(', ')}</span>
                </div>
              </AppTooltip>
            )
          })()}

          {/* Footer */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              {projects.length > 1 && item.project_id && (
                <span className="text-[9px] text-muted-foreground/30 truncate">
                  {projects.find(p => p.id === item.project_id)?.name}
                </span>
              )}
            </div>
            <div data-no-drag="true" className="shrink-0">
              <AgentSelector
                value={item.assignee_id || ''}
                agents={availableAgents}
                onChange={(value) => {
                  if (onIssueUpdate) {
                    void onIssueUpdate(getActionIssueRef(item), { assignee_id: value, provider: value.replace('agent-', '') })
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>
  )
  const renderRow = (item: EnrichedIssue) => (
        <tr
          key={item.issue_id}
          className="group hover:bg-muted/30 transition-colors cursor-pointer"
          onClick={() => void onInspectIssue(getActionIssueRef(item))}
        >
          <td className="p-4 whitespace-nowrap">
            <span className="font-mono text-xs font-bold text-primary">{item.issue_identifier}</span>
          </td>
          <td className="p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                {item.title || item.detail || 'No Title'}
              </span>
              {item.lane === 'running' && (
                <AppTooltip content="Live session">
                  <div className="size-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                </AppTooltip>
              )}
            </div>
          </td>
          <td className="p-4">
            <AgentSelector
              value={item.assignee_id || ''}
              agents={availableAgents}
              onChange={(value) => {
                if (onIssueUpdate) {
                    const agentName = value.replace('agent-', '')
                    void onIssueUpdate(getActionIssueRef(item), { assignee_id: value, provider: agentName })
                }
              }}
            />
          </td>
          <td className="p-4 whitespace-nowrap">
            <div className="flex items-center gap-2">
              <div className={`size-1.5 rounded-full ${item.state === 'Done' ? 'bg-primary' : item.state === 'In Progress' ? 'bg-amber-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
              <span className="text-xs font-medium text-muted-foreground">{item.state}</span>
            </div>
          </td>
          <td className="px-2 py-4 text-right">
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
                  <Play className="size-3.5 fill-current" />
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
                  <Square className="size-3 fill-current" />
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
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          </td>
        </tr>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-y-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 pt-4 shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          {activeTab === 'board' && projects.length > 1 && (
            <CustomDropdown
              className="w-56"
              value={projectFilter}
              options={[
                { label: 'All Projects', value: 'all', icon: <FolderTree className="size-3" /> },
                ...projects.map((project) => ({ label: project.name, value: project.id, icon: <Folder className="size-3" /> })),
              ]}
              onChange={setProjectFilter}
            />
          )}
        {activeTab === 'workitems' && projects.length > 0 && (
          <div className="relative" ref={pickerRef}>
            <button
              ref={projectPickerTriggerRef}
              onClick={() => setProjectPickerOpen(v => !v)}
              aria-label="Choose work items project"
              aria-haspopup="listbox"
              aria-expanded={projectPickerOpen}
              className="h-8 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 border border-border/40 bg-background hover:bg-foreground/[0.04] text-foreground/80 transition-colors"
            >
              <Folder size={12} className="text-muted-foreground/60 shrink-0" />
              <span className="max-w-[160px] truncate">{activeProject?.name ?? 'Select project'}</span>
              <ChevronDown size={11} className="text-muted-foreground/50 shrink-0" />
            </button>

            {projectPickerOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] max-w-[280px] rounded-lg border border-border/40 bg-popover shadow-lg overflow-hidden">
                {projects.map((p, idx) => (
                  <button
                    key={p.id}
                    onClick={() => { setSelectedProjectID(p.id); setProjectPickerOpen(false); projectPickerTriggerRef.current?.focus() }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-foreground/[0.04] transition-colors ${idx > 0 ? 'border-t border-border/20' : ''} ${p.id === selectedProjectID ? 'bg-foreground/[0.06]' : ''}`}
                  >
                    <span className={`size-1.5 rounded-full shrink-0 ${p.id === selectedProjectID ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    <span className="text-[12px] font-medium text-foreground/85 truncate flex-1">{p.name}</span>
                    {p.issue_source_type && (
                      <span className="text-[10px] text-muted-foreground/50 shrink-0 font-mono">{p.issue_source_type}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        </div>
        <div className="flex min-w-0 justify-center">
          {activeTab === 'board' && (
            <div className="group/search relative w-64 sm:w-[26rem]">
              <div className="flex h-9 items-center gap-2 rounded-xl border border-border/40 bg-muted/25 px-3 shadow-sm shadow-black/[0.03] transition-all duration-200 hover:border-border/70 hover:bg-muted/40 focus-within:border-primary/40 focus-within:bg-background focus-within:shadow-md focus-within:ring-4 focus-within:ring-primary/10">
                <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/45 transition-colors group-focus-within/search:text-primary" />
                <input
                  ref={searchRef}
                  type="search"
                  aria-label="Search tasks"
                  placeholder="Search tasks, IDs, agents, projects…"
                  autoComplete="off"
                  spellCheck={false}
                  value={taskSearch}
                  onChange={(event) => setTaskSearch(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      if (taskSearch) setTaskSearch('')
                      else event.currentTarget.blur()
                    }
                  }}
                  className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 [&::-webkit-search-cancel-button]:hidden"
                />
                {taskSearch.trim() ? (
                  <span aria-live="polite" className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary animate-in fade-in duration-150">
                    {searchedIssues.length} of {visibleIssues.length}
                  </span>
                ) : (
                  <kbd aria-hidden="true" className="shrink-0 rounded-md border border-border/50 bg-background/70 px-1.5 py-px font-mono text-[10px] text-muted-foreground/55 transition-opacity group-focus-within/search:opacity-0">/</kbd>
                )}
                {taskSearch && (
                  <button
                    type="button"
                    aria-label="Clear task search"
                    onClick={() => { setTaskSearch(''); searchRef.current?.focus() }}
                    className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('board')}
            className={`h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${activeTab === 'board' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'}`}
          >
            Board
          </button>
          <button
            onClick={() => setActiveTab('workitems')}
            className={`h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${activeTab === 'workitems' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'}`}
          >
            Work Items
          </button>
          </div>
          <button
            onClick={() => handleCreateClick('backlog')}
            className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[12px] font-semibold tracking-tight transition-colors"
          >
            <Plus size={13} />
            Create Task
          </button>
          {activeTab === 'board' && (
            <>
            {viewMode === 'list' && (
              <CustomDropdown
                className="w-40"
                value={stateFilter}
                options={[
                  { label: 'All States', value: 'all', icon: <CircleDashed className="size-3" /> },
                  { label: 'Backlog', value: 'Backlog', icon: <div className="size-1.5 rounded-full bg-muted-foreground/40" /> },
                  { label: 'Planning', value: 'Todo', icon: <div className="size-1.5 rounded-full bg-muted-foreground" /> },
                  { label: 'In Progress', value: 'In Progress', icon: <div className="size-1.5 rounded-full bg-amber-500" /> },
                  { label: 'Review', value: 'Review', icon: <div className="size-1.5 rounded-full bg-blue-500" /> },
                  { label: 'Done', value: 'Done', icon: <div className="size-1.5 rounded-full bg-primary" /> },
                ]}
                onChange={setStateFilter}
              />
            )}
            <div className="flex items-center rounded-md bg-muted/30 p-0.5">
              <AppTooltip content="Board view">
                <button
                  aria-label="Board view"
                  onClick={() => setViewMode('board')}
                  className={`grid h-7 w-8 place-items-center rounded transition-colors ${viewMode === 'board' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/60 hover:text-foreground'}`}
                >
                  <Layout className="size-3.5" />
                </button>
              </AppTooltip>
              <AppTooltip content="List view">
                <button
                  aria-label="List view"
                  onClick={() => setViewMode('list')}
                  className={`grid h-7 w-8 place-items-center rounded transition-colors ${viewMode === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/60 hover:text-foreground'}`}
                >
                  <Rows className="size-3.5" />
                </button>
              </AppTooltip>
            </div>
            </>
          )}
        </div>
      </div>

      {activeTab === 'workitems' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          {!activeProject ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <FolderTree size={32} className="text-muted-foreground/30" strokeWidth={1.5} />
              <p className="text-[13px] font-medium text-foreground/60">No project selected</p>
              <p className="text-[12px] text-muted-foreground/50 max-w-xs">
                Pick a project from the dropdown above to browse its issue source.
              </p>
            </div>
          ) : !activeProject.issue_source_type ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <FolderTree size={32} className="text-muted-foreground/30" strokeWidth={1.5} />
              <p className="text-[13px] font-medium text-foreground/60">{activeProject.name} has no issue source</p>
              <p className="text-[12px] text-muted-foreground/50 max-w-xs">
                Open this project in Projects, click <span className="font-mono bg-muted/60 px-1 rounded">Source</span> in the toolbar, and configure a tracker connection.
              </p>
            </div>
          ) : (
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground/50">Loading…</div>}>
              <TrackerViewer config={config} project={activeProject} />
            </Suspense>
          )}
        </div>
      ) : null}

      {activeTab === 'board' ? (
        <>
      {dragValidationMsg && (
        <div className="mx-4 mb-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[11px] font-bold animate-in fade-in slide-in-from-top-2 duration-300">
          {dragValidationMsg}
        </div>
      )}

      {viewMode === 'board' ? (
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-4 pb-4">
        <div className="h-full grid gap-px min-w-[640px]" style={{ gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))' }}>
          {orderedColumns.map((column) => (
            <div
              key={column.id}
              id={`kanban-column-${column.id}`}
              data-testid={`kanban-column-${column.id}`}
              className={`flex flex-col min-h-0 transition-opacity duration-200 ${draggingColumnId === column.id || (dragSourceColumn && column.id !== dragSourceColumn && !dropTargets.includes(column.id)) ? 'opacity-30' : ''}`}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              {/* Column header */}
              <div
                className="flex cursor-grab items-center gap-2 p-3 active:cursor-grabbing shrink-0"
                draggable
                onDragStart={(e) => handleColumnDragStart(e, column.id)}
                onDragEnd={handleDragEnd}
              >
                <span className={`block size-2 rounded-full shrink-0 ${column.dot}`} />
                <span className="text-[9px] font-semibold uppercase tracking-widest text-foreground/40 flex-1 truncate">{column.title}</span>
                {column.items.length > 0 && (
                  <span className="text-[10px] font-medium tabular-nums text-muted-foreground/35 bg-muted/50 px-1.5 py-0.5 rounded-full leading-none">{column.items.length}</span>
                )}
              </div>

              {/* Column body */}
              <div className={`flex-1 min-h-0 flex flex-col mx-1 mb-1 rounded-xl overflow-hidden transition-all ${
                isDraggingOver === column.id
                  ? 'ring-2 ring-primary/60 bg-primary/[0.07]'
                  : dropTargets.includes(column.id)
                  ? 'ring-1 ring-primary/30 bg-primary/[0.03]'
                  : 'bg-muted/[0.03]'
              }`}>
                <div className="flex-1 flex flex-col gap-1.5 p-2 min-h-0 overflow-y-auto overflow-x-hidden">
                  {isDraggingOver === column.id && dropTargets.includes(column.id) && (
                    <div className="shrink-0 grid h-14 place-items-center rounded-lg border border-dashed border-primary/50 bg-primary/[0.06] text-[10.5px] font-medium text-primary/80 animate-in fade-in zoom-in-95 duration-150">
                      Move to {column.title}
                    </div>
                  )}
                  {loadingState ? (
                    SKELETON_ROW_KEYS.map((k) => <Skeleton key={k} className="h-20 w-full rounded-lg" />)
                  ) : column.items.length === 0 ? (
                    taskSearch.trim() ? (
                      <div className="flex min-h-full flex-col items-center justify-center gap-2 px-3 text-center">
                        <Search className="size-4 text-muted-foreground/35" aria-hidden="true" />
                        <p className="text-[10px] font-medium text-muted-foreground/55">No tasks match “{taskSearch.trim()}”</p>
                        <button
                          type="button"
                          onClick={() => setTaskSearch('')}
                          className="text-[10px] font-semibold text-primary hover:underline"
                        >
                          Clear search
                        </button>
                      </div>
                    ) : column.id === 'backlog' ? (
                      <button
                        type="button"
                        className="w-full min-h-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/30 hover:border-border/60 hover:bg-foreground/[0.02] transition-all group/empty"
                        onClick={() => handleCreateClick(column.id)}
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
                    column.items.length > VIRTUALIZE_AT
                      ? <VirtualCards items={column.items} getKey={(item) => item.issue_id} render={(item) => renderCard(item, column)} />
                      : column.items.map((item) => renderCard(item, column))
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        </div>
      ) : (
        <div className="flex-1 rounded-xl border bg-card/50 shadow-lg overflow-hidden min-h-0 flex flex-col mx-4">
          {filteredList.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-muted-foreground/40">
              <ClipboardList className="size-12 mb-4 opacity-20" />
              <p className="text-sm italic uppercase tracking-widest font-bold">{taskSearch.trim() ? `No tasks match “${taskSearch.trim()}”` : 'No tasks match current filters'}</p>
            </div>
          ) : (
            <div ref={listScrollRef} className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-muted/80 backdrop-blur text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                    <th className="px-4 py-3 w-24">ID</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3 w-32">Assignee</th>
                    <th className="px-4 py-3 w-28">Status</th>
                    <th className="px-4 py-3 w-20 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredList.length > VIRTUALIZE_AT
                    ? <VirtualTableRows items={filteredList} getKey={(item) => item.issue_id} render={renderRow} scrollRef={listScrollRef} columns={5} />
                    : filteredList.map(renderRow)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Feedback dialog: Review → Todo / In Progress */}
      <Dialog open={!!feedbackDialogTarget} onOpenChange={(open) => { if (!open) { setFeedbackDialogTarget(null); setFeedbackText('') } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Provide Feedback</DialogTitle>
            <DialogDescription>
              Moving from Review back to {feedbackDialogTarget?.targetState === 'Todo' ? 'Planning' : 'In Progress'} requires feedback explaining what needs to change.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label htmlFor={feedbackId} className="text-xs font-semibold text-muted-foreground mb-1.5 block">Feedback</label>
            <textarea
              id={feedbackId}
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Describe what needs to be fixed or changed…"
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setFeedbackDialogTarget(null); setFeedbackText('') }} disabled={feedbackPending}>Cancel</Button>
            <Button
              disabled={!feedbackText.trim() || feedbackPending}
              onClick={async () => {
                if (!feedbackDialogTarget || !onIssueUpdate) return
                setFeedbackPending(true)
                try {
                  await onIssueUpdate(feedbackDialogTarget.identifier, {
                    state: feedbackDialogTarget.targetState,
                    feedback: feedbackText.trim(),
                  })
                  setFeedbackDialogTarget(null)
                  setFeedbackText('')
                } finally {
                  setFeedbackPending(false)
                }
              }}
            >
              {feedbackPending ? 'Moving…' : `Move to ${feedbackDialogTarget?.targetState === 'Todo' ? 'Planning' : 'In Progress'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="size-5" />
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
              <Trash2 className="size-4 mr-2" />
              {deleteTaskPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      ) : null}
      {dragPreview && createPortal(
        <div ref={previewRef} aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[9999]"
          style={{ width: dragPreview.width, transform: `translate(${dragPreview.x}px, ${dragPreview.y}px)` }}>
          <div className="rotate-[1.5deg] scale-[1.03] rounded-lg border border-primary/40 bg-card px-3 py-2.5 shadow-2xl shadow-black/40 ring-1 ring-primary/20 animate-in zoom-in-95 duration-100">
            <span className="font-mono text-[9px] font-semibold tracking-wider text-muted-foreground/50">{dragPreview.item.issue_identifier}</span>
            <p className="mt-1 line-clamp-2 text-[12px] font-semibold leading-snug text-foreground">{dragPreview.item.title || dragPreview.item.description || 'Untitled'}</p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
