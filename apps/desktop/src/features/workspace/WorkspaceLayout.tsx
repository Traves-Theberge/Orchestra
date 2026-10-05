import { useState, type ReactNode } from 'react'
import { SplitLayout } from './SplitLayout'
import { ResizableWorkspace } from './ResizableWorkspace'
import { WorkspaceToolsControls } from './WorkspaceToolsControls'
import { WorkspaceToolSurface } from './WorkspaceToolSurface'
import { WorkspaceWelcome } from './panels/WorkspaceWelcome'
import { useAppStore } from '@core/store'
import { GLOBAL_PROJECT_ID } from '@core/store/types'
import { WorkspaceChat } from './chat/WorkspaceChat'
import { Globe, PanelRight, Terminal } from 'lucide-react'
import type { Project } from '@core/api/types'
import { GitTab } from '@features/git'

type WorkspaceLayoutProps = {
  onInspectTask?: (identifier: string) => void
  projectDetails?: (project: Project) => ReactNode
  centerContent?: ReactNode
  onAddTerminal?: () => void
  onAddNewProject?: () => void
}

export function WorkspaceLayout({ onAddTerminal, projectDetails, onInspectTask }: WorkspaceLayoutProps) {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const layout = useAppStore((s) => s.projectLayouts[activeProjectId])
  const projects = useAppStore((s) => s.projects)
  const openProjectIds = useAppStore((s) => s.openProjectIds)
  const config = useAppStore((s) => s.config)
  const activeSection = useAppStore((s) => s.activeSection)
  const groups = useAppStore((s) => s.projectGroups[activeProjectId])
  const openBrowserTab = useAppStore((s) => s.openBrowserTab)
  const [toolPreferences, setToolPreferences] = useState<Record<string, number>>({})
  const [projectViews, setProjectViews] = useState<Record<string, 'workspace' | 'git' | 'project'>>({})
  const conversationRequest = useAppStore(state => state.requestedWorkspaceConversation)
  const [lastConversationRequest, setLastConversationRequest] = useState(0)
  if (conversationRequest && conversationRequest.requestId !== lastConversationRequest && conversationRequest.projectId === activeProjectId && conversationRequest.baseUrl === config?.baseUrl && conversationRequest.apiToken === config?.apiToken) {
    setLastConversationRequest(conversationRequest.requestId)
    setProjectViews(previous => ({ ...previous, [activeProjectId]: 'workspace' }))
  }
  const view = projectViews[activeProjectId] ?? 'workspace'
  const tabCount = Object.values(groups ?? {}).reduce((count, group) => count + group.tabs.length, 0)
  const preference = toolPreferences[activeProjectId]
  const preferredToolsOpen = preference === undefined ? tabCount > 0 : preference === -1 || tabCount > preference
  const toolsOpen = view === 'git' || preferredToolsOpen
  const toggleTools = () => {
    if (view === 'git') {
      setProjectViews(previous => ({ ...previous, [activeProjectId]: 'workspace' }))
      setToolPreferences(previous => ({ ...previous, [activeProjectId]: -1 }))
    } else setToolPreferences(previous => ({ ...previous, [activeProjectId]: toolsOpen ? tabCount : -1 }))
  }

  const isGlobal = activeProjectId === GLOBAL_PROJECT_ID
  const project = projects.find(p => p.id === activeProjectId)
  const showWelcome = isGlobal || !project || !config

  return (
    <div className="flex h-full min-h-0 w-full">
      {showWelcome && <WorkspaceWelcome onAddTerminal={onAddTerminal} />}
      {config && (
        <div className={`${showWelcome ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 flex-col`}>
          {!showWelcome && <div role="tablist" aria-label="Project workspace" className="flex shrink-0 items-center gap-1 px-3 py-1">
            {([{ id: 'workspace', label: 'Workspace' }, { id: 'git', label: 'Git & pull requests' }, { id: 'project', label: 'Tasks & settings' }] as const).map(item => <button key={item.id} role="tab" aria-selected={view === item.id} onClick={() => setProjectViews(previous => ({ ...previous, [activeProjectId]: item.id }))} className={`rounded-md px-3 py-1.5 text-xs font-medium ${view === item.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}>{item.label}</button>)}
          </div>}
          <div role="tabpanel" aria-label="Workspace" hidden={view === 'project'} className={`${view === 'project' ? 'hidden' : 'flex'} min-h-0 flex-1 flex-col`}>
          <ResizableWorkspace storageKey={`orchestra:workspace-split:v1:${encodeURIComponent(config.baseUrl)}:${encodeURIComponent(activeProjectId)}`} toolsOpen={toolsOpen} chat={<>
              {[...new Set([...openProjectIds, activeProjectId])].map(id => {
                const owner = projects.find(p => p.id === id)
                return owner && <div key={`${config.baseUrl}:${config.apiToken}:${id}`} className={id === activeProjectId ? 'h-full' : 'hidden'}>
                  <WorkspaceChat config={config} projectId={id} projectName={owner.name} active={id === activeProjectId && view !== 'project' && (activeSection === 'CONSOLE' || activeSection === 'PROJECTS')} headerTools={<>{onAddTerminal && <button onClick={onAddTerminal} aria-label="New terminal" title="New terminal" className="rounded-md p-2 text-muted-foreground hover:bg-accent"><Terminal className="size-4" /></button>}<button onClick={toggleTools} aria-label="Files & terminals" title="Files & terminals" aria-pressed={toolsOpen} className="rounded-md p-2 text-muted-foreground hover:bg-accent"><PanelRight className="size-4" /></button></>} />
                </div>
              })}
            </>} tools={<>
              <div hidden={view === 'git'} className={`${view === 'git' ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1`}>
              <WorkspaceToolSurface>
              {layout && tabCount > 0 ? <SplitLayout projectId={activeProjectId} layout={layout} /> : <div className="flex w-full flex-col gap-2 p-4"><div className="mb-2 flex items-center justify-between"><p className="text-xs text-muted-foreground">Files & terminals</p><WorkspaceToolsControls /></div>{onAddTerminal && <button onClick={onAddTerminal} className="flex items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-accent"><Terminal className="size-4" />New terminal</button>}<button onClick={() => openBrowserTab()} className="flex items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-accent"><Globe className="size-4" />New browser tab</button></div>}
              </WorkspaceToolSurface></div>
              {project && view === 'git' && <div role="tabpanel" aria-label="Git & pull requests" className="min-h-0 min-w-0 flex-1"><GitTab key={`${config.baseUrl}:${project.id}`} project={project} config={config} onInspectTask={onInspectTask} /></div>}
            </>} />
          </div>
          {project && view === 'project' && <div role="tabpanel" aria-label="Tasks & settings" className="flex min-h-0 flex-1 flex-col">{projectDetails?.(project)}</div>}
        </div>
      )}
    </div>
  )
}
