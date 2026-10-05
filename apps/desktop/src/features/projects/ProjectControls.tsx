// Adapted from T3 Code SidebarThreadHeader (MIT, T3 Tools Inc.).
// See docs/licenses/t3-code-project-controls.txt for the complete notice.
import { FolderPlus, Search, SquarePen } from 'lucide-react'
import type { Project } from '@core/api/types'
import { AppTooltip } from '@ui/tooltip-wrapper'

export function ProjectControls({ projects, query, onQueryChange, onAddProject, onNewTask }: {
  projects: Project[]
  query: string
  onQueryChange: (query: string) => void
  onSelect: (id: string) => void
  onAddProject: () => void
  onNewTask: () => void
}) {
  const iconButton = 'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary'
  return <div className="relative flex items-center gap-1">
    <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-muted-foreground/60 hover:bg-muted/30">
      <Search className="size-4 shrink-0" /><input type="search" aria-label="Search projects" placeholder="Search" value={query} onChange={event => onQueryChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60" />
    </div>
    <AppTooltip content="Add project"><button type="button" aria-label="Add project" className={iconButton} onClick={onAddProject}><FolderPlus className="size-4" /></button></AppTooltip>
    <AppTooltip content="New task"><button type="button" aria-label="New task" className={iconButton} disabled={projects.length === 0} onClick={onNewTask}><SquarePen className="size-4" /></button></AppTooltip>
  </div>
}
