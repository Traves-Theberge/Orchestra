import { useAppStore } from '@core/store'
import { GLOBAL_PROJECT_ID } from '@core/store/types'
import { Folder, Globe, Terminal, FileText, Plus } from 'lucide-react'

interface WorkspaceWelcomeProps {
  onAddTerminal?: () => void
}

export function WorkspaceWelcome({ onAddTerminal }: WorkspaceWelcomeProps) {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projects = useAppStore((s) => s.projects)
  const openProjectIds = useAppStore((s) => s.openProjectIds)
  const openProjectTab = useAppStore((s) => s.openProjectTab)
  const openBrowserTab = useAppStore((s) => s.openBrowserTab)
  const openFile = useAppStore((s) => s.openFile)
  const allOpenFiles = useAppStore((s) => s.openFiles)
  const setCreateProjectDialogOpen = useAppStore((s) => s.setCreateProjectDialogOpen)

  const isGlobal = activeProjectId === GLOBAL_PROJECT_ID
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const availableProjects = projects.filter((p) => !openProjectIds.includes(p.id))
  const recentFiles = allOpenFiles
    .filter((f) => f.projectId === activeProjectId)
    .slice(-5)
    .reverse()

  // ---- "No project open" -----------------------------------------------------
  if (isGlobal) {
    return (
      <Shell>
        <div className="space-y-12">
          <header className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">Workspace</p>
            <h1 className="text-4xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Open a project to begin.</p>
          </header>

          {projects.length === 0 ? (
            <button
              onClick={() => setCreateProjectDialogOpen(true)}
              className="group w-full rounded-xl border border-dashed border-border/50 bg-transparent hover:border-primary/40 hover:bg-primary/[0.02] transition-colors py-14 flex flex-col items-center justify-center gap-3"
            >
              <Plus size={18} className="text-muted-foreground/50 group-hover:text-primary transition-colors" />
              <span className="text-xs font-semibold text-muted-foreground group-hover:text-foreground transition-colors">Add project</span>
            </button>
          ) : (
            <List label={`Projects · ${availableProjects.length}`}>
              {availableProjects.map((p) => (
                <Row
                  key={p.id}
                  icon={<Folder size={13} />}
                  title={p.name}
                  meta={p.root_path ?? undefined}
                  onClick={() => openProjectTab(p.id, p.root_path ?? null)}
                />
              ))}
              <Row
                icon={<Plus size={13} />}
                title="Add project"
                muted
                onClick={() => setCreateProjectDialogOpen(true)}
              />
            </List>
          )}
        </div>
      </Shell>
    )
  }

  // ---- "Project open, no tabs" -----------------------------------------------
  return (
    <Shell>
      <div className="space-y-12">
        <header className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">Project</p>
          <h1 className="text-4xl font-semibold tracking-tight truncate">{activeProject?.name ?? 'Workspace'}</h1>
          {activeProject?.root_path && (
            <p className="text-[11px] font-mono text-muted-foreground/60 truncate">{activeProject.root_path}</p>
          )}
        </header>

        <List label="Start">
          {onAddTerminal && (
            <Row icon={<Terminal size={13} />} title="New terminal" meta="Shell in project root" onClick={onAddTerminal} />
          )}
          <Row icon={<Globe size={13} />} title="New browser tab" meta="Embedded preview" onClick={() => openBrowserTab()} />
        </List>

        {recentFiles.length > 0 && (
          <List label="Recent">
            {recentFiles.map((f) => (
              <Row
                key={f.id}
                icon={<FileText size={13} />}
                title={f.relativePath.split('/').pop() ?? ''}
                meta={f.relativePath}
                trailing={f.isDirty ? <span className="size-1.5 rounded-full bg-blue-400" /> : null}
                onClick={() => openFile(f.filePath, f.relativePath, undefined, activeProjectId)}
              />
            ))}
          </List>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 w-full overflow-y-auto bg-background flex flex-col">
      <div className="m-auto w-full max-w-sm px-8 py-16">{children}</div>
    </div>
  )
}

function List({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 px-1">{label}</p>
      <div className="-mx-2">{children}</div>
    </section>
  )
}

function Row({
  icon,
  title,
  meta,
  trailing,
  muted,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  meta?: string
  trailing?: React.ReactNode
  muted?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 w-full px-2 py-2.5 rounded-md hover:bg-accent/50 transition-colors text-left"
    >
      <span className={`shrink-0 ${muted ? 'text-muted-foreground/50' : 'text-muted-foreground/70 group-hover:text-foreground'} transition-colors`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] font-semibold truncate ${muted ? 'text-muted-foreground/70 group-hover:text-foreground' : 'text-foreground'}`}>
          {title}
        </span>
        {meta && (
          <span className="block text-[10px] font-mono text-muted-foreground/50 truncate mt-0.5">{meta}</span>
        )}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  )
}
