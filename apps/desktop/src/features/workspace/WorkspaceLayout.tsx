import { useMemo, useState, type ReactNode } from 'react'
import { PanelRight } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { SplitLayout } from './SplitLayout'
import { ResizableWorkspace } from './ResizableWorkspace'
import { WorkspaceToolSurface } from './WorkspaceToolSurface'
import { WorkspaceWelcome } from './panels/WorkspaceWelcome'
import { useAppStore } from '@core/store'
import { GLOBAL_PROJECT_ID } from '@core/store/types'
import { getActiveWorkspaceContextId, selectedProjectWorkspace, workspaceResourceContext } from '@core/store/workspace-context'
import { WorkspaceChat } from './chat/WorkspaceChat'
import { WorkspaceEmptyTools } from './WorkspaceEmptyTools'

import type { BackendConfig, Project } from '@core/api/types'

type WorkspaceLayoutProps = {
  onInspectTask?: (identifier: string) => void
  projectDetails?: (project: Project) => ReactNode
  centerContent?: ReactNode
  onAddTerminal?: () => void
  onAddNewProject?: () => void
}
type View = 'workspace' | 'project'

export function WorkspaceLayout({ onAddTerminal, projectDetails, onInspectTask }: WorkspaceLayoutProps) {
  const activeProjectId = useAppStore(s => s.activeProjectId)
  const contextId = useAppStore(getActiveWorkspaceContextId)
  const workspace = useAppStore(s => selectedProjectWorkspace(s))
  const knownWorkspaces = useAppStore(s => s.knownProjectWorkspaces)
  const layout = useAppStore(s => s.projectLayouts[contextId])
  const projects = useAppStore(s => s.projects)
  const openProjectIds = useAppStore(s => s.openProjectIds)
  const config = useAppStore(s => s.config)
  const activeSection = useAppStore(s => s.activeSection)
  const groups = useAppStore(s => s.projectGroups[contextId])
  const [toolPreferences, setToolPreferences] = useState<Record<string, number>>({})
  const [projectViews, setProjectViews] = useState<Record<string, View>>({})
  const conversationRequest = useAppStore(s => s.requestedWorkspaceConversation)
  const [lastConversationRequest, setLastConversationRequest] = useState(0)
  const chatWorkspaceId = workspace && !workspace.registered ? workspace.workspaceId : undefined
  if (conversationRequest && conversationRequest.requestId !== lastConversationRequest && conversationRequest.projectId === activeProjectId && conversationRequest.baseUrl === config?.baseUrl && conversationRequest.apiToken === config?.apiToken && conversationRequest.workspaceId === chatWorkspaceId) {
    setLastConversationRequest(conversationRequest.requestId)
    setProjectViews(previous => ({ ...previous, [contextId]: 'workspace' }))
  }
  const view = projectViews[contextId] ?? 'workspace'
  const tabCount = Object.values(groups ?? {}).reduce((count, group) => count + group.tabs.length, 0)
  const hasActiveWorkspaceTool = Object.values(groups ?? {}).some(group => !!group.activeTabId && group.tabs.some(tab => tab.id === group.activeTabId))
  const preference = toolPreferences[contextId]
  const toolsOpen = view === 'workspace' && (preference === undefined ? tabCount > 0 : preference === -1 || tabCount > preference)
  const toggleTools = () => {
    if (view === 'project') {
      setProjectViews(previous => ({ ...previous, [contextId]: 'workspace' }))
      setToolPreferences(previous => ({ ...previous, [contextId]: -1 }))
    } else setToolPreferences(previous => ({ ...previous, [contextId]: toolsOpen ? tabCount : -1 }))
  }
  const addTerminal = () => {
    if (view === 'project') {
      setProjectViews(previous => ({ ...previous, [contextId]: 'workspace' }))
      setToolPreferences(previous => ({ ...previous, [contextId]: -1 }))
    }
    onAddTerminal?.()
  }
  const project = projects.find(p => p.id === activeProjectId)
  const showWelcome = activeProjectId === GLOBAL_PROJECT_ID || !project || !config
  const chatOwners = useMemo(() => {
    const owners = new Map<string, { project: Project; config: BackendConfig; name: string }>()
    if (!config) return owners
    const openIds = new Set([...openProjectIds, activeProjectId])
    for (const owner of projects) if (openIds.has(owner.id)) owners.set(owner.id, { project: owner, config, name: owner.name })
    for (const [key, known] of Object.entries(knownWorkspaces)) {
      if (!key.startsWith(`${config.baseUrl}::`) || !openIds.has(known.projectId)) continue
      const owner = projects.find(p => p.id === known.projectId)
      if (!owner) continue
      owners.set(workspaceResourceContext(config.baseUrl, known), { project: owner, config: known.registered ? config : { ...config, workspaceId: known.workspaceId }, name: known.registered ? owner.name : `${owner.name} / ${known.branch}` })
    }
    return owners
  }, [config, openProjectIds, activeProjectId, projects, knownWorkspaces])

  const workspaceTabs = !showWelcome && <div role="tablist" aria-label="Project workspace" className="flex shrink-0 flex-nowrap items-center justify-end gap-0.5">
        {([{ id: 'workspace', label: 'Workspace' }, { id: 'project', label: 'Tasks' }] as const).map(item => <button key={item.id} role="tab" aria-selected={view === item.id} onClick={() => { setProjectViews(previous => ({ ...previous, [contextId]: item.id })) }} className={`rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap ${view === item.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}>{item.label}</button>)}
      </div>
  return <div className="flex h-full min-h-0 w-full">
    {showWelcome && <WorkspaceWelcome onAddTerminal={onAddTerminal} />}
    {config && <div className={`${showWelcome ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 flex-col`}>
      <div role="tabpanel" aria-label={view === 'project' ? 'Tasks' : 'Workspace'} className="flex min-h-0 flex-1 flex-col">
        <ResizableWorkspace storageKey={`orchestra:workspace-split:v1:${encodeURIComponent(config.baseUrl)}:${encodeURIComponent(contextId)}`} toolsOpen={toolsOpen} chat={<div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
          {[...chatOwners].map(([id, owner]) => <div key={`${config.baseUrl}:${config.apiToken}:${id}`} hidden={id !== contextId} className={id === contextId ? 'h-full' : 'hidden'}>
            <WorkspaceChat config={owner.config} projectId={owner.project.id} projectName={owner.name} headerNavigation={id === contextId ? workspaceTabs : undefined} contentOverride={id === contextId && view === 'project' && project ? projectDetails?.(project) : undefined} onShowChat={() => setProjectViews(previous => ({ ...previous, [contextId]: 'workspace' }))} active={id === contextId && view !== 'project' && (activeSection === 'CONSOLE' || activeSection === 'PROJECTS')} headerTools={id === contextId && !toolsOpen ? <AppTooltip content="Show workspace tools" side="bottom"><button type="button" aria-label="Show workspace tools" onClick={toggleTools} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"><PanelRight className="size-4" /></button></AppTooltip> : undefined} />
          </div>)}
          </div>
        </div>} tools={<WorkspaceToolSurface onAddTerminal={addTerminal} toolsOpen={toolsOpen} onToggleTools={toggleTools} hasActiveTools={hasActiveWorkspaceTool}>
          <div className="flex min-h-0 min-w-0 flex-1">
            {layout && tabCount > 0 ? <SplitLayout projectId={contextId} layout={layout} onInspectTask={onInspectTask} onToggleTools={toggleTools} /> : <WorkspaceEmptyTools projectId={contextId} onAddTerminal={addTerminal} />}
          </div>
        </WorkspaceToolSurface>} />
      </div>
    </div>}
  </div>
}
