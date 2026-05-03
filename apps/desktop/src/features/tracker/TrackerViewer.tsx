import { useState } from 'react'
import type { BackendConfig } from '@core/api/client'
import type { WorkItem, WorkItemFilter } from '@/entities/tracker/types'
import type { Project } from '@core/api/types'
import { useTrackerWorkItems } from '@/entities/tracker/use-tracker-work-items'
import { WorkItemBrowser } from './WorkItemBrowser'
import { WorkItemDetail } from './WorkItemDetail'
import { Cable } from 'lucide-react'

interface Props {
  config: BackendConfig | null
  project: Project | null
}

/**
 * Two-pane issue browser scoped to the selected project's issue source.
 * Shows an empty-state prompt when no project is selected or the project
 * has no issue source configured.
 */
export function TrackerViewer({ config, project }: Props) {
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null)
  const [filter, setFilter] = useState<WorkItemFilter>({})

  const hasSource = !!project?.issue_source_type

  const { items, loading, error, refresh } = useTrackerWorkItems(
    hasSource ? config : null,
    null,
    filter,
    hasSource ? project!.id : null,
  )

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/40">
        <Cable size={28} strokeWidth={1.5} />
        <p className="text-[13px] font-medium">No project selected</p>
        <p className="text-[11px]">Open a project to browse its issues</p>
      </div>
    )
  }

  if (!hasSource) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/40">
        <Cable size={28} strokeWidth={1.5} />
        <p className="text-[13px] font-medium">{project.name} has no issue source</p>
        <p className="text-[11px] text-center max-w-xs leading-relaxed">
          Open the project, click <span className="font-mono bg-muted/50 px-1 rounded text-[10px]">Source</span> in the toolbar, and configure a tracker connection.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background shrink-0">
        <Cable size={13} className="text-primary shrink-0" />
        <span className="text-[13px] font-semibold truncate">{project.name}</span>
        <span className="text-[11px] text-muted-foreground/60 font-mono">{project.issue_source_type}</span>
        <div className="flex-1" />
        <button
          onClick={refresh}
          className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted/40"
        >
          Refresh
        </button>
        {error && (
          <span className="text-[11px] text-destructive">Failed to load issues</span>
        )}
      </div>

      {/* Two-pane body */}
      <div className="flex flex-1 min-h-0">
        <div className="w-72 flex-shrink-0 border-r border-border overflow-hidden">
          <WorkItemBrowser
            items={items}
            loading={loading}
            selectedId={selectedItem?.id ?? null}
            onSelect={setSelectedItem}
            filter={filter}
            onFilterChange={setFilter}
          />
        </div>
        <div className="flex-1 overflow-hidden">
          <WorkItemDetail item={selectedItem} />
        </div>
      </div>
    </div>
  )
}
