import { useCallback, useEffect, useState } from 'react'
import { SquarePen, Trash2 } from 'lucide-react'
import { useAppStore } from '@core/store'
import { deleteWorkspaceChatSession, listWorkspaceChatSessions, type WorkspaceChatSession } from '@core/api/client'
import { HarnessIcon } from '@ui/HarnessIcon'

export const MAESTRO_SCOPE = '__orchestrator__'
/** Fired by a chat when its selected conversation changes: detail = { projectId, sessionId }. */
export const CHAT_SESSION_EVENT = 'orchestra:chat-session'

function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

/** Sidebar list of Maestro conversations: pick one or start a new one in the Maestro chat. */
export function MaestroConversations() {
  const config = useAppStore(s => s.config)
  const [sessions, setSessions] = useState<WorkspaceChatSession[]>([])
  const [currentId, setCurrentId] = useState('')
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState('')
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(() => {
    if (!config) return
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

  const remove = async (sessionId: string) => {
    if (!config) return
    setDeleting(true)
    try {
      await deleteWorkspaceChatSession(config, MAESTRO_SCOPE, sessionId)
      setSessions(previous => previous.filter(session => session.id !== sessionId))
      setConfirmId('')
      setError('')
      // Deleting the open conversation leaves Maestro on a fresh one.
      if (sessionId === currentId) open('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the conversation')
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
        if (confirmId === session.id) return <div key={session.id} role="group" aria-label={`Delete ${title}?`} className="flex h-8 w-full items-center gap-1.5 rounded-lg bg-destructive/10 px-2 text-[12px]">
          <span className="min-w-0 flex-1 truncate text-foreground">Delete “{title}”?</span>
          <button type="button" onClick={() => void remove(session.id)} disabled={deleting} className="shrink-0 rounded px-1.5 py-0.5 font-medium text-destructive hover:bg-destructive/15 disabled:opacity-50">Delete</button>
          <button type="button" onClick={() => setConfirmId('')} className="shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">Cancel</button>
        </div>
        return <div key={session.id} className={`group/conversation flex h-8 w-full items-center rounded-lg transition-colors ${active ? 'bg-foreground/[0.08] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'}`}>
          <button type="button" aria-current={active ? 'page' : undefined} onClick={() => open(session.id)} title={session.title}
            className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left text-[12.5px]">
            <HarnessIcon id={session.provider.toLowerCase()} size={13} />
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {running && <span aria-label="Working" className="size-1.5 shrink-0 rounded-full bg-primary" />}
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70 group-hover/conversation:hidden">{ago(session.updated_at || session.created_at)}</span>
          </button>
          <button type="button" aria-label={`Delete ${title}`} title={running ? 'Stop the running turn before deleting' : 'Delete conversation'} disabled={running} onClick={() => setConfirmId(session.id)}
            className="mr-1 hidden size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:flex disabled:opacity-40 group-hover/conversation:flex">
            <Trash2 size={12} />
          </button>
        </div>
      })}
      {!sorted.length && !error && <p className="px-2 py-2 text-[12px] text-muted-foreground">No conversations yet.</p>}
      {error && <p role="alert" className="px-2 py-2 text-[12px] text-destructive">{error}</p>}
    </nav>
  </div>
}
