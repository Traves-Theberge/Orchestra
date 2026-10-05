import { useState, type ReactNode } from 'react'
import { Folder, Search, X } from 'lucide-react'
import { FileExplorer } from './file-explorer/FileExplorer'
import { WorkspaceSearch } from './panels/WorkspaceSearch'

export function WorkspaceToolSurface({ children }: { children: ReactNode }) {
  const [inspector, setInspector] = useState<'files' | 'search' | null>(null)
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="flex h-8 shrink-0 items-center gap-1 px-2">
      <button aria-label="Toggle workspace files" aria-pressed={inspector === 'files'} title="Files" onClick={() => setInspector(current => current === 'files' ? null : 'files')} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><Folder size={13} /></button>
      <button aria-label="Toggle workspace search" aria-pressed={inspector === 'search'} title="Search files" onClick={() => setInspector(current => current === 'search' ? null : 'search')} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><Search size={13} /></button>
      <span className="text-[11px] text-muted-foreground">Files & terminals</span>
      {inspector && <button aria-label="Close workspace file sidebar" onClick={() => setInspector(null)} className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"><X size={12} /></button>}
    </div>
    <div className="flex min-h-0 flex-1">
      {inspector && <aside aria-label="Workspace file sidebar" className="min-h-0 w-44 max-w-[45%] shrink-0 overflow-auto border-r border-border/30">{inspector === 'files' ? <FileExplorer /> : <WorkspaceSearch />}</aside>}
      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  </div>
}
