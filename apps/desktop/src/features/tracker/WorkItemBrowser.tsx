import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { Badge } from '@ui/badge'
import type { WorkItem, WorkItemFilter, WorkItemSource } from '@/entities/tracker/types'

const SOURCE_BADGE_CLASS: Record<WorkItemSource, string> = {
  github: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  linear: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  jira: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  sqlite: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  memory: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
}

const PRIORITY_LABEL: Record<number, string> = {
  0: '',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

interface Props {
  items: WorkItem[]
  loading?: boolean
  selectedId: string | null
  onSelect: (item: WorkItem) => void
  filter: WorkItemFilter
  onFilterChange: (filter: WorkItemFilter) => void
}

/**
 * Tracker-agnostic browse list. Renders any WorkItem regardless of source.
 * Search is client-side over title and identifier; state filter is applied
 * after server-side filtering (which already restricted by states if any).
 *
 * Note: Uses native scrolling (no virtualisation). Suitable for typical
 * tracker response sizes (~100–500 items). Virtualisation can be added
 * later via react-virtual if needed.
 */
export function WorkItemBrowser({
  items,
  loading = false,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
}: Props) {
  const filtered = useMemo(() => {
    let out = items
    if (filter.search) {
      const q = filter.search.toLowerCase()
      out = out.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.identifier.toLowerCase().includes(q),
      )
    }
    if (filter.labels?.length) {
      out = out.filter((i) =>
        filter.labels!.some((l) => i.labels.includes(l)),
      )
    }
    if (filter.assigneeId) {
      out = out.filter(
        (i) =>
          i.assignee_id === filter.assigneeId ||
          i.assignees.includes(filter.assigneeId!),
      )
    }
    return out
  }, [items, filter])

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search title or identifier…"
            value={filter.search ?? ''}
            onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
            className="w-full pl-7 pr-2 py-1.5 text-sm bg-background rounded border border-border focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto">
        {loading && filtered.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground text-center">Loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground text-center">
            {items.length === 0 ? 'No items' : 'No matches'}
          </div>
        )}
        {filtered.map((item) => {
          const selected = selectedId === item.id
          const sourceClass =
            SOURCE_BADGE_CLASS[item.source as WorkItemSource] ?? SOURCE_BADGE_CLASS.memory
          const priorityLabel = PRIORITY_LABEL[item.priority] ?? ''

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={[
                'w-full text-left px-3 py-2.5 border-b border-border transition-colors hover:bg-muted/50',
                selected ? 'bg-muted/50 border-l-2 border-l-primary' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {/* Row 1: identifier + source badge */}
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {item.identifier}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-px rounded border font-medium ${sourceClass}`}
                >
                  {item.source}
                </span>
              </div>

              {/* Row 2: title */}
              <div className="text-sm font-medium leading-snug truncate">{item.title}</div>

              {/* Row 3: state, priority, labels */}
              <div className="flex items-center flex-wrap gap-1.5 mt-1">
                <span className="text-xs text-muted-foreground">{item.state}</span>
                {priorityLabel && (
                  <span className="text-xs text-muted-foreground">· {priorityLabel}</span>
                )}
                {item.labels.slice(0, 3).map((l) => (
                  <Badge
                    key={l}
                    variant="secondary"
                    className="text-[10px] px-1 py-0 h-4 font-normal"
                  >
                    {l}
                  </Badge>
                ))}
                {item.labels.length > 3 && (
                  <span className="text-xs text-muted-foreground">
                    +{item.labels.length - 3}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
