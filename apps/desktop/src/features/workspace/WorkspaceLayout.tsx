import { useState, type ReactNode } from 'react'
import { SplitLayout } from './SplitLayout'
import { ResizableWorkspace } from './ResizableWorkspace'
import { WorkspaceWelcome } from './panels/WorkspaceWelcome'
import { useAppStore } from '@core/store'
import { GLOBAL_PROJECT_ID } from '@core/store/types'
import { WorkspaceChat } from './chat/WorkspaceChat'
import { Globe, PanelRight, Terminal } from 'lucide-react'

type WorkspaceLayoutProps = {
  centerContent?: ReactNode
  onAddTerminal?: () => void
  onAddNewProject?: () => void
}

export function WorkspaceLayout({ onAddTerminal }: WorkspaceLayoutProps) {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const layout = useAppStore((s) => s.projectLayouts[activeProjectId])
  const projects = useAppStore((s) => s.projects)
  const openProjectIds = useAppStore((s) => s.openProjectIds)
  const config = useAppStore((s) => s.config)
  const activeSection = useAppStore((s) => s.activeSection)
  const groups = useAppStore((s) => s.projectGroups[activeProjectId])
  const openBrowserTab = useAppStore((s) => s.openBrowserTab)
  const [toolPreferences, setToolPreferences] = useState<Record<string, number>>({})
  const tabCount = Object.values(groups ?? {}).reduce((count, group) => count + group.tabs.length, 0)
  const preference = toolPreferences[activeProjectId]
  const toolsOpen = preference === undefined ? tabCount > 0 : preference === -1 || tabCount > preference
  const toggleTools = () => setToolPreferences(previous => ({ ...previous, [activeProjectId]: toolsOpen ? tabCount : -1 }))

  const isGlobal = activeProjectId === GLOBAL_PROJECT_ID
  const project = projects.find(p => p.id === activeProjectId)
  const showWelcome = isGlobal || !project || !config

  return (
    <div className="flex h-full min-h-0 w-full">
      {showWelcome && <WorkspaceWelcome onAddTerminal={onAddTerminal} />}
      {config && (
        <div className={`${showWelcome ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 flex-col`}>
          <ResizableWorkspace storageKey={`orchestra:workspace-split:v1:${encodeURIComponent(config.baseUrl)}:${encodeURIComponent(activeProjectId)}`} toolsOpen={toolsOpen} chat={<>
              {[...new Set([...openProjectIds, activeProjectId])].map(id => {
                const owner = projects.find(p => p.id === id)
                return owner && <div key={`${config.baseUrl}:${config.apiToken}:${id}`} className={id === activeProjectId ? 'h-full' : 'hidden'}>
                  <WorkspaceChat config={config} projectId={id} projectName={owner.name} active={id === activeProjectId && activeSection === 'CONSOLE'} headerTools={<>{onAddTerminal && <button onClick={onAddTerminal} aria-label="New terminal" title="New terminal" className="rounded-md p-2 text-muted-foreground hover:bg-accent"><Terminal className="size-4" /></button>}<button onClick={toggleTools} aria-label="Files & terminals" title="Files & terminals" aria-pressed={toolsOpen} className="rounded-md p-2 text-muted-foreground hover:bg-accent"><PanelRight className="size-4" /></button></>} />
                </div>
              })}
            </>} tools={<>
              {layout && tabCount > 0 ? <SplitLayout projectId={activeProjectId} layout={layout} /> : <div className="flex w-full flex-col gap-2 p-4"><p className="mb-2 text-xs text-muted-foreground">Files & terminals</p>{onAddTerminal && <button onClick={onAddTerminal} className="flex items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-accent"><Terminal className="size-4" />New terminal</button>}<button onClick={() => openBrowserTab()} className="flex items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-accent"><Globe className="size-4" />New browser tab</button></div>}
            </>} />
        </div>
      )}
    </div>
  )
}
