import { useEffect } from 'react'
import { FolderTree, Search, PanelLeftOpen, PanelLeftClose } from 'lucide-react'
import { useAppStore } from '@core/store'
import { ResizeHandle } from '../ResizeHandle'
import { FileExplorer } from '../file-explorer/FileExplorer'
import { WorkspaceSearch } from './WorkspaceSearch'
import { ProjectSwitcher } from '../file-explorer/ProjectSwitcher'

export function LeftSidebar() {
  const activeLeftPanel = useAppStore(s => s.activeLeftPanel)
  const setActiveLeftPanel = useAppStore(s => s.setActiveLeftPanel)
  const leftSidebarOpen = useAppStore(s => s.leftSidebarOpen)
  const toggleLeftSidebar = useAppStore(s => s.toggleLeftSidebar)
  const leftSidebarWidth = useAppStore(s => s.leftSidebarWidth)
  const setLeftSidebarWidth = useAppStore(s => s.setLeftSidebarWidth)
  const projects = useAppStore(s => s.projects)

  // The 'issues' panel was removed — sessions/terminals live in the unified tab bar.
  useEffect(() => {
    if (activeLeftPanel === 'issues') {
      setActiveLeftPanel('explorer')
    }
  }, [activeLeftPanel, setActiveLeftPanel])

  if (!leftSidebarOpen) {
    return (
      <div className="flex flex-col items-center py-2 px-1 border-r border-border bg-background flex-shrink-0">
        <button
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          onClick={toggleLeftSidebar}
          title="Open Sidebar (Cmd+B)"
          aria-label="Open sidebar"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex h-full flex-shrink-0"
      style={{ width: leftSidebarWidth }}
    >
      <div className="flex flex-col h-full bg-background border-r border-border flex-1 min-w-0">
        <div className="px-2 py-1.5 border-b border-border/60">
          <ProjectSwitcher projects={projects} />
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/60">
          <div className="flex items-center gap-1">
            <button
              className={`p-1.5 rounded transition-colors ${
                activeLeftPanel === 'explorer'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
              onClick={() => setActiveLeftPanel('explorer')}
              title="File Explorer"
              aria-label="File Explorer"
            >
              <FolderTree className="size-4" />
            </button>
            <button
              className={`p-1.5 rounded transition-colors ${
                activeLeftPanel === 'search'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
              onClick={() => setActiveLeftPanel('search')}
              title="Search"
              aria-label="Search"
            >
              <Search className="size-4" />
            </button>
          </div>
          <button
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            onClick={toggleLeftSidebar}
            title="Close Sidebar (Cmd+B)"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {activeLeftPanel === 'explorer' && <FileExplorer />}
          {activeLeftPanel === 'search' && <WorkspaceSearch />}
        </div>
      </div>

      <ResizeHandle
        direction="horizontal"
        onResize={(delta) => setLeftSidebarWidth(useAppStore.getState().leftSidebarWidth + delta)}
      />
    </div>
  )
}
