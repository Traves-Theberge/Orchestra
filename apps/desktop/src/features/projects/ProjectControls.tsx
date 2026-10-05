// Adapted from T3 Code SidebarThreadHeader (MIT, T3 Tools Inc.).
// See docs/licenses/t3-code-project-controls.txt for the complete notice.
import { useEffect, useRef, useState } from 'react'
import { Folder, FolderPlus, Search, SquarePen } from 'lucide-react'
import type { Project } from '@core/api/types'
import { AppTooltip } from '@ui/tooltip-wrapper'

export function ProjectControls({ projects, query, onQueryChange, onSelect, onAddProject, onNewTask }: {
  projects: Project[]
  query: string
  onQueryChange: (query: string) => void
  onSelect: (id: string) => void
  onAddProject: () => void
  onNewTask: () => void
}) {
  const [scopeOpen, setScopeOpen] = useState(false)
  const scopeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scopeOpen) return
    const close = (event: MouseEvent) => { if (!scopeRef.current?.contains(event.target as Node)) setScopeOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [scopeOpen])
  const iconButton = 'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary'
  return <div className="relative flex items-center gap-1" onKeyDown={event => { if (event.key === 'Escape') setScopeOpen(false) }}>
    <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-muted-foreground/60 hover:bg-muted/30">
      <Search className="size-4 shrink-0" /><input type="search" aria-label="Search projects" placeholder="Search" value={query} onChange={event => onQueryChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60" />
    </div>
    <div ref={scopeRef}>
      <AppTooltip content="Select project"><button type="button" className={iconButton} aria-label="Select project" aria-expanded={scopeOpen} onClick={() => setScopeOpen(!scopeOpen)}><Folder className="size-4" /></button></AppTooltip>
      {scopeOpen && <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
        {projects.filter(project => `${project.name} ${project.root_path}`.toLowerCase().includes(query.toLowerCase())).map(project => <button key={project.id} type="button" onClick={() => { onSelect(project.id); setScopeOpen(false) }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50"><Folder className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{project.name}</span><span className="block truncate text-[10px] text-muted-foreground">{project.root_path}</span></span></button>)}
        {projects.length === 0 && <p className="p-3 text-xs text-muted-foreground">Add a project to begin.</p>}
      </div>}
    </div>
    <AppTooltip content="Add project"><button type="button" aria-label="Add project" className={iconButton} onClick={onAddProject}><FolderPlus className="size-4" /></button></AppTooltip>
    <AppTooltip content="New task"><button type="button" aria-label="New task" className={iconButton} disabled={projects.length === 0} onClick={onNewTask}><SquarePen className="size-4" /></button></AppTooltip>
  </div>
}
