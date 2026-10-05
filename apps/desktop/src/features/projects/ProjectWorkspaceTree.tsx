import { useEffect, useState } from 'react'
import { AlertCircle, Bot, ChevronDown, ChevronRight, Circle, CircleDot, Folder, GitBranch, LoaderCircle, PauseCircle, Plus, RefreshCw } from 'lucide-react'
import { useAppStore } from '@core/store'
import { fetchProjectWorktrees, listWorkspaceChatSessions, type ProjectWorktree, type WorkspaceChatSession } from '@core/api/client'
import type { Project } from '@core/api/types'
import type { IssueListItem } from '@core/api/client'
import type { IssueInspectionOwner } from '@/hooks/use-issue-actions'

export function ProjectWorkspaceTree({ query, onSelect, onInspectTask }: { query: string; onSelect: (id: string) => void; onInspectTask?: (issue: IssueListItem, owner: IssueInspectionOwner) => void }) {
  const projects = useAppStore(state => state.projects)
  const visibleProjects = projects.filter(project => `${project.name} ${project.root_path}`.toLowerCase().includes(query.toLowerCase()))
  return <div aria-label="Projects" className="min-h-0 overflow-auto px-2 py-1">
    {projects.length === 0 && <p className="p-2 text-xs text-muted-foreground">No projects yet</p>}
    {projects.length > 0 && visibleProjects.length === 0 && <p className="p-2 text-xs text-muted-foreground">No matching projects</p>}
    {visibleProjects.map(project => <ProjectNode key={project.id} project={project} onSelect={onSelect} onInspectTask={onInspectTask} />)}
  </div>
}

function ProjectNode({ project, onSelect, onInspectTask }: { project: Project; onSelect: (id: string) => void; onInspectTask?: (issue: IssueListItem, owner: IssueInspectionOwner) => void }) {
  const config = useAppStore(state => state.config)
  const activeProjectId = useAppStore(state => state.activeProjectId)
  const issues = useAppStore(state => state.allBoardIssues)
  const [expanded, setExpanded] = useState(activeProjectId === project.id)
  const [revision, setRevision] = useState(0)
  const scope = JSON.stringify([config?.baseUrl, config?.apiToken, project.id])
  const [observation, setObservation] = useState<{ scope?: string; worktrees: ProjectWorktree[]; sessions: WorkspaceChatSession[]; loading: boolean; error?: string }>({ worktrees: [], sessions: [], loading: false })
  useEffect(() => {
    if (!expanded || !config) return
    let cancelled = false
    Promise.resolve().then(() => { if (!cancelled) setObservation(previous => ({ ...previous, loading: true, error: undefined })) })
    Promise.all([fetchProjectWorktrees(config, project.id), listWorkspaceChatSessions(config, project.id)]).then(([worktrees, sessions]) => {
      if (!Array.isArray(worktrees.worktrees) || !Array.isArray(sessions.sessions)) throw new Error('Workspace observation returned an invalid response. Refresh before selecting a session.')
      if (!cancelled) setObservation({ scope, worktrees: worktrees.worktrees, sessions: sessions.sessions, loading: false })
    }).catch(error => { if (!cancelled) setObservation(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Workspace observation unavailable' })) })
    return () => { cancelled = true }
  }, [expanded, config, project.id, revision, scope])
  const currentObservation = observation.scope === scope
  const inspectTask = (issue: IssueListItem) => {
    if (!config || !currentObservation || issue.project_id !== project.id) return
    onSelect(project.id)
    onInspectTask?.(issue, { projectId: project.id, baseUrl: config.baseUrl, apiToken: config.apiToken })
  }
  return <div className="mb-3 min-w-0">
    <div className="group/project flex min-w-0 items-center gap-1 rounded-md px-1 hover:bg-muted/30">
      <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
      <button type="button" onClick={() => { onSelect(project.id); setExpanded(true) }} aria-current={activeProjectId === project.id ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2.5 text-left text-[13px] font-semibold" title={project.root_path}><Folder size={15} className="shrink-0 text-muted-foreground" /><span className="truncate">{project.name}</span></button>
      <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100">
        <button type="button" aria-label={`Refresh workspaces in ${project.name}`} title="Refresh workspaces" disabled={observation.loading} onClick={() => { setExpanded(true); setRevision(value => value + 1) }} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"><RefreshCw size={12} className={observation.loading ? 'animate-spin' : ''} /></button>
        <button type="button" aria-label={`Create task in ${project.name}`} title="Create task/worktree" onClick={() => { onSelect(project.id); useAppStore.getState().openCreateTaskDialog() }} className="rounded p-1 text-muted-foreground hover:bg-muted"><Plus size={14} /></button>
      </div>
    </div>
    {expanded && <div className="ml-3 min-w-0 space-y-1">
      {observation.loading && <p className="py-1 text-[11px] text-muted-foreground">Loading workspaces…</p>}
      {observation.error && <div className="py-1 text-[11px] text-muted-foreground"><p role="alert">{observation.error}</p><button onClick={() => setRevision(value => value + 1)} className="mt-1 flex items-center gap-1"><RefreshCw size={11} />Retry</button></div>}
      {currentObservation && observation.worktrees.map(worktree => {
        const tasks = issues.filter(issue => issue.project_id === project.id && issue.branch_name === worktree.branch && !!issue.branch_name)
        const canOpen = worktree.primary || (!!onInspectTask && tasks.length === 1)
        return <div key={worktree.path} className={`min-w-0 rounded-lg border px-2 py-2 ${activeProjectId === project.id && worktree.primary ? 'border-border bg-muted/40' : 'border-transparent hover:bg-muted/20'}`}>
          <button type="button" disabled={!canOpen || worktree.prunable} onClick={() => { if (worktree.primary) onSelect(project.id); else if (tasks[0]) inspectTask(tasks[0]) }} aria-label={`Open ${project.name} workspace ${worktree.branch || 'Detached'}`} className="flex w-full min-w-0 items-center gap-2 rounded text-left text-[13px] disabled:cursor-default focus-visible:ring-1 focus-visible:ring-ring" title={worktree.path}><GitBranch size={13} className="shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">{worktree.branch || worktree.head.slice(0, 8) || 'Detached'}</span>{worktree.primary && <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] leading-none text-muted-foreground">primary</span>}{worktree.locked && <span className="shrink-0 text-[10px] text-muted-foreground">locked</span>}{worktree.prunable && <span className="shrink-0 text-[10px] text-muted-foreground">missing</span>}</button>
          {!canOpen && <p className="mt-1 pl-5 text-[10px] text-muted-foreground">{tasks.length > 1 ? 'Select a linked task below' : 'Observed worktree · no linked task'}</p>}
          {tasks.map(issue => <button type="button" disabled={!onInspectTask} onClick={() => inspectTask(issue)} key={issue.id ?? issue.identifier} className="mt-2 block w-full truncate pl-5 text-left text-[11px] text-muted-foreground hover:text-foreground" title={`${issue.title} · ${issue.state}`}>{issue.identifier ?? issue.issue_identifier} · {issue.title}</button>)}
          {worktree.primary && <WorkspaceAgents projectId={project.id} sessions={observation.sessions.filter(session => session.project_id === project.id)} onSelect={onSelect} />}
        </div>
      })}
      {currentObservation && !observation.loading && !observation.error && observation.worktrees.length === 0 && <p className="py-1 text-[11px] text-muted-foreground">No worktrees observed.</p>}
    </div>}
  </div>
}

function WorkspaceAgents({ projectId, sessions, onSelect }: { projectId: string; sessions: WorkspaceChatSession[]; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true)
  if (sessions.length === 0) return null
  return <div className="mt-2 min-w-0 pl-5">
    <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} agent sessions in ${projectId}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex w-full items-center justify-between rounded py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"><span>{sessions.length} agent{sessions.length === 1 ? '' : 's'}</span><ChevronDown size={12} className={expanded ? '' : '-rotate-90'} /></button>
    {expanded && <div className="space-y-0.5">{sessions.map(session => {
      const StatusIcon = session.status === 'running' ? CircleDot : session.status === 'failed' ? AlertCircle : session.status === 'interrupted' ? PauseCircle : session.status === 'stopping' ? LoaderCircle : Circle
      const statusClass = session.status === 'running' ? 'text-emerald-500' : session.status === 'failed' ? 'text-destructive' : session.status === 'interrupted' ? 'text-amber-500' : 'text-muted-foreground'
      return <button type="button" key={session.id} onClick={() => { onSelect(projectId); useAppStore.getState().requestWorkspaceConversation(projectId, session.id) }} aria-label={`Open ${session.provider} conversation ${session.title}`} className="flex w-full min-w-0 items-center gap-1.5 rounded py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring" title={`${session.provider} · ${session.status} · ${session.id}`}><StatusIcon size={11} className={`shrink-0 ${statusClass} ${session.status === 'stopping' ? 'animate-spin' : ''}`} /><Bot size={13} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{session.title || 'Conversation'}</span><span className="max-w-14 shrink-0 truncate text-[10px]">{session.provider}</span></button>
    })}</div>}
  </div>
}
