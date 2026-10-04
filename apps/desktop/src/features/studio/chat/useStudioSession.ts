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
  const [chat, setChat] = useState<{ sessionId: string; messages: ChatMessage[] }>({ sessionId, messages: [] })
  const [connection, setConnection] = useState<{ sessionId: string; connected: boolean }>({ sessionId, connected: false })
  const messages = chat.sessionId === sessionId ? chat.messages : []
  const connected = connection.sessionId === sessionId && connection.connected
  const appendMessage = useCallback((message: ChatMessage) => {
    setChat(previous => ({ sessionId, messages: [...(previous.sessionId === sessionId ? previous.messages : []), message] }))
  }, [sessionId])
  const [submission, setSubmission] = useState<{ sessionId: string; sending: boolean }>({ sessionId, sending: false })
  const sending = submission.sessionId === sessionId && submission.sending
  const esRef = useRef<EventSource | null>(null)
  const createRef = useRef(options.createEventSource ?? defaultCreateEventSource)
  useEffect(() => {
    createRef.current = options.createEventSource ?? defaultCreateEventSource
  }, [options.createEventSource])

  useEffect(() => {
    let cancelled = false
    let receivedSnapshot = false
    client
      .getStudioDraft(sessionId)
      .then((d) => {
        if (!cancelled && !receivedSnapshot) applyServerSnapshot(d)
      })
      .catch(() => {})

    const es = createRef.current(client.studioEventsURL(sessionId))
    esRef.current = es
    es.onopen = () => { if (!cancelled) setConnection({ sessionId, connected: true }) }
    es.onerror = () => { if (!cancelled) setConnection({ sessionId, connected: false }) }
    es.onmessage = (e) => {
      if (cancelled) return
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
      if (!inner || inner.session_id !== sessionId) return

      switch (inner.kind) {
        case 'draft.updated':
          receivedSnapshot = true
          applyServerSnapshot(inner.payload as StudioDraft)
          break
        case 'chat.message': {
          const p = inner.payload as { role: ChatMessage['role']; text: string }
          appendMessage({ role: p.role, text: p.text, ts: Date.now() })
          setSubmission({ sessionId, sending: false })
          break
        }
        case 'tool.call': {
          const p = inner.payload as { name: string; args: unknown }
          appendMessage({ role: 'agent', text: '', tool: p, ts: Date.now() })
          break
        }
        case 'error': {
          const msg = typeof inner.payload === 'string' ? inner.payload : 'Agent error'
          appendMessage({ role: 'agent', text: `⚠ ${msg}`, ts: Date.now() })
          setSubmission({ sessionId, sending: false })
          break
        }
        case 'session.status':
          if ((inner.payload as { status?: string } | null)?.status === 'turn_completed') {
            setSubmission({ sessionId, sending: false })
          }
          break
      }
    }
    return () => {
      cancelled = true
      es.close()
    }
  }, [sessionId, client, applyServerSnapshot, appendMessage])

  const sendMessage = useCallback(
    async (text: string) => {
      appendMessage({ role: 'user', text, ts: Date.now() })
      setSubmission({ sessionId, sending: true })
      try {
        await client.sendStudioMessage(sessionId, text)
      } catch (error) {
        setSubmission(previous => previous.sessionId === sessionId ? { sessionId, sending: false } : previous)
        throw error
      }
    },
    [sessionId, client, appendMessage],
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
