import type { WorkspaceChatSession, ProjectWorktree } from '@core/api/client'
import type { RunningEntry } from '@core/api/types'
import type { TerminalNode } from '@features/terminal/TerminalMultiplexer'

export type WorkspaceAgentRow = {
  key: string
  source: 'native' | 'transcript' | 'conversation' | 'runtime' | 'terminal'
  sessionId: string
  session?: WorkspaceChatSession
  taskId?: string
  taskIdentifier?: string
  provider: string
  title: string
  preview: string
  status: string
  model: string
  modelObserved: boolean
  timestamp: string
}

type ScopedNativeSession = WorkspaceChatSession & { workspace_id?: string; workspace_path?: string; last_message?: string }
type ScopedRuntime = RunningEntry & { worktree_path?: string; requested_model?: string }

/** Compare observed canonical paths; never derive cwd from a branch label. */
export function sameObservedPath(left: string, right: string): boolean {
  const normalize = (path: string) => {
    const windows = /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\')
    const normalized = (windows ? path.replaceAll('\\', '/') : path).replace(/\/+$/, '')
    return windows ? normalized.toLowerCase() : normalized
  }
  return !!left && !!right && normalize(left) === normalize(right)
}

export function projectWorkspaceAgentRows(
  projectId: string,
  workspace: ProjectWorktree & { id: string },
  sessions: ScopedNativeSession[],
  running: ScopedRuntime[],
  terminals: TerminalNode[] = [],
): WorkspaceAgentRow[] {
  const native = sessions.filter(session => !!session.id && session.project_id === projectId && session.workspace_id === workspace.id && sameObservedPath(session.workspace_path || '', workspace.path)).map(session => ({
    key: `conversation:${session.id}`, source: session.conversation_mode === 'native_session' ? 'native' as const : session.conversation_mode === 'transcript_replay' ? 'transcript' as const : 'conversation' as const, sessionId: session.id, session,
    provider: session.provider, title: session.title || 'Conversation',
    preview: session.last_message || session.error || session.status,
    status: session.status, model: session.effective_model || session.requested_model || '',
    modelObserved: !!session.effective_model, timestamp: session.updated_at || session.created_at,
  }))
  const runtime = running.filter(run => !!run.issue_id && run.project_id === projectId && sameObservedPath(run.worktree_path || '', workspace.path)).map(run => ({
    key: `runtime:${run.issue_id}:${run.session_id || ''}`, source: 'runtime' as const,
    sessionId: run.session_id || '', taskId: run.issue_id, taskIdentifier: run.issue_identifier,
    provider: run.provider || '', title: run.title || run.issue_identifier,
    preview: run.last_message || run.last_event || (run.session_id ? run.state : 'Starting'),
    status: run.session_id ? run.state.toLowerCase() : 'starting',
    model: run.effective_model || run.requested_model || '', modelObserved: !!run.effective_model, timestamp: run.started_at || run.last_event_at || '',
  }))
  const openTerminals = terminals.filter(terminal => terminal.projectId === projectId && sameObservedPath(terminal.cwd || '', workspace.path)).map(terminal => ({
    key: `terminal:${terminal.id}`, source: 'terminal' as const, sessionId: terminal.id,
    provider: 'Terminal', title: terminal.title || 'Terminal',
    preview: 'Open terminal tab; backend runtime status is unverified.',
    status: 'runtime_unverified', model: '', modelObserved: false, timestamp: '',
  }))
  return [...native, ...runtime, ...openTerminals]
}

export function shortObservedAge(timestamp: string, now: number): string {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) return ''
  const seconds = Math.max(0, Math.floor((now - time) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}
