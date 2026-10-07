import { useContext } from 'react'
import { Folder, FolderTree, GitBranch } from 'lucide-react'
import { OpenFileSidebarContext } from './tabs/toolbar-tab-slot'
import { useAppStore } from '@core/store'

interface WorkspaceEmptyToolsProps {
  projectId: string
}

/** Empty state of the right tools panel: only Files and Git live here. */
export function WorkspaceEmptyTools({ projectId }: WorkspaceEmptyToolsProps) {
  const openFileSidebar = useContext(OpenFileSidebarContext)

  const tools = [
    { id: 'files', label: 'Files', icon: Folder, onClick: () => useAppStore.getState().addTabToGroup(projectId, { type: 'files', id: 'files' }) },
    ...(openFileSidebar ? [{ id: 'file-sidebar', label: 'File sidebar', icon: FolderTree, onClick: openFileSidebar }] : []),
    { id: 'git', label: 'Git', icon: GitBranch, onClick: () => useAppStore.getState().addTabToGroup(projectId, { type: 'git', id: 'git' }) },
  ]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-[220px] flex-col gap-3">
        <p className="px-2 text-[12px] text-muted-foreground">Open a tool</p>
        <div className="flex flex-col">
          {tools.map(({ id, label, icon: Icon, onClick }) => (
            <button
              key={id}
              type="button"
              onClick={onClick}
              className="flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
