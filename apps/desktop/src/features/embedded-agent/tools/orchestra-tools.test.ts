import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOrchestraTools } from './orchestra-tools'
import { z } from 'zod'

const config = { baseUrl: 'http://localhost:4010', apiToken: 'test-token' }
const options = { toolCallId: 'test', messages: [] }

afterEach(() => vi.unstubAllGlobals())

describe('Orchestra domain tools', () => {
  it('reads task filters through the shared API', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ issues: [{ identifier: 'ORC-1', state: 'Backlog' }] })))
    vi.stubGlobal('fetch', fetch)
    const result = await createOrchestraTools(config).list_issues.execute!({ project_id: 'p1', states: ['Backlog'] }, options)
    expect(result).toEqual({ issues: [{ identifier: 'ORC-1', state: 'Backlog' }] })
    expect(String(fetch.mock.calls[0][0])).toContain('project_id=p1')
  })

  it('creates in Backlog and preserves selected provider/project', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ identifier: 'ORC-2', state: 'Backlog' })))
    vi.stubGlobal('fetch', fetch)
    await createOrchestraTools(config).create_issue.execute!({ title: 'Task', description: '', project_id: 'p1', assignee_id: '', provider: 'codex' }, options)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ title: 'Task', description: '', project_id: 'p1', assignee_id: '', provider: 'codex', state: 'Backlog' })
  })

  it('updates the requested task and propagates backend failure', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'fields_locked', message: 'Task fields are locked' } }), { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    await expect(createOrchestraTools(config).update_issue.execute!({ issue_identifier: 'ORC-1', updates: { title: 'New title' } }, options)).rejects.toThrow('Task fields are locked')
    expect(String(fetch.mock.calls[0][0])).toContain('/issues/ORC-1')
    expect(fetch.mock.calls[0][1].method).toBe('PATCH')
  })

  it('rejects empty identifiers and updates before dispatch', () => {
    const tools = createOrchestraTools(config)
    expect((tools.get_issue.inputSchema as z.ZodType).safeParse({ issue_identifier: ' ' }).success).toBe(false)
    expect((tools.update_issue.inputSchema as z.ZodType).safeParse({ issue_identifier: 'ORC-1', updates: {} }).success).toBe(false)
  })
})
