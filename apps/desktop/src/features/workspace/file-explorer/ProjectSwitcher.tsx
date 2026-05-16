import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '@core/store'
import { GLOBAL_PROJECT_ID } from '@core/store/types'
import { Folder, ChevronDown, X, Plus, Check } from 'lucide-react'
import type { Project } from '@core/api/types'

interface ProjectSwitcherProps {
  projects: Project[]
}

export function ProjectSwitcher({ projects }: ProjectSwitcherProps) {
  const openProjectIds = useAppStore((s) => s.openProjectIds)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const openProjectTab = useAppStore((s) => s.openProjectTab)
  const closeProjectTab = useAppStore((s) => s.closeProjectTab)
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const isGlobal = activeProjectId === GLOBAL_PROJECT_ID
  const visibleOpenIds = openProjectIds.filter((id) => id !== GLOBAL_PROJECT_ID)
  const closedProjects = projects.filter((p) => !openProjectIds.includes(p.id))

  const label = isGlobal ? 'No project' : activeProject?.name ?? 'Untitled'

  return (
    <div className="relative w-full" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1.5 w-full px-2 h-7 rounded text-left hover:bg-muted/40 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Folder size={11} className={isGlobal ? 'text-muted-foreground/50' : 'text-primary'} />
        <span className={`flex-1 truncate text-xs font-semibold ${isGlobal ? 'text-muted-foreground italic' : 'text-foreground'}`}>
          {label}
        </span>
        <ChevronDown
          size={11}
          className={`text-muted-foreground/60 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-[280px] bg-popover border border-border rounded-md shadow-lg py-1 max-h-[400px] overflow-y-auto">
          {visibleOpenIds.length > 0 && (
            <>
              <div className="px-3 pt-1 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                Open
              </div>
              {visibleOpenIds.map((id) => {
                const p = projects.find((x) => x.id === id)
                const active = id === activeProjectId
                return (
                  <div
                    key={id}
                    className="group flex items-center px-2 hover:bg-accent rounded"
                  >
                    <button
                      onClick={() => {
                        setActiveProjectId(id)
                        setOpen(false)
                      }}
                      className="flex items-center gap-2 flex-1 py-1.5 text-left min-w-0"
                    >
                      {active ? (
                        <Check size={11} className="text-primary shrink-0" />
                      ) : (
                        <span className="w-[11px] shrink-0" />
                      )}
                      <Folder size={11} className="shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-foreground truncate">{p?.name ?? id}</div>
                        {p?.root_path && (
                          <div className="text-[10px] text-muted-foreground/60 truncate">{p.root_path}</div>
                        )}
                      </div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        closeProjectTab(id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive rounded transition-all"
                      title="Close project"
                    >
                      <X size={9} />
                    </button>
                  </div>
                )
              })}
            </>
          )}

          {closedProjects.length > 0 && (
            <>
              {visibleOpenIds.length > 0 && <div className="my-1 h-px bg-border/60" />}
              <div className="px-3 pt-1 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                Available
              </div>
              {closedProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    openProjectTab(p.id, p.root_path ?? null)
                    setOpen(false)
                  }}
                  className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-accent rounded text-left"
                >
                  <Plus size={11} className="text-muted-foreground/60 shrink-0" />
                  <Folder size={11} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium text-foreground truncate">{p.name}</div>
                    {p.root_path && (
                      <div className="text-[10px] text-muted-foreground/60 truncate">{p.root_path}</div>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}

          {visibleOpenIds.length === 0 && closedProjects.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              No projects yet. Add one from the Projects section.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
