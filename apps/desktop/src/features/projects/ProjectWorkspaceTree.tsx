import { useEffect, useState } from 'react'
import { ChevronDown, Folder, GitBranch, Plus, RefreshCw, Terminal } from 'lucide-react'
import { useAppStore } from '@core/store'
import { fetchProjectWorktrees, fetchState, listWorkspaceChatArchives, listWorkspaceChatSessions, stopWorkspaceChatTurn, type BackendConfig, type ProjectWorktree, type WorkspaceChatSession, type IssueListItem } from '@core/api/client'
import type { Project, RunningEntry } from '@core/api/types'
import type { SelectedProjectWorkspace } from '@core/store/types'
import { GLOBAL_PROJECT_ID } from '@core/store/types'
import type { IssueInspectionOwner } from '@/hooks/use-issue-actions'
import { getAgentIcon } from '@/layout/shared/controls'
import { projectWorkspaceAgentRows, shortObservedAge, type WorkspaceAgentRow } from './workspace-agent-projection'
import { WorktreeRemovalControls } from './WorktreeRemovalControls'
import { WorkspaceArchiveHistory, WorkspaceChatArchiveControl } from './WorkspaceChatLifecycleControls'
import { WorktreeContextMenu, AgentContextMenu } from './WorkspaceContextMenu'
import { conversationState, markConversationSeen, useConversationSeen } from '@features/workspace/chat/conversation-status'
import { ConversationStatusDot } from '@features/workspace/chat/ConversationStatusDot'
type TreeProps = { query: string; onSelect: (id: string) => void; onInspectTask?: (issue: IssueListItem, owner: IssueInspectionOwner) => void; refreshKey?: number }
type Observation = { scope: string; worktrees: ProjectWorktree[]; sessions: WorkspaceChatSession[]; archives: WorkspaceChatSession[]; running: RunningEntry[]; warnings: Record<string, string>; loading: boolean; error?: string }

export function ProjectWorkspaceTree({ query, onSelect, onInspectTask, refreshKey }: TreeProps) {
  const projects = useAppStore(state => state.projects)
  const visible = projects.filter(project => `${project.name} ${project.root_path}`.toLowerCase().includes(query.toLowerCase()))
  return <div aria-label="Projects" className="h-full min-h-0 overflow-auto px-2 py-1">
    {!projects.length && <p className="p-2 text-xs text-muted-foreground">No projects yet</p>}
    {!!projects.length && !visible.length && <p className="p-2 text-xs text-muted-foreground">No matching projects</p>}
    {visible.map(project => <ProjectNode key={project.id} project={project} onSelect={onSelect} onInspectTask={onInspectTask} refreshKey={refreshKey} />)}
  </div>
}

function ProjectNode({ project, onSelect, onInspectTask, refreshKey }: Omit<TreeProps, 'query'> & { project: Project }) {
  const config = useAppStore(state => state.config)
  const activeProjectId = useAppStore(state => state.activeProjectId)
  const selections = useAppStore(state => state.workspaceSelections)
  const issues = useAppStore(state => state.allBoardIssues)
  const openTerminals = useAppStore(state => state.openTerminals)
  const [expanded, setExpanded] = useState(true)
  const [revision, setRevision] = useState(0)
  const [closedWorkspaceKeys, setClosedWorkspaceKeys] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      setRevision(value => value + 1)
    }
  }, [refreshKey])
  const [activeWorktreeMenu, setActiveWorktreeMenu] = useState<{
    x: number
    y: number
    worktree: ProjectWorktree
    workspace: SelectedProjectWorkspace
    closeView: () => void
    requestId?: string
    retryAllowed?: boolean
  } | null>(null)
  const [activeAgentMenu, setActiveAgentMenu] = useState<{
    x: number
    y: number
    row: WorkspaceAgentRow
    workspace: SelectedProjectWorkspace
  } | null>(null)
  const [removeTargetWorktreeId, setRemoveTargetWorktreeId] = useState<string | null>(null)
  const scope = JSON.stringify([config?.baseUrl, config?.apiToken, project.id])
  const [observation, setObservation] = useState<Observation>({ scope: '', worktrees: [], sessions: [], archives: [], running: [], warnings: {}, loading: false })
  useEffect(() => {
    if (!expanded || !config) return
    let cancelled = false
    let busy = false
    const observe = async () => {
      if (busy) return
      busy = true
      setObservation(previous => ({ ...previous, loading: true, error: undefined }))
      try {
        const response = await fetchProjectWorktrees(config, project.id)
        if (!Array.isArray(response.worktrees) || response.worktrees.some(row => !row.id || !row.path)) throw new Error('Workspace observation returned an invalid response.')
        const [state, archivesResult, ...chats] = await Promise.allSettled([
          fetchState(config),
          listWorkspaceChatArchives(config, project.id),
          ...response.worktrees.map(row => listWorkspaceChatSessions({ ...config, workspaceId: row.id }, project.id)),
        ])
        const warnings: Record<string, string> = {}
        const sessions: WorkspaceChatSession[] = []
        const archives = archivesResult.status === 'fulfilled' && 'sessions' in archivesResult.value && Array.isArray(archivesResult.value.sessions) ? archivesResult.value.sessions : []
        if (archivesResult.status === 'rejected') warnings.archives = 'Archived conversation history unavailable.'
        chats.forEach((result, index) => {
          const id = response.worktrees[index].id
          if (result.status === 'fulfilled' && 'sessions' in result.value && Array.isArray(result.value.sessions)) sessions.push(...result.value.sessions)
          else warnings[id] = 'Agent sessions unavailable. Refresh to retry.'
        })
        const running = state.status === 'fulfilled' && 'running' in state.value ? state.value.running : []
        if (state.status === 'rejected') warnings.runtime = 'Live task agents unavailable.'
        if (!cancelled) setObservation({ scope, worktrees: response.worktrees, sessions, archives, running, warnings, loading: false })
      } catch (error) {
        if (!cancelled) setObservation(previous => ({ ...previous, sessions: [], archives: [], running: [], loading: false, error: error instanceof Error ? error.message : 'Workspace observation unavailable' }))
      } finally { busy = false }
    }
    void observe()
    const interval = setInterval(() => { void observe() }, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [expanded, config, project.id, revision, scope])
  const current = observation.scope === scope
  const selected = config ? selections[`${config.baseUrl}::${project.id}`] : undefined
  const inspectTask = (issue: IssueListItem) => {
    if (!config || !current || issue.project_id !== project.id) return
    onInspectTask?.(issue, { projectId: project.id, baseUrl: config.baseUrl, apiToken: config.apiToken })
  }
  return <section className="mb-3 min-w-0" aria-label={project.name}>
    <div className="group/project relative flex h-7 min-w-0 items-center gap-1 px-2">
      <button type="button" onClick={() => { onSelect(project.id); setExpanded(true) }} aria-current={activeProjectId === project.id ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-semibold" title={project.root_path}><Folder size={15} className="shrink-0 text-muted-foreground" /><span className="truncate">{project.name}</span></button>
      <div className="flex shrink-0 items-center text-muted-foreground opacity-60 group-hover/project:opacity-100 group-focus-within/project:opacity-100">
        <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="rounded p-1 hover:bg-muted"><ChevronDown size={12} className={expanded ? '' : '-rotate-90'} /></button>
        <button type="button" aria-label={`Create worktree in ${project.name}`} title="Create worktree" onClick={() => useAppStore.getState().openCreateWorktreeDialog(project.id)} className="rounded p-1 hover:bg-muted"><Plus size={14} /></button>
      </div>
    </div>
    {expanded && <div className="min-w-0 space-y-1 pt-1">
      {observation.loading && !current && <p className="px-3 py-1 text-[11px] text-muted-foreground">Loading workspaces…</p>}
      {observation.error && <div className="px-3 py-1 text-[11px] text-muted-foreground"><p role="alert">{observation.error}</p><button type="button" onClick={() => setRevision(value => value + 1)} className="mt-1 flex items-center gap-1"><RefreshCw size={11} />Retry</button></div>}
      {current && observation.worktrees.map(worktree => {
        const workspace: SelectedProjectWorkspace = { projectId: project.id, workspaceId: worktree.id, path: worktree.path, branch: worktree.branch, registered: worktree.primary, isMain: worktree.is_main_worktree }
        const isSelected = activeProjectId === project.id && (selected ? selected.workspaceId === worktree.id : worktree.primary)
        const tasks = issues.filter(issue => issue.project_id === project.id && issue.branch_name === worktree.branch && !!issue.branch_name)
        const rows = projectWorkspaceAgentRows(project.id, worktree, observation.sessions, observation.running, openTerminals)
        const workspaceKey = `${scope}:${worktree.id}`
        const viewClosed = closedWorkspaceKeys.has(workspaceKey)
        const activate = () => {
          if (worktree.prunable || !worktree.id) return
          setClosedWorkspaceKeys(previous => { const next = new Set(previous); next.delete(workspaceKey); return next })
          useAppStore.getState().selectProjectWorkspace(project.id, workspace)
        }
        const closeView = () => {
          setClosedWorkspaceKeys(previous => new Set(previous).add(workspaceKey))
          const store = useAppStore.getState()
          const currentWorkspace = config ? store.workspaceSelections[`${config.baseUrl}::${project.id}`] : undefined
          if (store.activeProjectId !== project.id || (currentWorkspace ? currentWorkspace.workspaceId !== worktree.id : !worktree.primary)) return
          store.closeProjectTab(project.id)
          const nextProject = useAppStore.getState().activeProjectId
          store.setSelectedProjectID(nextProject === GLOBAL_PROJECT_ID ? null : nextProject)
          store.setActiveSection('PROJECTS')
        }
        return <div
          key={worktree.id}
          role="button"
          tabIndex={worktree.prunable ? -1 : 0}
          aria-disabled={worktree.prunable}
          aria-label={`Open ${project.name} workspace ${worktree.branch || 'Detached'}`}
          aria-pressed={isSelected}
          onClick={activate}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activate() } }}
          onContextMenu={event => {
            event.preventDefault()
            event.stopPropagation()
            setActiveAgentMenu(null)
            setActiveWorktreeMenu({
              x: event.clientX,
              y: event.clientY,
              worktree,
              workspace,
              closeView,
            })
          }}
          className={`min-w-0 cursor-pointer rounded-lg border px-3 py-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${isSelected ? 'border-border bg-muted/40' : 'border-transparent hover:bg-muted/20'}`}
          title={worktree.path}
        >
          <div className="flex min-w-0 items-center gap-2 text-[13px]"><GitBranch size={13} className="shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">{worktree.branch || worktree.head.slice(0, 8) || 'Detached'}</span>{worktree.is_main_worktree && <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] leading-none text-muted-foreground">primary</span>}{worktree.locked && <span className="text-[10px] text-muted-foreground">locked</span>}{worktree.prunable && <span className="text-[10px] text-muted-foreground">missing</span>}{config && <WorktreeRemovalControls config={config} projectId={project.id} projectName={project.name} worktree={worktree} onCloseWorkspace={closeView} openDialog={removeTargetWorktreeId === worktree.id} onOpenDialogChange={open => { if (!open && removeTargetWorktreeId === worktree.id) setRemoveTargetWorktreeId(null) }} onOpenMenu={info => { setActiveAgentMenu(null); setActiveWorktreeMenu({ x: info.x, y: info.y, worktree, workspace, closeView, requestId: info.requestId, retryAllowed: info.retryAllowed }) }} onRemoved={() => setRevision(value => value + 1)} />}
            <button type="button" disabled={worktree.prunable} aria-label={`New agent in ${project.name} workspace ${worktree.branch || 'Detached'}`} onClick={event => { event.stopPropagation(); activate(); useAppStore.getState().openCreateAgentDialog(workspace) }} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"><Plus size={12} /></button>
          </div>
          {!viewClosed && <WorkspaceAgents config={config!} workspace={workspace} rows={rows} onArchived={() => setRevision(value => value + 1)} onInspectTask={row => { const issue = issues.find(issue => issue.project_id === project.id && issue.id === row.taskId); if (issue) inspectTask(issue) }} onAgentContextMenu={(event, row) => { setActiveWorktreeMenu(null); setActiveAgentMenu({ x: event.clientX, y: event.clientY, row, workspace }) }} />}
          {!viewClosed && tasks.map(issue => <button type="button" aria-label={`Inspect task ${issue.identifier ?? issue.issue_identifier}`} disabled={!onInspectTask} onClick={event => { event.stopPropagation(); activate(); inspectTask(issue) }} key={issue.id ?? issue.identifier} className="block h-6 w-full truncate pl-5 text-left text-[11px] text-muted-foreground hover:text-foreground" title={`${issue.title} · ${issue.state}`}>{issue.identifier ?? issue.issue_identifier} · {issue.title}</button>)}
          {observation.warnings[worktree.id] && <p className="pl-5 text-[10px] text-muted-foreground">{observation.warnings[worktree.id]}</p>}
        </div>
      })}
      {current && config && observation.warnings.archives && <p role="status" className="px-3 text-[10px] text-muted-foreground">{observation.warnings.archives}</p>}
      {current && config && <WorkspaceArchiveHistory config={config} projectId={project.id} sessions={observation.archives} worktrees={observation.worktrees} onChanged={() => setRevision(value => value + 1)} />}
      {current && observation.warnings.runtime && <p className="px-3 text-[10px] text-muted-foreground">{observation.warnings.runtime}</p>}
      {current && !observation.loading && !observation.error && !observation.worktrees.length && <p className="px-3 py-1 text-[11px] text-muted-foreground">No worktrees observed.</p>}
      {activeWorktreeMenu && (
        <WorktreeContextMenu
          x={activeWorktreeMenu.x}
          y={activeWorktreeMenu.y}
          worktree={activeWorktreeMenu.worktree}
          project={project}
          workspace={activeWorktreeMenu.workspace}
          config={config}
          requestId={activeWorktreeMenu.requestId}
          retryAllowed={activeWorktreeMenu.retryAllowed}
          onClose={() => setActiveWorktreeMenu(null)}
          onRefresh={() => setRevision(value => value + 1)}
          onCloseWorkspace={activeWorktreeMenu.closeView}
          onRequestRemove={() => {
            setRemoveTargetWorktreeId(activeWorktreeMenu.worktree.id)
            setActiveWorktreeMenu(null)
          }}
        />
      )}
      {activeAgentMenu && (
        <AgentContextMenu
          x={activeAgentMenu.x}
          y={activeAgentMenu.y}
          row={activeAgentMenu.row}
          workspace={activeAgentMenu.workspace}
          onClose={() => setActiveAgentMenu(null)}
          onInspectTask={row => {
            const issue = issues.find(issue => issue.project_id === project.id && issue.id === row.taskId)
            if (issue) inspectTask(issue)
          }}
          onStopTurn={async row => {
            if (config && row.sessionId) {
              try {
                await stopWorkspaceChatTurn(config, project.id, row.sessionId)
                setRevision(value => value + 1)
              } catch { /* turn stop handling */ }
            }
          }}
          onRequestArchive={row => {
            const btn = document.querySelector<HTMLButtonElement>(`[aria-label*="Archive conversation ${row.title}"]`)
              || document.querySelector<HTMLButtonElement>(`[aria-label*="archive conversation ${row.title}"]`)
            btn?.click()
          }}
        />
      )}
    </div>}
  </section>
}

function WorkspaceAgents({ config, workspace, rows, onInspectTask, onArchived, onAgentContextMenu }: { config: BackendConfig; workspace: SelectedProjectWorkspace; rows: WorkspaceAgentRow[]; onInspectTask: (row: WorkspaceAgentRow) => void; onArchived: () => void; onAgentContextMenu?: (event: React.MouseEvent, row: WorkspaceAgentRow) => void }) {
  const [expanded, setExpanded] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const seen = useConversationSeen(config.baseUrl)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  if (!rows.length) return null
  return <div className="mt-1 min-w-0 pl-5">
    {rows.length > 1 && <button type="button" aria-label={(expanded ? 'Collapse' : 'Expand') + ' workspace activity in ' + workspace.workspaceId} aria-expanded={expanded} onClick={event => { event.stopPropagation(); setExpanded(value => !value) }} className="flex h-6 w-full items-center justify-between text-left text-[11px] text-muted-foreground"><span>{rows.length} workspace items</span><ChevronDown size={12} className={expanded ? '' : '-rotate-90'} /></button>}
    {(rows.length === 1 || expanded) && rows.map(row => <div key={row.key} onContextMenu={event => { if (onAgentContextMenu) { event.preventDefault(); event.stopPropagation(); onAgentContextMenu(event, row) } }} className="group/session flex min-w-0 items-center">
      {row.source === 'terminal' ? <div role="status" aria-label={'Terminal tab ' + row.title + '; runtime state unverified'} className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded text-[11px] text-muted-foreground" title={row.preview}>
        <Terminal size={12} className="shrink-0" /><span className="min-w-0 flex-1 truncate"><span className="text-foreground/80">{row.title}</span><span aria-hidden="true"> · </span><span>runtime unverified</span></span>
      </div> : <button type="button" onClick={event => { event.stopPropagation(); useAppStore.getState().selectProjectWorkspace(workspace.projectId, workspace); if (row.source === 'runtime') onInspectTask(row); else { if (row.session) markConversationSeen(config.baseUrl, row.session.id, row.session.updated_at); useAppStore.getState().requestWorkspaceConversation(workspace.projectId, row.sessionId, workspace) } }} aria-label={row.source === 'runtime' ? 'Inspect running task ' + row.taskIdentifier : 'Open ' + row.provider + (row.source === 'native' ? ' native chat ' : row.source === 'transcript' ? ' transcript ' : ' conversation; mode unreported ') + row.title} className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring" title={`${row.provider || 'Provider unreported'} · ${row.status} · ${row.preview}`}>
        <ConversationStatusDot state={row.session ? conversationState(row.session, seen) : ['running', 'starting'].includes(row.status) ? 'working' : row.status === 'failed' ? 'failed' : row.status === 'interrupted' ? 'interrupted' : 'idle'} />
        <span className="shrink-0">{getAgentIcon(row.provider, 13)}</span><span className="min-w-0 flex-1 truncate"><span className="text-foreground/80">{row.title}</span>{row.source !== 'runtime' && <span> · {row.source === 'native' ? 'Native chat' : row.source === 'transcript' ? 'Transcript' : 'Mode unreported'}</span>}{row.preview && <span> – {row.preview}</span>}</span>
        {row.model && <span className="max-w-20 shrink-0 truncate font-mono text-[10px]" title={(row.modelObserved ? 'Observed' : 'Requested') + ' model: ' + row.model}>{row.model}</span>}<span className="shrink-0 text-[10px]" title={row.timestamp}>{shortObservedAge(row.timestamp, now)}</span>
      </button>}
      {row.session && row.source !== 'runtime' && row.source !== 'terminal' && <WorkspaceChatArchiveControl config={config} projectId={workspace.projectId} workspaceId={workspace.workspaceId} cwd={workspace.path} session={row.session} onArchived={onArchived} />}
    </div>)}
  </div>
}
