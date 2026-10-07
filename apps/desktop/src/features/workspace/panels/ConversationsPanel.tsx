import { useEffect, useState } from 'react'
import { MessageSquare, Plus, Search, Loader2 } from 'lucide-react'
import { useAppStore } from '@core/store'
import { projectIdForWorkspaceContext } from '@core/store/workspace-context'
import { listWorkspaceChatSessions, type WorkspaceChatSession } from '@core/api/client'

export function ConversationsPanel({ projectId }: { projectId: string }) {
  const config = useAppStore((s) => s.config)
  const actualProjectId = useAppStore((s) => projectIdForWorkspaceContext(s, projectId))
  const requestedConversation = useAppStore((s) => s.requestedWorkspaceConversation)
  const [sessions, setSessions] = useState<WorkspaceChatSession[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loadSessions = async () => {
    if (!config || !actualProjectId) return
    setLoading(true)
    setError(null)
    try {
      const result = await listWorkspaceChatSessions(config, actualProjectId)
      if (Array.isArray(result?.sessions)) {
        setSessions(result.sessions)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSessions()
  }, [config, actualProjectId])

  const filteredSessions = sessions.filter((s) => {
    if (!search.trim()) return true
    const term = search.toLowerCase()
    return (s.title || '').toLowerCase().includes(term) || (s.provider || '').toLowerCase().includes(term)
  })

  const currentSessionId = requestedConversation?.projectId === actualProjectId ? requestedConversation.sessionId : undefined

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-primary" />
          <span className="text-xs font-semibold">Conversations</span>
          {sessions.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium">
              {sessions.length}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="New chat"
          onClick={() => {
            useAppStore.getState().requestWorkspaceConversation(actualProjectId, '')
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs"
        >
          <Plus size={13} />
          New chat
        </button>
      </div>

      {/* Filter / Search */}
      {sessions.length > 3 && (
        <div className="p-2 border-b border-border/30">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-2.5 text-muted-foreground/60" />
            <input
              type="text"
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border/60 bg-muted/40 py-1 pl-7 pr-2 text-xs placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
        {loading && sessions.length === 0 && (
          <div className="flex items-center justify-center p-8 text-xs text-muted-foreground gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading conversations…
          </div>
        )}
        {error && (
          <div role="alert" className="p-3 text-xs text-destructive rounded-md bg-destructive/10">
            {error}
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground gap-2">
            <MessageSquare size={24} className="text-muted-foreground/40" />
            <p className="text-xs">No conversations yet.</p>
            <button
              type="button"
              onClick={() => {
                useAppStore.getState().requestWorkspaceConversation(actualProjectId, '')
              }}
              className="mt-1 text-xs text-primary hover:underline"
            >
              Start a new conversation
            </button>
          </div>
        )}
        {filteredSessions.map((session) => {
          const isActive = currentSessionId === session.id
          return (
            <button
              key={session.id}
              type="button"
              aria-label={`Open conversation: ${session.title || 'Conversation'}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                useAppStore.getState().requestWorkspaceConversation(actualProjectId, session.id)
              }}
              className={`w-full rounded-lg p-2.5 text-left transition-colors flex flex-col gap-1 ${
                isActive
                  ? 'bg-accent text-accent-foreground font-medium shadow-xs'
                  : 'hover:bg-muted/60 text-foreground'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium">{session.title || 'Conversation'}</span>
                {session.status && (
                  <span className="shrink-0 text-[10px] text-muted-foreground capitalize">
                    {session.status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="capitalize">{session.provider}</span>
                {session.created_at && (
                  <>
                    <span>·</span>
                    <span>{new Date(session.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
