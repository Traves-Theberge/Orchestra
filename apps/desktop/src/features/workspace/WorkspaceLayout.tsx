import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LayoutPanelLeft, ListTodo, PanelRight } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { SplitLayout } from './SplitLayout'
import { ResizableWorkspace } from './ResizableWorkspace'
import { WorkspaceToolSurface } from './WorkspaceToolSurface'
import { WorkspaceWelcome } from './panels/WorkspaceWelcome'
import { useAppStore } from '@core/store'
import { CENTER_TASKS_TAB, CENTER_WORKSPACE_TAB, GLOBAL_PROJECT_ID } from '@core/store/types'
import { isSideTab } from '@core/store/group-helpers'
import { getActiveWorkspaceContextId, selectedProjectWorkspace, workspaceResourceContext } from '@core/store/workspace-context'
import { WorkspaceChat } from './chat/WorkspaceChat'
import { WorkspaceEmptyTools } from './WorkspaceEmptyTools'
import { CenterNewTabMenu, CenterTabPanels, CenterTabs } from './tabs/CenterTabStrip'

import type { BackendConfig, Project } from '@core/api/types'

type WorkspaceLayoutProps = {
  onInspectTask?: (identifier: string) => void
  projectDetails?: (project: Project) => ReactNode
  centerContent?: ReactNode
  onAddTerminal?: () => void
  onAddNewProject?: () => void
}

const FIXED_TABS = [
  { id: CENTER_WORKSPACE_TAB, label: 'Workspace', icon: LayoutPanelLeft },
  { id: CENTER_TASKS_TAB, label: 'Tasks', icon: ListTodo },
] as const

export function WorkspaceLayout({ onAddTerminal, projectDetails, onInspectTask }: WorkspaceLayoutProps) {
  const activeProjectId = useAppStore(s => s.activeProjectId)
  const contextId = useAppStore(getActiveWorkspaceContextId)
  const workspace = useAppStore(s => selectedProjectWorkspace(s))
  const knownWorkspaces = useAppStore(s => s.knownProjectWorkspaces)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)
  const [breadcrumbSlot, setBreadcrumbSlot] = useState<HTMLDivElement | null>(null)
  const layout = useAppStore(s => s.projectLayouts[contextId])
  const projects = useAppStore(s => s.projects)
  const openProjectIds = useAppStore(s => s.openProjectIds)
  const config = useAppStore(s => s.config)
  const activeSection = useAppStore(s => s.activeSection)
  const groups = useAppStore(s => s.projectGroups[contextId])
  const center = useAppStore(s => s.projectCenterTabs[contextId])
  const selectCenterTab = useAppStore(s => s.selectCenterTab)
  const normalizeWorkspaceTabs = useAppStore(s => s.normalizeWorkspaceTabs)
  const sideToolRequest = useAppStore(s => s.sideToolRequests[contextId] ?? 0)
  const [toolPreferences, setToolPreferences] = useState<Record<string, number>>({})
  const conversationRequest = useAppStore(s => s.requestedWorkspaceConversation)
  const chatWorkspaceId = workspace && !workspace.registered ? workspace.workspaceId : undefined

  // Legacy tab groups may still hold terminal/browser/editor/conversations
  // tabs; route them to the center strip.
  useEffect(() => { normalizeWorkspaceTabs(contextId) }, [contextId, groups, normalizeWorkspaceTabs])

  // A requested conversation always lands on the Workspace (chat) tab.
  const handledConversationRequest = useRef(0)
  useEffect(() => {
    if (!conversationRequest || conversationRequest.requestId === handledConversationRequest.current) return
    if (conversationRequest.projectId !== activeProjectId || conversationRequest.baseUrl !== config?.baseUrl || conversationRequest.apiToken !== config?.apiToken || conversationRequest.workspaceId !== chatWorkspaceId) return
    handledConversationRequest.current = conversationRequest.requestId
    selectCenterTab(contextId, CENTER_WORKSPACE_TAB)
  }, [conversationRequest, activeProjectId, config, chatWorkspaceId, contextId, selectCenterTab])

  const selectedId = center?.selectedId ?? CENTER_WORKSPACE_TAB
  const selectedCenterTab = center?.tabs.some(t => t.id === selectedId) ? selectedId : null
  const view = selectedId === CENTER_TASKS_TAB ? 'project' : 'workspace'
  const sideTabs = Object.values(groups ?? {}).flatMap(group => group.tabs.filter(isSideTab))
  const tabCount = sideTabs.length
  const hasActiveWorkspaceTool = Object.values(groups ?? {}).some(group => !!group.activeTabId && group.tabs.some(tab => tab.id === group.activeTabId && isSideTab(tab)))

  // Opening Files/Git reveals the tools panel even if it was hidden.
  const [seenSideRequests, setSeenSideRequests] = useState<Record<string, number>>({})
  if ((seenSideRequests[contextId] ?? 0) !== sideToolRequest) {
    setSeenSideRequests(previous => ({ ...previous, [contextId]: sideToolRequest }))
    if (sideToolRequest > 0) setToolPreferences(previous => ({ ...previous, [contextId]: -1 }))
  }
  useEffect(() => {
    if (sideToolRequest > 0 && useAppStore.getState().projectCenterTabs[contextId]?.selectedId === CENTER_TASKS_TAB) selectCenterTab(contextId, CENTER_WORKSPACE_TAB)
  }, [sideToolRequest, contextId, selectCenterTab])

  const preference = toolPreferences[contextId]
  const toolsOpen = view === 'workspace' && (preference === undefined ? tabCount > 0 : preference === -1 || tabCount > preference)
  const toggleTools = () => {
    if (view === 'project') {
      selectCenterTab(contextId, CENTER_WORKSPACE_TAB)
      setToolPreferences(previous => ({ ...previous, [contextId]: -1 }))
    } else setToolPreferences(previous => ({ ...previous, [contextId]: toolsOpen ? tabCount : -1 }))
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

  // One strip across the main area: conversation breadcrumb, fixed Workspace /
  // Tasks tabs, closeable center tabs and their + menu, then the tools panel's
  // tabs and controls, which the tool surface portals into the slot.
  const workspaceTabs = !showWelcome && <div className="flex h-10 shrink-0 items-center gap-1 px-3 pt-1">
      <div ref={setBreadcrumbSlot} data-testid="workspace-breadcrumb" className="mr-1.5 flex min-w-0 shrink items-center empty:hidden" />
      <div role="tablist" aria-label="Project workspace" className="flex min-w-0 shrink items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {FIXED_TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={selectedId === item.id} onClick={() => selectCenterTab(contextId, item.id)} className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] transition-colors ${selectedId === item.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}><item.icon className="size-3.5" strokeWidth={1.8} />{item.label}</button>)}
        <CenterTabs projectId={contextId} />
      </div>
      <CenterNewTabMenu projectId={contextId} />
      {toolsOpen && <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-border" />}
      <div ref={setToolbarSlot} className="flex h-full min-w-0 flex-1 items-center" />
      {!toolsOpen && <AppTooltip content="Show workspace tools" side="bottom"><button type="button" aria-label="Show workspace tools" onClick={toggleTools} className="ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent"><PanelRight className="size-4" /></button></AppTooltip>}
    </div>
  return <div className="flex h-full min-h-0 w-full">
    {showWelcome && <WorkspaceWelcome onAddTerminal={onAddTerminal} />}
    {config && <div className={`${showWelcome ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 flex-col`}>
      {workspaceTabs}
      <div role="tabpanel" aria-label={view === 'project' ? 'Tasks' : 'Workspace'} className="flex min-h-0 flex-1 flex-col">
        <ResizableWorkspace storageKey={`orchestra:workspace-split:v1:${encodeURIComponent(config.baseUrl)}:${encodeURIComponent(contextId)}`} toolsOpen={toolsOpen} chat={<div className="flex h-full min-h-0 flex-col">
          <div className="relative min-h-0 flex-1">
          {[...chatOwners].map(([id, owner]) => {
            const shown = id === contextId && !selectedCenterTab
            return <div key={`${config.baseUrl}:${config.apiToken}:${id}`} hidden={!shown} className={shown ? 'h-full' : 'hidden'}>
              <WorkspaceChat config={owner.config} projectId={owner.project.id} projectName={owner.name} breadcrumbSlot={id === contextId ? breadcrumbSlot : null} contentOverride={id === contextId && view === 'project' && project ? projectDetails?.(project) : undefined} onShowChat={() => selectCenterTab(contextId, CENTER_WORKSPACE_TAB)} active={shown && view !== 'project' && (activeSection === 'CONSOLE' || activeSection === 'PROJECTS')} />
            </div>
          })}
          <CenterTabPanels contextId={contextId} onInspectTask={onInspectTask} />
          </div>
        </div>} tools={<WorkspaceToolSurface toolbarSlot={toolbarSlot} toolsOpen={toolsOpen} onToggleTools={toggleTools} hasActiveTools={hasActiveWorkspaceTool}>
          <div className="flex min-h-0 min-w-0 flex-1">
            {layout && tabCount > 0 ? <SplitLayout projectId={contextId} layout={layout} onInspectTask={onInspectTask} onToggleTools={toggleTools} /> : <WorkspaceEmptyTools projectId={contextId} />}
          </div>
        </WorkspaceToolSurface>} />
      </div>
    </div>}
  </div>
}
