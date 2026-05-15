import { CircleDashed, Folder, FolderTree, Layout, Plus, Rows } from 'lucide-react'

import { AppTooltip } from '@ui/tooltip-wrapper'
import { CustomDropdown } from '@layout/shared/controls'
import type { Project } from '@core/api/types'

type Props = {
  viewMode: 'board' | 'list'
  stateFilter: string
  projectFilter: string
  projects: Project[]
  onCreateClick: () => void
  onStateFilterChange: (value: string) => void
  onProjectFilterChange: (value: string) => void
  onViewModeChange: (mode: 'board' | 'list') => void
}

export function BoardToolbar({
  viewMode,
  stateFilter,
  projectFilter,
  projects,
  onCreateClick,
  onStateFilterChange,
  onProjectFilterChange,
  onViewModeChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onCreateClick}
          className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[12px] font-semibold tracking-tight transition-colors"
        >
          <Plus size={13} />
          Create Task
        </button>
        {viewMode === 'list' && (
          <CustomDropdown
            className="w-40"
            value={stateFilter}
            options={[
              { label: 'All States', value: 'all', icon: <CircleDashed className="size-3" /> },
              { label: 'Backlog', value: 'Backlog', icon: <div className="size-1.5 rounded-full bg-muted-foreground/40" /> },
              { label: 'Todo', value: 'Todo', icon: <div className="size-1.5 rounded-full bg-muted-foreground" /> },
              { label: 'In Progress', value: 'In Progress', icon: <div className="size-1.5 rounded-full bg-amber-500" /> },
              { label: 'Review', value: 'Review', icon: <div className="size-1.5 rounded-full bg-blue-500" /> },
              { label: 'Done', value: 'Done', icon: <div className="size-1.5 rounded-full bg-primary" /> },
            ]}
            onChange={onStateFilterChange}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        {projects.length > 1 && (
          <CustomDropdown
            className="w-56"
            value={projectFilter}
            options={[
              { label: 'All Projects', value: 'all', icon: <FolderTree className="size-3" /> },
              ...projects.map((project) => ({ label: project.name, value: project.id, icon: <Folder className="size-3" /> })),
            ]}
            onChange={onProjectFilterChange}
          />
        )}
        <div className="flex items-center rounded-md bg-muted/30 p-0.5">
          <AppTooltip content="Board view">
            <button
              onClick={() => onViewModeChange('board')}
              className={`grid h-7 w-8 place-items-center rounded transition-colors ${viewMode === 'board' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/60 hover:text-foreground'}`}
            >
              <Layout className="size-3.5" />
            </button>
          </AppTooltip>
          <AppTooltip content="List view">
            <button
              onClick={() => onViewModeChange('list')}
              className={`grid h-7 w-8 place-items-center rounded transition-colors ${viewMode === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/60 hover:text-foreground'}`}
            >
              <Rows className="size-3.5" />
            </button>
          </AppTooltip>
        </div>
      </div>
    </div>
  )
}
