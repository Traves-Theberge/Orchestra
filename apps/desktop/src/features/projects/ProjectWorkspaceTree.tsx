import { useEffect, useState } from 'react'
import { ChevronDown, Circle, Folder, GitBranch, Plus, RefreshCw } from 'lucide-react'
import { useAppStore } from '@core/store'
import { fetchProjectWorktrees, fetchState, listWorkspaceChatSessions, type ProjectWorktree, type WorkspaceChatSession, type IssueListItem } from '@core/api/client'
import type { Project, RunningEntry } from '@core/api/types'
import type { SelectedProjectWorkspace } from '@core/store/types'
import type { IssueInspectionOwner } from '@/hooks/use-issue-actions'
import { getAgentIcon } from '@/layout/shared/controls'
import { projectWorkspaceAgentRows, shortObservedAge, type WorkspaceAgentRow } from './workspace-agent-projection'

type TreeProps = { query: string; onSelect: (id: string) => void; onInspectTask?: (issue: IssueListItem, owner: IssueInspectionOwner) => void }
type Observation = { scope: string; worktrees: ProjectWorktree[]; sessions: WorkspaceChatSession[]; running: RunningEntry[]; warnings: Record<string, string>; loading: boolean; error?: string }

export function ProjectWorkspaceTree({ query, onSelect, onInspectTask }: TreeProps) {
  const projects = useAppStore(state => state.projects)
  const visible = projects.filter(project => `${project.name} ${project.root_path}`.toLowerCase().includes(query.toLowerCase()))
  return <div aria-label="Projects" className="h-full min-h-0 overflow-auto px-2 py-1">
    {!projects.length && <p className="p-2 text-xs text-muted-foreground">No projects yet</p>}
    {!!projects.length && !visible.length && <p className="p-2 text-xs text-muted-foreground">No matching projects</p>}
    {visible.map(project => <ProjectNode key={project.id} project={project} onSelect={onSelect} onInspectTask={onInspectTask} />)}
  </div>
}

function ProjectNode({ project, onSelect, onInspectTask }: Omit<TreeProps, 'query'> & { project: Project }) {
  const config = useAppStore(state => state.config)
  const activeProjectId = useAppStore(state => state.activeProjectId)
  const selections = useAppStore(state => state.workspaceSelections)
  const issues = useAppStore(state => state.allBoardIssues)
  const [expanded, setExpanded] = useState(true)
  const [revision, setRevision] = useState(0)
  const scope = JSON.stringify([config?.baseUrl, config?.apiToken, project.id])
  const [observation, setObservation] = useState<Observation>({ scope: '', worktrees: [], sessions: [], running: [], warnings: {}, loading: false })
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
        const [state, ...chats] = await Promise.allSettled([
          fetchState(config),
          ...response.worktrees.map(row => listWorkspaceChatSessions({ ...config, workspaceId: row.id }, project.id)),
        ])
        const warnings: Record<string, string> = {}
        const sessions: WorkspaceChatSession[] = []
        chats.forEach((result, index) => {
          const id = response.worktrees[index].id
          if (result.status === 'fulfilled' && 'sessions' in result.value && Array.isArray(result.value.sessions)) sessions.push(...result.value.sessions)
          else warnings[id] = 'Agent sessions unavailable. Refresh to retry.'
        })
        const running = state.status === 'fulfilled' && 'running' in state.value ? state.value.running : []
        if (state.status === 'rejected') warnings.runtime = 'Live task agents unavailable.'
        if (!cancelled) setObservation({ scope, worktrees: response.worktrees, sessions, running, warnings, loading: false })
      } catch (error) {
        if (!cancelled) setObservation(previous => ({ ...previous, sessions: [], running: [], loading: false, error: error instanceof Error ? error.message : 'Workspace observation unavailable' }))
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
        <button type="button" aria-label={`Refresh workspaces for ${project.name}`} title="Refresh workspaces" disabled={observation.loading} onClick={() => { setExpanded(true); setRevision(value => value + 1) }} className="rounded p-1 hover:bg-muted disabled:opacity-40"><RefreshCw size={12} className={observation.loading ? 'animate-spin' : ''} /></button>
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
        const rows = projectWorkspaceAgentRows(project.id, worktree, observation.sessions, observation.running)
        const activate = () => { if (!worktree.prunable && worktree.id) useAppStore.getState().selectProjectWorkspace(project.id, workspace) }
        return <div key={worktree.id} role="button" tabIndex={worktree.prunable ? -1 : 0} aria-disabled={worktree.prunable} aria-label={`Open ${project.name} workspace ${worktree.branch || 'Detached'}`} aria-pressed={isSelected} onClick={activate} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activate() } }} className={`min-w-0 cursor-pointer rounded-lg border px-3 py-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${isSelected ? 'border-border bg-muted/40' : 'border-transparent hover:bg-muted/20'}`} title={worktree.path}>
          <div className="flex min-w-0 items-center gap-2 text-[13px]"><GitBranch size={13} className="shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">{worktree.branch || worktree.head.slice(0, 8) || 'Detached'}</span>{worktree.is_main_worktree && <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] leading-none text-muted-foreground">primary</span>}{worktree.locked && <span className="text-[10px] text-muted-foreground">locked</span>}{worktree.prunable && <span className="text-[10px] text-muted-foreground">missing</span>}</div>
          <button type="button" disabled={worktree.prunable} aria-label={`New agent in ${project.name} workspace ${worktree.branch || 'Detached'}`} onClick={event => { event.stopPropagation(); useAppStore.getState().openCreateAgentDialog(workspace) }} className="float-right -mt-5 rounded p-1 text-muted-foreground hover:bg-muted"><Plus size={12} /></button>
          <WorkspaceAgents workspace={workspace} rows={rows} onInspectTask={row => { const issue = issues.find(issue => issue.project_id === project.id && issue.id === row.taskId); if (issue) inspectTask(issue) }} />
          {tasks.map(issue => <button type="button" aria-label={`Inspect task ${issue.identifier ?? issue.issue_identifier}`} disabled={!onInspectTask} onClick={event => { event.stopPropagation(); activate(); inspectTask(issue) }} key={issue.id ?? issue.identifier} className="block h-6 w-full truncate pl-5 text-left text-[11px] text-muted-foreground hover:text-foreground" title={`${issue.title} · ${issue.state}`}>{issue.identifier ?? issue.issue_identifier} · {issue.title}</button>)}
          {observation.warnings[worktree.id] && <p className="pl-5 text-[10px] text-muted-foreground">{observation.warnings[worktree.id]}</p>}
        </div>
      })}
      {current && observation.warnings.runtime && <p className="px-3 text-[10px] text-muted-foreground">{observation.warnings.runtime}</p>}
      {current && !observation.loading && !observation.error && !observation.worktrees.length && <p className="px-3 py-1 text-[11px] text-muted-foreground">No worktrees observed.</p>}
    </div>}
  </section>
}

function WorkspaceAgents({ workspace, rows, onInspectTask }: { workspace: SelectedProjectWorkspace; rows: WorkspaceAgentRow[]; onInspectTask: (row: WorkspaceAgentRow) => void }) {
  const [expanded, setExpanded] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  if (!rows.length) return null
  return <div className="mt-1 min-w-0 pl-5">
    {rows.length > 1 && <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} agent sessions in ${workspace.workspaceId}`} aria-expanded={expanded} onClick={event => { event.stopPropagation(); setExpanded(value => !value) }} className="flex h-6 w-full items-center justify-between text-left text-[11px] text-muted-foreground"><span>{rows.length} agents</span><ChevronDown size={12} className={expanded ? '' : '-rotate-90'} /></button>}
    {(rows.length === 1 || expanded) && rows.map(row => <button type="button" key={row.key} onClick={event => { event.stopPropagation(); useAppStore.getState().selectProjectWorkspace(workspace.projectId, workspace); if (row.source === 'native') useAppStore.getState().requestWorkspaceConversation(workspace.projectId, row.sessionId, workspace); else onInspectTask(row) }} aria-label={row.source === 'native' ? `Open ${row.provider} conversation ${row.title}` : `Inspect running task ${row.taskIdentifier}`} className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring" title={`${row.provider || 'Provider unreported'} · ${row.status} · ${row.preview}`}>
      <Circle size={10} className={`shrink-0 ${['running', 'starting'].includes(row.status) ? 'text-emerald-500' : row.status === 'failed' ? 'text-destructive' : row.status === 'interrupted' ? 'text-amber-500' : 'text-muted-foreground'}`} />
      <span className="shrink-0">{getAgentIcon(row.provider, 13)}</span><span className="min-w-0 flex-1 truncate"><span className="text-foreground/80">{row.title}</span>{row.preview && <span> – {row.preview}</span>}</span>
      {row.model && <span className="max-w-20 shrink-0 truncate font-mono text-[10px]" title={`${row.modelObserved ? 'Observed' : 'Requested'} model: ${row.model}`}>{row.model}</span>}<span className="shrink-0 text-[10px]" title={row.timestamp}>{shortObservedAge(row.timestamp, now)}</span>
    </button>)}
  </div>
}
