import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activateWorkspaceChatBranch,
  editWorkspaceChatMessage,
  previewWorkspaceChatRewind,
  regenerateWorkspaceChatResponse,
  undoWorkspaceChatRestore,
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

function mockFetch(handler: (call: Call) => Response): { calls: Call[] } {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init })
    return handler({ url, init })
  }))
  return { calls }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function contentType(call: Call): string | undefined {
  return (call.init?.headers as Record<string, string>)['Content-Type']
}

const PROJECT = 'proj/1 x'
const SESSION = 'sess/1 y'
const PROJECT_BASE = `http://127.0.0.1:4000/api/v1/projects/${encodeURIComponent(PROJECT)}/chat/sessions/${encodeURIComponent(SESSION)}`
const ORCH_BASE = `http://127.0.0.1:4000/api/v1/orchestrator/chat/sessions/${encodeURIComponent(SESSION)}`

describe('rewind client', () => {
  it('previews a rewind', async () => {
    const preview = { message_id: 'm/1 a', has_checkpoint: true, files_available: true, changes: [{ path: 'a.go', kind: 'modify' }], changed_since_turn: [], skipped: 0 }
    const { calls } = mockFetch(() => json(preview))
    expect(await previewWorkspaceChatRewind(config, PROJECT, SESSION, 'm/1 a')).toEqual(preview)
    await previewWorkspaceChatRewind(config, '__orchestrator__', SESSION, 'm1')
    expect(calls[0].url).toBe(`${PROJECT_BASE}/rewind/preview`)
    expect(calls[0].init?.method).toBe('POST')
    expect(contentType(calls[0])).toBe('application/json')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ message_id: 'm/1 a' })
    expect(calls[1].url).toBe(`${ORCH_BASE}/rewind/preview`)
  })

  it('edits a message and omits undefined optional fields', async () => {
    const accepted = { session: { id: 's' }, message: { id: 'm2' } }
    const { calls } = mockFetch(() => json(accepted, 202))
    const input = { message_id: 'm/1', text: 'hi', client_message_id: 'c1', restore_files: true }
    expect(await editWorkspaceChatMessage(config, PROJECT, SESSION, input)).toEqual(accepted)
    await editWorkspaceChatMessage(config, '__orchestrator__', SESSION, { ...input, requested_model: 'gpt', requested_reasoning_effort: undefined, agent_id: 'a', agent_scope: 'project', agent_content_hash: 'h', agent_format: 'md' })
    expect(calls[0].url).toBe(`${PROJECT_BASE}/edit`)
    expect(calls[0].init?.method).toBe('POST')
    expect(contentType(calls[0])).toBe('application/json')
    expect(String(calls[0].init?.body)).toBe(JSON.stringify(input))
    expect(calls[1].url).toBe(`${ORCH_BASE}/edit`)
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ ...input, requested_model: 'gpt', agent_id: 'a', agent_scope: 'project', agent_content_hash: 'h', agent_format: 'md' })
  })

  it('regenerates a response', async () => {
    const accepted = { session: { id: 's' }, message: { id: 'm3' } }
    const { calls } = mockFetch(() => json(accepted, 202))
    const input = { message_id: 'm/1', client_message_id: 'c2', restore_files: false }
    expect(await regenerateWorkspaceChatResponse(config, PROJECT, SESSION, input)).toEqual(accepted)
    await regenerateWorkspaceChatResponse(config, '__orchestrator__', SESSION, input)
    expect(calls[0].url).toBe(`${PROJECT_BASE}/regenerate`)
    expect(calls[0].init?.method).toBe('POST')
    expect(contentType(calls[0])).toBe('application/json')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(input)
    expect(calls[1].url).toBe(`${ORCH_BASE}/regenerate`)
  })

  it('activates a branch', async () => {
    const snapshot = { session: { id: 's' }, messages: [] }
    const { calls } = mockFetch(() => json(snapshot))
    expect(await activateWorkspaceChatBranch(config, PROJECT, SESSION, 'b/1 z', true)).toEqual(snapshot)
    await activateWorkspaceChatBranch(config, '__orchestrator__', SESSION, 'b1', false)
    expect(calls[0].url).toBe(`${PROJECT_BASE}/branches/${encodeURIComponent('b/1 z')}/activate`)
    expect(calls[0].init?.method).toBe('POST')
    expect(contentType(calls[0])).toBe('application/json')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ restore_files: true })
    expect(calls[1].url).toBe(`${ORCH_BASE}/branches/b1/activate`)
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ restore_files: false })
  })

  it('undoes a restore', async () => {
    const result = { written: 2, deleted: 1, failed: [] }
    const { calls } = mockFetch(() => json(result))
    expect(await undoWorkspaceChatRestore(config, PROJECT, SESSION)).toEqual(result)
    await undoWorkspaceChatRestore(config, '__orchestrator__', SESSION)
    expect(calls[0].url).toBe(`${PROJECT_BASE}/restore/undo`)
    expect(calls[0].init?.method).toBe('POST')
    expect(contentType(calls[0])).toBe('application/json')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({})
    expect(calls[1].url).toBe(`${ORCH_BASE}/restore/undo`)
  })

  it('exposes the backend error code', async () => {
    mockFetch(() => json({ error: { code: 'restore_partial', message: 'could not restore a.go' } }, 409))
    await expect(undoWorkspaceChatRestore(config, PROJECT, SESSION)).rejects.toMatchObject({
      code: 'restore_partial',
      message: 'could not restore a.go',
    })
  })
})
