import { useCallback, useEffect, useState } from 'react'
import { Circle, SquarePen, Trash2 } from 'lucide-react'
import { useAppStore } from '@core/store'
import { deleteWorkspaceChatSession, listWorkspaceChatSessions, stopWorkspaceChatTurn, type WorkspaceChatSession } from '@core/api/client'
import { getAgentIcon } from '@layout/shared/controls'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@ui/dialog'
import { ConversationContextMenu } from '@features/projects/WorkspaceContextMenu'
import { shortObservedAge } from '@features/projects/workspace-agent-projection'

export const MAESTRO_SCOPE = '__orchestrator__'
/** Fired by a chat when its selected conversation changes: detail = { projectId, sessionId }. */
export const CHAT_SESSION_EVENT = 'orchestra:chat-session'

const modeLabel = (mode: string) => mode === 'native_session' ? 'Native chat' : mode === 'transcript_replay' ? 'Transcript' : 'Mode unreported'
const statusColor = (status: string) => status === 'running' || status === 'stopping' ? 'text-emerald-500' : status === 'failed' ? 'text-destructive' : status === 'interrupted' ? 'text-amber-500' : 'text-muted-foreground'

/** Sidebar list of Maestro conversations, styled like the conversations under project worktrees. */
export function MaestroConversations() {
  const config = useAppStore(s => s.config)
  const [sessions, setSessions] = useState<WorkspaceChatSession[]>([])
  const [currentId, setCurrentId] = useState('')
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; session: WorkspaceChatSession } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<WorkspaceChatSession | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(() => {
    if (!config) return
    setNow(Date.now())
    void listWorkspaceChatSessions(config, MAESTRO_SCOPE)
      .then(result => { setSessions(Array.isArray(result.sessions) ? result.sessions : []); setError('') })
      .catch(() => setError('Conversations unavailable'))
  }, [config])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 5000)
    const onSession = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; sessionId: string }>).detail
      if (detail?.projectId !== MAESTRO_SCOPE) return
      setCurrentId(detail.sessionId)
      load()
    }
    window.addEventListener(CHAT_SESSION_EVENT, onSession)
    return () => { window.clearInterval(timer); window.removeEventListener(CHAT_SESSION_EVENT, onSession) }
  }, [load])

  const open = (sessionId: string) => {
    const state = useAppStore.getState()
    if (!state.config) return
    state.setActiveSection('ORCHESTRATOR')
    // The Maestro chat consumes this request; an empty id starts a new conversation.
    useAppStore.setState({ requestedWorkspaceConversation: { baseUrl: state.config.baseUrl, apiToken: state.config.apiToken, projectId: MAESTRO_SCOPE, sessionId, requestId: Date.now() } })
  }

  const stop = (sessionId: string) => {
    if (!config) return
    void stopWorkspaceChatTurn(config, MAESTRO_SCOPE, sessionId).catch(() => setError('Could not stop the turn')).finally(load)
  }

  const confirmDelete = async () => {
    if (!config || !pendingDelete) return
    const id = pendingDelete.id
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteWorkspaceChatSession(config, MAESTRO_SCOPE, id)
      setSessions(previous => previous.filter(session => session.id !== id))
      setPendingDelete(null)
      // Deleting the open conversation leaves Maestro on a fresh one.
      if (id === currentId) open('')
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Could not delete the conversation')
    } finally {
      setDeleting(false)
      load()
    }
  }

  const sorted = [...sessions].sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at))
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 px-2 pb-1">
      <button type="button" onClick={() => open('')} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
        <SquarePen size={14} className="shrink-0" />New conversation
      </button>
    </div>
    <p className="shrink-0 px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">Conversations</p>
    <nav aria-label="Maestro conversations" className="min-h-0 flex-1 overflow-auto px-2 pb-2">
      {sorted.map(session => {
        const active = session.id === currentId
        const running = session.status === 'running' || session.status === 'stopping'
        const title = session.title || 'Untitled conversation'
        return <div key={session.id} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, session }) }}
          className={`group/session flex min-w-0 items-center gap-0.5 rounded pl-1.5 ${active ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.04]'}`}>
          <button type="button" aria-label={`Open conversation ${title}`} aria-current={active ? 'page' : undefined} onClick={() => open(session.id)} title={title}
            className="flex h-6 min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] text-muted-foreground">
            <Circle size={10} className={`shrink-0 ${statusColor(session.status)}`} />
            <span className="shrink-0">{getAgentIcon(session.provider.toLowerCase(), 13)}</span>
            <span className="min-w-0 flex-1 truncate"><span className={active ? 'text-foreground' : 'text-foreground/80'}>{title}</span><span> · {modeLabel(session.conversation_mode)}</span></span>
            <span className="shrink-0 text-[10px]" title={session.updated_at || session.created_at}>{shortObservedAge(session.updated_at || session.created_at, now)}</span>
          </button>
          <button type="button" aria-label={`Delete conversation ${title}`} title={running ? 'Stop the running turn before deleting' : 'Delete conversation'} disabled={running}
            onClick={event => { event.stopPropagation(); setDeleteError(''); setPendingDelete(session) }}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-destructive focus-visible:opacity-100 disabled:opacity-0 group-hover/session:opacity-100 group-hover/session:disabled:opacity-40">
            <Trash2 size={12} />
          </button>
        </div>
      })}
      {!sorted.length && !error && <p className="px-2 py-2 text-[12px] text-muted-foreground">No conversations yet.</p>}
      {error && <p role="alert" className="px-2 py-2 text-[12px] text-destructive">{error}</p>}
    </nav>
    {menu && <ConversationContextMenu x={menu.x} y={menu.y} title={menu.session.title || 'Untitled conversation'} provider={menu.session.provider.toLowerCase()} status={menu.session.status}
      mode={modeLabel(menu.session.conversation_mode)} sessionId={menu.session.id} onClose={() => setMenu(null)}
      onOpen={() => open(menu.session.id)} onStopTurn={() => stop(menu.session.id)} onRequestDelete={() => { setDeleteError(''); setPendingDelete(menu.session) }} />}
    <Dialog open={!!pendingDelete} onOpenChange={value => { if (!value && !deleting) setPendingDelete(null) }}>
      <DialogContent srTitle="Delete conversation?" showCloseButton={!deleting} className="max-w-lg">
        <div className="space-y-2">
          <DialogTitle>Delete conversation?</DialogTitle>
          <DialogDescription>This permanently removes the conversation and its history from Orchestra. It can't be undone. Workspace files are not touched.</DialogDescription>
          {pendingDelete && <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium">{pendingDelete.title || 'Untitled conversation'}</p>
            <p className="mt-1 text-muted-foreground">Maestro · {modeLabel(pendingDelete.conversation_mode)}</p>
          </div>}
        </div>
        {deleteError && <p role="alert" className="text-xs text-destructive">{deleteError}</p>}
        <DialogFooter className="gap-2">
          <button type="button" disabled={deleting} onClick={() => setPendingDelete(null)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">Cancel</button>
          <button type="button" disabled={deleting} onClick={() => void confirmDelete()} className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50">{deleting ? 'Deleting...' : 'Delete conversation'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
