import { useState } from 'react'
import { Archive, RotateCcw } from 'lucide-react'
import type { BackendConfig, ProjectWorktree, WorkspaceChatSession, WorkspaceChatSnapshot } from '@core/api/client'
import { fetchArchivedWorkspaceChat, fetchWorkspaceChat, setWorkspaceChatArchived, stopWorkspaceChatTurn } from '@core/api/client'
import { sameObservedPath } from './workspace-agent-projection'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@ui/dialog'

export function WorkspaceChatArchiveControl({
  config,
  projectId,
  workspaceId,
  cwd,
  session,
  onArchived,
}: {
  config: BackendConfig
  projectId: string
  workspaceId: string
  cwd: string
  session: WorkspaceChatSession
  onArchived: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmedIntent, setConfirmedIntent] = useState<{ status: string; lifecycleVersion: number } | null>(null)
  const unknown = session.status === 'unknown'
  const active = session.status === 'running' || session.status === 'stopping'
  const disabled = busy || unknown
  const triggerLabel = unknown
    ? `Archive unavailable for conversation ${session.title}`
    : `${session.status === 'running' ? 'Stop and archive' : session.status === 'stopping' ? 'Wait and archive' : 'Archive'} conversation ${session.title}`
  const unsettledDelivery = (snapshot: WorkspaceChatSnapshot) =>
    snapshot.messages.some(message => message.role === 'user' && ['accepted', 'unknown'].includes(message.status)) ||
    (snapshot.requests ?? []).some(request => ['pending', 'sending', 'unknown'].includes(request.status))
  const exactSession = (snapshot: WorkspaceChatSnapshot) => {
    const actual = snapshot.session
    if (actual.id !== session.id || actual.project_id !== projectId || actual.workspace_id !== workspaceId || !sameObservedPath(actual.workspace_path || '', cwd)) {
      throw new Error('The selected conversation no longer matches this exact workspace. Refresh the workspace list before changing it.')
    }
    return actual
  }
  const archive = async () => {
    setBusy(true)
    setError('')
    try {
      const scopedConfig = { ...config, workspaceId }
      let detail = await fetchWorkspaceChat(scopedConfig, projectId, session.id)
      let selected = exactSession(detail)
      if (selected.status === 'unknown') throw new Error('This conversation has an unknown turn state. No stop or archive was attempted; keep it visible and review its recovery state first.')
      const intent = confirmedIntent
      if (!intent) throw new Error('The archive confirmation state was lost. Refresh the workspace list before changing this conversation.')
      const stopWasExplicitlyConfirmed = intent.status === 'running' || intent.status === 'stopping'
      if ((selected.status === 'running' || selected.status === 'stopping') && !stopWasExplicitlyConfirmed) {
        throw new Error('This conversation became active after the archive confirmation opened. No stop or archive was attempted; refresh its status and choose Stop and archive explicitly if needed.')
      }
      if (selected.status === 'running') {
        if (intent.status !== 'running' || (selected.lifecycle_version ?? 0) !== intent.lifecycleVersion) {
          throw new Error('The conversation state changed after confirmation. No stop or archive was attempted; refresh before choosing Stop and archive.')
        }
        const stopped = await stopWorkspaceChatTurn(scopedConfig, projectId, session.id)
        if (stopped.session.id !== session.id || stopped.session.project_id !== projectId || stopped.session.status !== 'stopping') {
          throw new Error('The selected conversation stop was not confirmed. It remains visible and was not archived.')
        }
      }
      const deadline = Date.now() + 30000
      while (selected.status === 'running' || selected.status === 'stopping') {
        if (Date.now() >= deadline) throw new Error('Stop was requested, but this exact conversation has not reached confirmed settlement. No archive was attempted; retry after its status updates.')
        await new Promise(resolve => setTimeout(resolve, 350))
        detail = await fetchWorkspaceChat(scopedConfig, projectId, session.id)
        selected = exactSession(detail)
        if (selected.status === 'unknown') throw new Error('The selected conversation outcome became unknown. No archive was attempted; keep its history and recovery state visible.')
      }
      if (unsettledDelivery(detail)) throw new Error('This exact conversation still has an accepted or uncertain message/request. No archive was attempted; its recovery state must settle first.')
      await setWorkspaceChatArchived(scopedConfig, projectId, session.id,
        { workspace_id: workspaceId, cwd }, selected.status, selected.lifecycle_version ?? 0, true)
      setOpen(false)
      onArchived()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Conversation archive could not be confirmed.')
    } finally {
      setBusy(false)
    }
  }
  return <>
    <button type="button" aria-label={triggerLabel} title={unknown ? 'Turn state is unknown; no stop or archive will be attempted.' : 'Archive conversation'} disabled={disabled}
      onClick={event => { event.stopPropagation(); setError(''); setConfirmedIntent({ status: session.status, lifecycleVersion: session.lifecycle_version ?? 0 }); setOpen(true) }}
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
      <Archive size={12} />
    </button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
      <DialogContent srTitle="Archive conversation?" showCloseButton={!busy} className="max-w-lg">
        <div className="space-y-2">
          <DialogTitle>Archive conversation?</DialogTitle>
          <DialogDescription>{session.status === 'running' ? 'This conversation has an active turn. Confirming will stop only this selected conversation, wait for the backend to confirm settlement, then archive its metadata. If delivery or settlement is uncertain, it stays visible and unarchived.' : session.status === 'stopping' ? 'A stop is already in progress for this selected conversation. Confirm to wait for settlement before archiving its metadata. Uncertain delivery stays visible and unarchived.' : 'The conversation will leave the active workspace list. Its provider identity and history stay in Orchestra and remain readable from Archived conversations. This does not remove the worktree.'}</DialogDescription>
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium">{session.title}</p>
            <p className="mt-1 break-all font-mono text-muted-foreground">{cwd}</p>
          </div>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">Cancel</button>
          <button type="button" disabled={disabled} onClick={() => void archive()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? (active ? 'Waiting for settlement...' : 'Archiving...') : session.status === 'running' ? 'Stop and archive conversation' : session.status === 'stopping' ? 'Wait and archive conversation' : 'Archive conversation'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

export function WorkspaceArchiveHistory({
  config,
  projectId,
  sessions,
  worktrees,
  onChanged,
}: {
  config: BackendConfig
  projectId: string
  sessions: WorkspaceChatSession[]
  worktrees: ProjectWorktree[]
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<WorkspaceChatSession | null>(null)
  const [detail, setDetail] = useState<WorkspaceChatSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(false)

  const openHistory = async (session: WorkspaceChatSession) => {
    if (!session.workspace_id || !session.workspace_path) {
      setError('This archived record is missing its stored workspace identity.')
      setSelected(session)
      return
    }
    setSelected(session)
    setDetail(null)
    setError('')
    setLoading(true)
    try {
      setDetail(await fetchArchivedWorkspaceChat(config, projectId, session.id, session.workspace_id, session.workspace_path))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Archived history is unavailable.')
    } finally {
      setLoading(false)
    }
  }

  const liveWorktree = selected && worktrees.find(row => row.id === selected.workspace_id && sameObservedPath(row.path, selected.workspace_path || ''))
  const canRestore = !!selected && !!liveWorktree && !['running', 'stopping', 'unknown'].includes(selected.status)
  const restore = async () => {
    if (!selected || !liveWorktree || !selected.workspace_id || !selected.workspace_path) return
    setRestoring(true)
    setError('')
    try {
      await setWorkspaceChatArchived(config, projectId, selected.id,
        { workspace_id: selected.workspace_id, cwd: selected.workspace_path }, selected.status, selected.lifecycle_version ?? 0, false)
      setSelected(null)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Conversation restore could not be confirmed.')
    } finally {
      setRestoring(false)
    }
  }

  if (!sessions.length) return null
  const messages = detail?.messages ?? []
  return <div className="mt-2 border-t border-border/30 pt-1.5">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex h-7 w-full items-center justify-between px-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground">
      <span>Archived conversations ({sessions.length})</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className="space-y-0.5">
      {sessions.map(session => <div key={session.id} className="flex min-w-0 items-center gap-1 pl-2">
        <button type="button" onClick={() => void openHistory(session)} aria-label={`Open archived conversation ${session.title}`} className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground">
          {session.title} <span className="opacity-70">· {session.provider}</span>
        </button>
      </div>)}
    </div>}

    <Dialog open={selected !== null} onOpenChange={open => { if (!open && !restoring) { setSelected(null); setDetail(null); setError('') } }}>
      <DialogContent srTitle="Archived conversation" className="max-w-3xl max-h-[85vh] overflow-hidden">
        <div className="min-h-0 space-y-2">
          <DialogTitle className="truncate">{selected?.title || 'Archived conversation'}</DialogTitle>
          <DialogDescription>{selected?.provider} conversation · archived history is read-only until restored to its exact live workspace.</DialogDescription>
          {selected?.workspace_path && <p className="break-all font-mono text-[10px] text-muted-foreground">{selected.workspace_path}</p>}
          {!liveWorktree && <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">This checkout is no longer available. The retained history can be read here; restore requires the same workspace ID and path to exist again.</p>}
          {loading && <p className="text-xs text-muted-foreground">Loading archived history…</p>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {detail && <div className="max-h-[55vh] space-y-3 overflow-auto rounded-md border border-border p-3">
            {!messages.length && <p className="text-xs text-muted-foreground">No messages in this conversation.</p>}
            {messages.map(message => <article key={message.id} className="space-y-1 text-xs">
              <p className="font-medium capitalize text-muted-foreground">{message.role}</p>
              <p className="whitespace-pre-wrap break-words">{message.text}</p>
            </article>)}
          </div>}
        </div>
        <DialogFooter className="gap-2">
          <button type="button" disabled={restoring} onClick={() => setSelected(null)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">Close</button>
          {canRestore && <button type="button" disabled={restoring} onClick={() => void restore()} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"><RotateCcw size={13} />{restoring ? 'Restoring…' : 'Restore conversation'}</button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
