import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createStudioSession,
  discardStudioSession,
  getStudioDraft,
  patchStudioDraft,
  pushStudioToBacklog,
  sendStudioMessage,
  studioEventsURL,
  type BackendConfig,
} from '@core/api/client'

const config: BackendConfig = {
  baseUrl: 'http://127.0.0.1:4000',
  apiToken: 'token-123',
}

interface Call {
  url: string
  init?: RequestInit
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockFetch(handler: (call: Call) => Response): { calls: Call[]; fetchMock: ReturnType<typeof vi.fn> } {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init })
    return handler({ url, init })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

describe('studio client', () => {
  it('creates a session', async () => {
    const { calls } = mockFetch(() =>
      new Response(JSON.stringify({ session_id: 'sess1', sse_url: '/api/v1/studio/sessions/sess1/events' }), { status: 201 }),
    )

    const res = await createStudioSession(config, { project_id: 'p', runner: 'claude-code' })

    expect(res.session_id).toBe('sess1')
    expect(calls[0]?.url).toBe('http://127.0.0.1:4000/api/v1/studio/sessions')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(String(calls[0]?.init?.body)).toContain('"runner":"claude-code"')
  })

  it('sends a message', async () => {
    const { calls } = mockFetch(() => new Response(null, { status: 204 }))

    await sendStudioMessage(config, 'sess1', 'hello')

    expect(calls[0]?.url).toBe('http://127.0.0.1:4000/api/v1/studio/sessions/sess1/message')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(String(calls[0]?.init?.body)).toContain('"message":"hello"')
  })

  it('gets the draft', async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({
          session_id: 'sess1',
          title: 'T',
          description: 'D',
          acceptance_criteria: [],
          attachments: [],
          suggested_provider: '',
          suggested_model: '',
          template_vars: {},
          agent_guidance: {},
        }),
        { status: 200 },
      ),
    )

    const draft = await getStudioDraft(config, 'sess1')
    expect(draft.title).toBe('T')
  })

  it('patches the draft', async () => {
    const { calls } = mockFetch(() => new Response(null, { status: 204 }))

    await patchStudioDraft(config, 'sess1', { title: 'New' })

    expect(calls[0]?.url).toBe('http://127.0.0.1:4000/api/v1/studio/sessions/sess1/draft')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(String(calls[0]?.init?.body)).toBe('{"title":"New"}')
  })

  it('pushes to backlog', async () => {
    const { calls } = mockFetch(() => new Response(JSON.stringify({ issue_id: 'ISS-1' }), { status: 200 }))

    const res = await pushStudioToBacklog(config, 'sess1')

    expect(res.issue_id).toBe('ISS-1')
    expect(calls[0]?.url).toBe('http://127.0.0.1:4000/api/v1/studio/sessions/sess1/push')
    expect(calls[0]?.init?.method).toBe('POST')
  })

  it('discards a session', async () => {
    const { calls } = mockFetch(() => new Response(null, { status: 204 }))

    await discardStudioSession(config, 'sess1')

    expect(calls[0]?.url).toBe('http://127.0.0.1:4000/api/v1/studio/sessions/sess1')
    expect(calls[0]?.init?.method).toBe('DELETE')
  })

  it('builds the SSE URL', () => {
    const url = studioEventsURL(config, 'sess1')
    expect(url).toBe('http://127.0.0.1:4000/api/v1/studio/sessions/sess1/events?token=token-123')
  })
})
