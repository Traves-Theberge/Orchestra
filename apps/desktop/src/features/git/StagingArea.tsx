import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, Plus, Minus, RotateCcw } from 'lucide-react'
import type { GitStatusEntry } from '@core/api/client'

/* ------------------------------------------------------------------ */
/*  Status meta                                                        */
/* ------------------------------------------------------------------ */

const statusMeta: Record<string, { color: string; label: string }> = {
  M: { color: 'text-amber-500', label: 'Modified' },
  A: { color: 'text-emerald-500', label: 'Added' },
  D: { color: 'text-destructive', label: 'Deleted' },
  R: { color: 'text-blue-500', label: 'Renamed' },
  '?': { color: 'text-emerald-400', label: 'Untracked' },
}

function metaFor(status: string) {
  return statusMeta[status] ?? { color: 'text-muted-foreground/70', label: status }
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface StagingAreaProps {
  unstaged: GitStatusEntry[]
  staged: GitStatusEntry[]
  selectedFile: string | null
  onFileSelect: (path: string, staged: boolean) => void
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  onStageAll: () => void
  onUnstageAll: () => void
}

/* ------------------------------------------------------------------ */
/*  File row                                                           */
/* ------------------------------------------------------------------ */

function FileRow({
  entry,
  id,
  isStaged,
  isSelected,
  onSelect,
  onAction,
}: {
  entry: GitStatusEntry
  id: string
  isStaged: boolean
  isSelected: boolean
  onSelect: () => void
  onAction: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const meta = metaFor(entry.status)
  const isDeleted = entry.status === 'D'
  const filename = entry.path.split('/').pop() ?? entry.path
  const dirname = entry.path.includes('/') ? entry.path.slice(0, -filename.length - 1) : ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      data-testid={`file-row-${isStaged ? 'staged' : 'unstaged'}-${entry.path}`}
      data-selected={isSelected ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`group flex items-center gap-2 h-6 px-3 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-foreground/[0.06] text-foreground'
          : 'text-foreground/85 hover:bg-foreground/[0.03]'
      }`}
      title={entry.path}
    >
      <span data-file-path={entry.path} className={`min-w-0 flex-1 truncate text-[12px] font-mono leading-none ${isDeleted ? 'line-through text-muted-foreground/60' : ''}`}>
        {filename}
        {dirname && (
          <span className="ml-1.5 text-muted-foreground/40">{dirname}</span>
        )}
      </span>

      <span className="shrink-0 flex items-center gap-0">
        <button
          onClick={(e) => { e.stopPropagation(); onAction() }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`hidden group-hover:inline-flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors`}
          title={isStaged ? 'Unstage' : 'Stage'}
        >
          {isStaged ? <Minus size={11} strokeWidth={2.5} /> : <Plus size={11} strokeWidth={2.5} />}
        </button>
        {!isStaged && (
          <button
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="hidden group-hover:inline-flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
            title="Discard changes"
          >
            <RotateCcw size={10} strokeWidth={2.25} />
          </button>
        )}
        <span
          data-testid="status-badge"
          className={`inline-flex items-center justify-center w-4 text-[10.5px] font-bold tabular-nums shrink-0 ${meta.color}`}
          title={meta.label}
        >
          {entry.status}
        </span>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Ghost                                                              */
/* ------------------------------------------------------------------ */

function GhostCard({ entry }: { entry: GitStatusEntry }) {
  const meta = metaFor(entry.status)
  const filename = entry.path.split('/').pop() ?? entry.path
  return (
    <div className="inline-flex items-center gap-2 h-6 px-3 bg-popover border border-border/60 rounded-md shadow-xl">
      <span className={`text-[10.5px] font-bold w-3 ${meta.color}`}>{entry.status}</span>
      <span className="text-[12px] font-mono text-foreground/90 truncate">{filename}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Droppable zone                                                     */
/* ------------------------------------------------------------------ */

function DroppableZone({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`${className ?? ''} ${isOver ? 'bg-primary/[0.04]' : ''} transition-colors`}>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Section header                                                     */
/* ------------------------------------------------------------------ */

function SectionHeader({
  label,
  count,
  collapsed,
  onToggle,
  actionLabel,
  onAction,
  countTestId,
}: {
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
  actionLabel?: string
  onAction?: () => void
  countTestId?: string
}) {
  return (
    <div className="group/header sticky top-0 z-10 flex items-center h-7 pr-2 bg-background border-b border-border/20">
      <button
        onClick={onToggle}
        className="flex-1 flex items-center gap-1.5 h-7 pl-2.5 pr-1 text-left transition-colors hover:bg-foreground/[0.02]"
      >
        {collapsed
          ? <ChevronRight size={11} className="text-muted-foreground/55 shrink-0" strokeWidth={2.25} />
          : <ChevronDown size={11} className="text-muted-foreground/55 shrink-0" strokeWidth={2.25} />}
        <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">{label}</span>
        <span data-testid={countTestId} className="text-[10.5px] font-medium tabular-nums text-muted-foreground/40">{count}</span>
      </button>
      {actionLabel && onAction && count > 0 && (
        <button
          onClick={onAction}
          className="opacity-0 group-hover/header:opacity-100 inline-flex items-center h-6 px-2 rounded text-[10.5px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-all"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export function StagingArea({
  unstaged,
  staged,
  selectedFile,
  onFileSelect,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
}: StagingAreaProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [stagedCollapsed, setStagedCollapsed] = useState(false)
  const [unstagedCollapsed, setUnstagedCollapsed] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const unstagedIds = unstaged.map((e) => `unstaged-${e.path}`)
  const stagedIds = staged.map((e) => `staged-${e.path}`)

  function findEntry(id: string): GitStatusEntry | undefined {
    if (id.startsWith('unstaged-')) {
      const path = id.slice('unstaged-'.length)
      return unstaged.find((e) => e.path === path)
    }
    if (id.startsWith('staged-')) {
      const path = id.slice('staged-'.length)
      return staged.find((e) => e.path === path)
    }
    return undefined
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)

    const fromStaged = activeIdStr.startsWith('staged-')
    const toStaged = overIdStr.startsWith('staged-') || overIdStr === 'staged-zone'
    const toUnstaged = overIdStr.startsWith('unstaged-') || overIdStr === 'unstaged-zone'

    const path = activeIdStr.replace(/^(unstaged-|staged-)/, '')

    if (!fromStaged && toStaged) onStage(path)
    else if (fromStaged && toUnstaged) onUnstage(path)
  }

  const activeEntry = activeId ? findEntry(activeId) : undefined
  const totalChanges = staged.length + unstaged.length

  if (totalChanges === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 bg-background">
        <p className="text-[12px] text-muted-foreground/45">No changes.</p>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full overflow-y-auto bg-background">
        {/* Staged */}
        <SectionHeader
          label="Staged"
          count={staged.length}
          collapsed={stagedCollapsed}
          onToggle={() => setStagedCollapsed((v) => !v)}
          actionLabel="Unstage all"
          onAction={onUnstageAll}
          countTestId="staged-count"
        />
        {!stagedCollapsed && (
          <DroppableZone id="staged-zone" className="py-0.5">
            <SortableContext items={stagedIds} strategy={verticalListSortingStrategy}>
              {staged.map((entry) => (
                <FileRow
                  key={`staged-${entry.path}`}
                  id={`staged-${entry.path}`}
                  entry={entry}
                  isStaged
                  isSelected={selectedFile === entry.path}
                  onSelect={() => onFileSelect(entry.path, true)}
                  onAction={() => onUnstage(entry.path)}
                />
              ))}
            </SortableContext>
            {staged.length === 0 && (
              <p className="px-3 py-1.5 text-[11px] text-muted-foreground/40">Nothing staged.</p>
            )}
          </DroppableZone>
        )}

        {/* Changes (unstaged) */}
        <SectionHeader
          label="Changes"
          count={unstaged.length}
          collapsed={unstagedCollapsed}
          onToggle={() => setUnstagedCollapsed((v) => !v)}
          actionLabel="Stage all"
          onAction={onStageAll}
          countTestId="unstaged-count"
        />
        {!unstagedCollapsed && (
          <DroppableZone id="unstaged-zone" className="py-0.5">
            <SortableContext items={unstagedIds} strategy={verticalListSortingStrategy}>
              {unstaged.map((entry) => (
                <FileRow
                  key={`unstaged-${entry.path}`}
                  id={`unstaged-${entry.path}`}
                  entry={entry}
                  isStaged={false}
                  isSelected={selectedFile === entry.path}
                  onSelect={() => onFileSelect(entry.path, false)}
                  onAction={() => onStage(entry.path)}
                />
              ))}
            </SortableContext>
            {unstaged.length === 0 && (
              <p className="px-3 py-1.5 text-[11px] text-muted-foreground/40">No changes in working tree.</p>
            )}
          </DroppableZone>
        )}
      </div>

      <DragOverlay>{activeEntry ? <GhostCard entry={activeEntry} /> : null}</DragOverlay>
    </DndContext>
  )
}
