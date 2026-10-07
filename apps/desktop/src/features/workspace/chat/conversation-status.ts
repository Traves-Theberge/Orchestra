import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { WorkspaceChatSession } from '@core/api/client'

/** Sidebar state vocabulary for a conversation row (after Orca's agent state dots). */
export type ConversationState = 'working' | 'needs-input' | 'done' | 'failed' | 'interrupted' | 'idle'

export const CONVERSATION_SEEN_EVENT = 'orchestra:chat-seen'
const BASELINE = '__baseline__'

type SeenMap = Record<string, string>

const storageKey = (baseUrl: string) => `orchestra:chat-last-seen:v1:${baseUrl}`

function readSeen(baseUrl: string): SeenMap {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey(baseUrl)) ?? 'null')
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as SeenMap
  } catch { /* Unavailable storage reads as nothing seen beyond the baseline. */ }
  return {}
}

function writeSeen(baseUrl: string, seen: SeenMap) {
  try { localStorage.setItem(storageKey(baseUrl), JSON.stringify(seen)) } catch { /* Best effort: the indicator is advisory. */ }
}

/**
 * Per-backend "last seen" receipts. The first read records a baseline so
 * conversations that finished before this feature existed don't all show done.
 */
export function conversationSeenMap(baseUrl: string): SeenMap {
  const seen = readSeen(baseUrl)
  if (!seen[BASELINE]) {
    seen[BASELINE] = new Date().toISOString()
    writeSeen(baseUrl, seen)
  }
  return seen
}

/** Records that the user has seen a conversation as of its `updatedAt`. */
export function markConversationSeen(baseUrl: string, sessionId: string, updatedAt: string) {
  if (!baseUrl || !sessionId) return
  const seen = conversationSeenMap(baseUrl)
  const previous = Date.parse(seen[sessionId] ?? '')
  const next = Date.parse(updatedAt)
  const value = Number.isFinite(next) ? updatedAt : new Date().toISOString()
  if (Number.isFinite(previous) && Number.isFinite(next) && previous >= next) return
  seen[sessionId] = value
  writeSeen(baseUrl, seen)
  window.dispatchEvent(new CustomEvent(CONVERSATION_SEEN_EVENT, { detail: { baseUrl, sessionId } }))
}

export function conversationState(session: Pick<WorkspaceChatSession, 'id' | 'status' | 'updated_at' | 'created_at'> & { pending_requests?: number }, seen: SeenMap): ConversationState {
  if (session.status === 'running' || session.status === 'stopping') return (session.pending_requests ?? 0) > 0 ? 'needs-input' : 'working'
  if (session.status === 'failed' || session.status === 'unknown') return 'failed'
  if (session.status === 'interrupted') return 'interrupted'
  const updated = Date.parse(session.updated_at || '')
  if (!Number.isFinite(updated) || updated <= Date.parse(session.created_at || '')) return 'idle'
  const lastSeen = Date.parse(seen[session.id] ?? seen[BASELINE] ?? '')
  return Number.isFinite(lastSeen) && updated > lastSeen ? 'done' : 'idle'
}

/** Seen receipts for `baseUrl`, refreshed when any chat marks a conversation seen. */
export function useConversationSeen(baseUrl: string | undefined): SeenMap {
  const subscribe = useCallback((notify: () => void) => {
    if (!baseUrl) return () => {}
    // Record the baseline outside render; until then nothing reads as unseen.
    if (!readSeen(baseUrl)[BASELINE]) { conversationSeenMap(baseUrl); notify() }
    const refresh = (event: Event) => { if ((event as CustomEvent<{ baseUrl: string }>).detail?.baseUrl === baseUrl) notify() }
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey(baseUrl)) notify() }
    window.addEventListener(CONVERSATION_SEEN_EVENT, refresh)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener(CONVERSATION_SEEN_EVENT, refresh); window.removeEventListener('storage', onStorage) }
  }, [baseUrl])
  // The serialized receipt is a stable snapshot; the parsed map is derived from it.
  const raw = useSyncExternalStore(subscribe, () => {
    if (!baseUrl) return ''
    try { return localStorage.getItem(storageKey(baseUrl)) ?? '' } catch { return '' }
  })
  return useMemo(() => {
    if (!baseUrl || !raw) return {}
    return readSeen(baseUrl)
  }, [baseUrl, raw])
}
