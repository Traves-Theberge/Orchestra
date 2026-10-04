import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useStudioSession, type StudioSessionClient } from './useStudioSession'
import type { StudioDraft } from '@core/api/client'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onopen: ((e: Event) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  url: string
  closed = false
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
  triggerOpen() {
    this.onopen?.(new Event('open'))
  }
  close() {
    this.closed = true
  }
}

const emptyDraft: StudioDraft = {
  session_id: 'sess1',
  title: '',
  description: '',
  acceptance_criteria: [],
  attachments: [],
  suggested_provider: '',
  suggested_model: '',
  template_vars: {},
  agent_guidance: {},
}

function makeClient(overrides: Partial<StudioSessionClient> = {}): StudioSessionClient {
  return {
    studioEventsURL: (id: string) => `/sse/${id}`,
    getStudioDraft: vi.fn().mockResolvedValue(emptyDraft),
    sendStudioMessage: vi.fn().mockResolvedValue(undefined),
    patchStudioDraft: vi.fn().mockResolvedValue(undefined),
    pushStudioToBacklog: vi.fn().mockResolvedValue({ issue_id: 'ISS-1' }),
    discardStudioSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useStudioSession', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
  })

  function renderSession(client: StudioSessionClient) {
    return renderHook(() =>
      useStudioSession('sess1', client, {
        createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource,
      }),
    )
  }

  it('loads the initial draft snapshot', async () => {
    const client = makeClient({ getStudioDraft: vi.fn().mockResolvedValue({ ...emptyDraft, title: 'Seed' }) })
    const { result } = renderSession(client)
    await waitFor(() => expect(result.current.draft?.title).toBe('Seed'))
  })

  it('applies draft updates from SSE (wrapped envelope)', async () => {
    const { result } = renderSession(makeClient())
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => {
      FakeEventSource.instances[0].emit({
        type: 'studio.sess1',
        data: {
          session_id: 'sess1',
          kind: 'draft.updated',
          payload: { ...emptyDraft, title: 'From SSE' },
        },
      })
    })
    expect(result.current.draft?.title).toBe('From SSE')
  })

  it('appends chat messages from SSE', async () => {
    const { result } = renderSession(makeClient())
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => {
      FakeEventSource.instances[0].emit({
        type: 'studio.sess1',
        data: { session_id: 'sess1', kind: 'chat.message', payload: { role: 'agent', text: 'Hi' } },
      })
    })
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toMatchObject({ role: 'agent', text: 'Hi' })
  })

  it('records tool calls as agent messages', async () => {
    const { result } = renderSession(makeClient())
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => {
      FakeEventSource.instances[0].emit({
        type: 'studio.sess1',
        data: { session_id: 'sess1', kind: 'tool.call', payload: { name: 'set_title', args: { title: 'X' } } },
      })
    })
    expect(result.current.messages[0]?.tool?.name).toBe('set_title')
  })

  it('sendMessage appends optimistic user message and calls client', async () => {
    const client = makeClient()
    const { result } = renderSession(client)
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    await act(async () => {
      await result.current.sendMessage('hello')
    })
    expect(result.current.messages[0]).toMatchObject({ role: 'user', text: 'hello' })
    expect(client.sendStudioMessage).toHaveBeenCalledWith('sess1', 'hello')
    expect(result.current.sending).toBe(true)
    act(() => FakeEventSource.instances[0].emit({ session_id: 'sess1', kind: 'session.status', payload: { status: 'turn_completed' } }))
    expect(result.current.sending).toBe(false)
  })

  it('clears sending after a rejected request', async () => {
    const client = makeClient({ sendStudioMessage: vi.fn().mockRejectedValue(new Error('unauthorized')) })
    const { result } = renderSession(client)
    await act(async () => { await expect(result.current.sendMessage('hello')).rejects.toThrow('unauthorized') })
    expect(result.current.sending).toBe(false)
  })

  it('does not clear a new session submission when an old request fails', async () => {
    let rejectOld!: (reason: Error) => void
    const client = makeClient({ sendStudioMessage: vi.fn((id: string) => id === 'sess1'
      ? new Promise<void>((_, reject) => { rejectOld = reject }) : Promise.resolve()) })
    const { result, rerender } = renderHook(({ id }) => useStudioSession(id, client, {
      createEventSource: url => new FakeEventSource(url) as unknown as EventSource,
    }), { initialProps: { id: 'sess1' } })
    let oldRequest!: Promise<void>
    act(() => { oldRequest = result.current.sendMessage('old').catch(() => {}) })
    rerender({ id: 'sess2' })
    expect(result.current.sending).toBe(false)
    await act(async () => { await result.current.sendMessage('new') })
    await act(async () => { rejectOld(new Error('late error')); await oldRequest })
    expect(result.current.sending).toBe(true)
  })

  it('editDraft applies optimistic local change and calls client', async () => {
    const client = makeClient()
    const { result } = renderSession(client)
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    await act(async () => {
      await result.current.editDraft({ title: 'Optimistic' })
    })
    expect(result.current.draft?.title).toBe('Optimistic')
    expect(client.patchStudioDraft).toHaveBeenCalledWith('sess1', { title: 'Optimistic' })
  })

  it('connected flag follows open/error events', async () => {
    const { result } = renderSession(makeClient())
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => FakeEventSource.instances[0].triggerOpen())
    expect(result.current.connected).toBe(true)
  })

  it('closes the event source on unmount', async () => {
    const { unmount } = renderSession(makeClient())
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    unmount()
    expect(FakeEventSource.instances[0].closed).toBe(true)
  })

  it('clears visible state on session switch and ignores retired or wrong-session events', async () => {
    let resolveSecond!: (draft: StudioDraft) => void
    const client = makeClient({ getStudioDraft: vi.fn((id: string) => id === 'sess1'
      ? Promise.resolve(emptyDraft)
      : new Promise<StudioDraft>(resolve => { resolveSecond = resolve })) })
    const { result, rerender } = renderHook(({ id }) => useStudioSession(id, client, {
      createEventSource: url => new FakeEventSource(url) as unknown as EventSource,
    }), { initialProps: { id: 'sess1' } })
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const old = FakeEventSource.instances[0]
    act(() => {
      old.triggerOpen()
      old.emit({ session_id: 'sess1', kind: 'chat.message', payload: { role: 'agent', text: 'old' } })
    })
    rerender({ id: 'sess2' })
    expect(result.current.draft).toBeNull()
    expect(result.current.messages).toEqual([])
    expect(result.current.connected).toBe(false)
    act(() => {
      old.triggerOpen()
      old.emit({ session_id: 'sess1', kind: 'chat.message', payload: { role: 'agent', text: 'late' } })
      FakeEventSource.instances[1].emit({ session_id: 'sess1', kind: 'draft.updated', payload: emptyDraft })
      resolveSecond({ ...emptyDraft, session_id: 'sess2', title: 'second' })
    })
    await waitFor(() => expect(result.current.draft?.title).toBe('second'))
    expect(result.current.messages).toEqual([])
    expect(result.current.connected).toBe(false)
    expect(old.closed).toBe(true)
  })

  it('does not let a delayed initial GET overwrite a newer stream snapshot', async () => {
    let resolveInitial!: (draft: StudioDraft) => void
    const client = makeClient({ getStudioDraft: vi.fn(() => new Promise<StudioDraft>(resolve => { resolveInitial = resolve })) })
    const { result } = renderSession(client)
    act(() => FakeEventSource.instances[0].emit({ session_id: 'sess1', kind: 'draft.updated', payload: { ...emptyDraft, title: 'newer' } }))
    await act(async () => resolveInitial({ ...emptyDraft, title: 'stale GET' }))
    expect(result.current.draft?.title).toBe('newer')
  })
})
