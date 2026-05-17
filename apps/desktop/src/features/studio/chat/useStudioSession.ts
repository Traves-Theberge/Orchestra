import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioDraft } from '@core/api/client'
import { useDraft } from '../draft/useDraft'

export interface ChatMessage {
  role: 'user' | 'agent'
  text: string
  tool?: { name: string; args: unknown }
  ts: number
}

interface StudioInnerEvent {
  session_id: string
  kind: string
  payload: unknown
}

interface SSEEnvelope {
  type: string
  data: StudioInnerEvent
}

export interface StudioSessionClient {
  studioEventsURL: (sessionId: string) => string
  getStudioDraft: (sessionId: string) => Promise<StudioDraft>
  sendStudioMessage: (sessionId: string, message: string) => Promise<void>
  patchStudioDraft: (sessionId: string, patch: Partial<StudioDraft>) => Promise<void>
  pushStudioToBacklog: (sessionId: string) => Promise<{ issue_id: string }>
  discardStudioSession: (sessionId: string) => Promise<void>
}

export interface UseStudioSessionOptions {
  createEventSource?: (url: string) => EventSource
}

export interface UseStudioSessionResult {
  draft: StudioDraft | null
  messages: ChatMessage[]
  connected: boolean
  sending: boolean
  sendMessage: (text: string) => Promise<void>
  editDraft: (patch: Partial<StudioDraft>) => Promise<void>
  push: () => Promise<{ issue_id: string }>
  discard: () => Promise<void>
}

function defaultCreateEventSource(url: string): EventSource {
  return new EventSource(url)
}

export function useStudioSession(
  sessionId: string,
  client: StudioSessionClient,
  options: UseStudioSessionOptions = {},
): UseStudioSessionResult {
  const { draft, applyServerSnapshot, setLocal } = useDraft(sessionId)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [sending, setSending] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const createRef = useRef(options.createEventSource ?? defaultCreateEventSource)
  createRef.current = options.createEventSource ?? defaultCreateEventSource

  useEffect(() => {
    let cancelled = false
    client
      .getStudioDraft(sessionId)
      .then((d) => {
        if (!cancelled) applyServerSnapshot(d)
      })
      .catch(() => {})

    const es = createRef.current(client.studioEventsURL(sessionId))
    esRef.current = es
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => {
      let inner: StudioInnerEvent | null = null
      try {
        const parsed = JSON.parse(e.data) as SSEEnvelope | StudioInnerEvent
        if (parsed && typeof parsed === 'object' && 'data' in parsed && parsed.data && 'kind' in parsed.data) {
          inner = parsed.data
        } else if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
          inner = parsed as StudioInnerEvent
        }
      } catch {
        return
      }
      if (!inner) return

      switch (inner.kind) {
        case 'draft.updated':
          applyServerSnapshot(inner.payload as StudioDraft)
          break
        case 'chat.message': {
          const p = inner.payload as { role: ChatMessage['role']; text: string }
          setMessages((prev) => [...prev, { role: p.role, text: p.text, ts: Date.now() }])
          setSending(false)
          break
        }
        case 'tool.call': {
          const p = inner.payload as { name: string; args: unknown }
          setMessages((prev) => [...prev, { role: 'agent', text: '', tool: p, ts: Date.now() }])
          break
        }
        case 'error': {
          const msg = typeof inner.payload === 'string' ? inner.payload : 'Agent error'
          setMessages((prev) => [...prev, { role: 'agent', text: `⚠ ${msg}`, ts: Date.now() }])
          setSending(false)
          break
        }
      }
    }
    return () => {
      cancelled = true
      es.close()
    }
  }, [sessionId, client, applyServerSnapshot])

  const sendMessage = useCallback(
    async (text: string) => {
      setMessages((prev) => [...prev, { role: 'user', text, ts: Date.now() }])
      setSending(true)
      try {
        await client.sendStudioMessage(sessionId, text)
      } finally {
        setSending(false)
      }
    },
    [sessionId, client],
  )

  const editDraft = useCallback(
    async (patch: Partial<StudioDraft>) => {
      setLocal(patch)
      await client.patchStudioDraft(sessionId, patch)
    },
    [sessionId, client, setLocal],
  )

  const push = useCallback(() => client.pushStudioToBacklog(sessionId), [sessionId, client])
  const discard = useCallback(() => client.discardStudioSession(sessionId), [sessionId, client])

  return { draft, messages, connected, sending, sendMessage, editDraft, push, discard }
}
