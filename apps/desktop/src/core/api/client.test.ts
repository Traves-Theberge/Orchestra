import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyWorkspaceMigration,
  fetchState,
  fetchProjectGitStatus,
  fetchProjectGitHistory,
  fetchProjectWorktrees,
  createWorktreeJob,
  fetchWorktreeJob,
  fetchPRSnapshot,
  fetchIssueDetail,
  fetchIssueLogs,
  fetchWorkspaceMigrationPlan,
  isUnauthorizedError,
  normalizeEventEnvelope,
  normalizeSnapshotPayload,
  postRefresh,
  mergePR,
  submitPRReview,
  createWorkspaceChatSession,
  renameWorkspaceChatSession,
  sendWorkspaceChatMessage,
  replyWorkspaceChatRequest,
  stopWorkspaceChatTurn,
  toDisplayError,
  type BackendConfig,
} from '@core/api/client'

const config: BackendConfig = {
  baseUrl: 'http://127.0.0.1:4000',
  apiToken: 'token-123',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('scopes title rename and sends the optimistic title separately from creation preferences', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  await renameWorkspaceChatSession({ ...config, workspaceId: 'wt_child' }, 'project/a', 'chat/a', 'New title', 'Old title')
  await createWorkspaceChatSession(config, 'owner', 'codex', 'session-id', { title: 'Named draft', requested_model: 'model' })
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
  expect(new URL(calls[0][0]).pathname).toBe('/api/v1/projects/project%2Fa/chat/sessions/chat%2Fa/title')
  expect(new URL(calls[0][0]).searchParams.get('workspace_id')).toBe('wt_child')
  expect(calls[0][1].method).toBe('PATCH')
  expect(JSON.parse(String(calls[0][1].body))).toEqual({ title: 'New title', expected_title: 'Old title' })
  expect(JSON.parse(String(calls[1][1].body))).toEqual({ provider: 'codex', client_session_id: 'session-id', title: 'Named draft', requested_model: 'model' })
})

it('retains workspace creation identity and leaves creation jobs scoped to their owning project', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const request = { request_id: '7456d633-bd27-4aa2-8f6a-2062281843e9', name: 'new-agent', branch: 'agent/feature', base_ref: 'origin/main', provider: 'CODEX' }
  const scoped = { ...config, workspaceId: 'wt_existing' }
  await createWorktreeJob(scoped, 'owner', request)
  await fetchWorktreeJob(scoped, 'owner', request.request_id)
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
  expect(new URL(calls[0][0]).pathname).toBe('/api/v1/projects/owner/worktree-jobs')
  expect(new URL(calls[1][0]).pathname).toBe(`/api/v1/projects/owner/worktree-jobs/${request.request_id}`)
  expect(calls.every(([url]) => !new URL(url).searchParams.has('workspace_id'))).toBe(true)
  expect(JSON.parse(String(calls[0][1].body))).toEqual(request)
  expect(new Headers(calls[0][1].headers).get('Content-Type')).toBe('application/json')
})

it('carries exact workspace scope to Git and chat, without scoping project or hosted PR identity', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const scoped = { ...config, workspaceId: 'wt_child' }
  await fetchProjectGitStatus(scoped, 'owner')
  await fetchProjectGitHistory(scoped, 'owner')
  await createWorkspaceChatSession(scoped, 'owner', 'CODEX', 'chat-id')
  await fetchProjectWorktrees(scoped, 'owner')
  await fetchPRSnapshot(scoped, 'owner', 7)
  const urls = fetchMock.mock.calls.map(call => new URL(String((call as unknown[])[0])))
  expect(urls.slice(0, 3).map(url => url.searchParams.get('workspace_id'))).toEqual(['wt_child', 'wt_child', 'wt_child'])
  expect(urls.slice(3).map(url => url.searchParams.has('workspace_id'))).toEqual([false, false])
})

it('labels every chat mutation as JSON for the real HTTP content-type guard', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  await createWorkspaceChatSession(config, 'project-a', 'CODEX', 'a5639609-2861-4a70-b6a4-5a97c26132c8')
  await sendWorkspaceChatMessage(config, 'project-a', 'chat-a', 'message-a', 'Inspect this', 'model-a', 'high')
  await replyWorkspaceChatRequest(config, 'project-a', 'chat-a', 'request-a', 'reply-a', { decision: 'decline' })
  await stopWorkspaceChatTurn(config, 'project-a', 'chat-a')
  expect(fetchMock).toHaveBeenCalledTimes(4)
  for (const [, init] of fetchMock.mock.calls) {
    // Browsers otherwise infer text/plain for the JSON string body, causing HTTP 415.
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-123')
  }
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ client_session_id: 'a5639609-2861-4a70-b6a4-5a97c26132c8' })
})

it('routes global orchestrator chat independently from registered projects', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  await createWorkspaceChatSession(config, '__orchestrator__', 'CODEX', 'orchestrator-session')
  await sendWorkspaceChatMessage(config, '__orchestrator__', 'chat-a', 'message-a', 'Observe projects')
  await createWorkspaceChatSession(config, 'project/a', 'CODEX', 'project-session')
  expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
    '/api/v1/orchestrator/chat/sessions',
    '/api/v1/orchestrator/chat/sessions/chat-a/messages',
    '/api/v1/projects/project%2Fa/chat/sessions',
  ])
})

it('sends the reviewed head SHA with the merge mutation', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const sha = 'a'.repeat(40)
  await mergePR(config, 'project/one', 42, 'squash', sha)
  expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4000/api/v1/projects/project%2Fone/github/pulls/42/merge', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ method: 'squash', expected_head_sha: sha }) }))
})

it('sends the displayed commit identity with the review mutation', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const commit = 'c'.repeat(40)
  await submitPRReview(config, 'project/one', 42, 'Reviewed this commit', 'APPROVE', commit)
  expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4000/api/v1/projects/project%2Fone/github/pulls/42/reviews', expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'Reviewed this commit', event: 'APPROVE', commit_id: commit }) }))
})

describe('normalizeSnapshotPayload', () => {
  it('returns safe defaults for malformed payloads', () => {
    const normalized = normalizeSnapshotPayload(null)

    expect(normalized.counts.running).toBe(0)
    expect(normalized.counts.retrying).toBe(0)
    expect(normalized.running).toEqual([])
    expect(normalized.retrying).toEqual([])
    expect(normalized.codex_totals.total_tokens).toBe(0)
    expect(normalized.generated_at.length).toBeGreaterThan(0)
  })

  it('normalizes snapshot fields from mixed payload values', () => {
    const normalized = normalizeSnapshotPayload({
      generated_at: '2026-03-06T00:00:00Z',
      counts: { running: 3, retrying: 1 },
      running: [
        {
          issue_id: 'i-1',
          issue_identifier: 'OPS-1',
          state: 'running',
          session_id: 's-1',
          turn_count: 10,
        },
        'bad-item',
      ],
      retrying: [
        {
          issue_id: 'i-2',
          issue_identifier: 'OPS-2',
          state: 'retrying',
          attempt: 2,
          due_at: '2026-03-06T00:01:00Z',
          error: 'timeout',
        },
      ],
      codex_totals: {
        input_tokens: 12,
        output_tokens: 8,
        total_tokens: 20,
        seconds_running: 5,
      },
      rate_limits: { remaining: 99 },
    })

    expect(normalized.generated_at).toBe('2026-03-06T00:00:00Z')
    expect(normalized.counts).toEqual({ running: 3, retrying: 1 })
    expect(normalized.running).toHaveLength(1)
    expect(normalized.retrying).toHaveLength(1)
    expect(normalized.running[0]?.issue_identifier).toBe('OPS-1')
    expect(normalized.retrying[0]?.attempt).toBe(2)
    expect(normalized.codex_totals.total_tokens).toBe(20)
    expect(normalized.rate_limits).toEqual({ remaining: 99 })
  })
})

describe('normalizeEventEnvelope', () => {
  it('normalizes valid event payload', () => {
    const normalized = normalizeEventEnvelope(
      {
        type: 'RUN_FAILED',
        timestamp: '2026-03-06T00:00:00Z',
        data: { issue_id: 'i-1' },
      },
      'fallback_type',
    )

    expect(normalized.type).toBe('RUN_FAILED')
    expect(normalized.timestamp).toBe('2026-03-06T00:00:00Z')
    expect(normalized.data).toEqual({ issue_id: 'i-1' })
  })

  it('applies fallback values for malformed envelopes', () => {
    const normalized = normalizeEventEnvelope({ data: 'bad-data' }, 'RUN_EVENT')

    expect(normalized.type).toBe('RUN_EVENT')
    expect(normalized.timestamp.length).toBeGreaterThan(0)
    expect(normalized.data).toEqual({})
  })
})

describe('operator flow client calls', () => {
  it('executes state -> refresh -> migration plan -> migration apply with expected contracts', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []

    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })

      if (url.endsWith('/api/v1/state')) {
        return new Response(
          JSON.stringify({
            generated_at: '2026-03-06T00:00:00Z',
            counts: { running: 1, retrying: 0 },
            running: [],
            retrying: [],
            codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
            rate_limits: null,
          }),
          { status: 200 },
        )
      }

      if (url.endsWith('/api/v1/issues/OPS-1')) {
        return new Response(
          JSON.stringify({
            issue_identifier: 'OPS-1',
            issue_id: '1',
            status: 'running',
            attempts: { restart_count: 0, current_retry_attempt: 0 },
            workspace: { path: '/tmp/workspace' },
            running: null,
            retry: null,
            logs: {},
            recent_events: [],
            last_error: null,
            tracked: {},
          }),
          { status: 200 },
        )
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    vi.stubGlobal('fetch', fetchMock)

    await fetchState(config)
    await postRefresh(config)
    await fetchWorkspaceMigrationPlan(config, '/tmp/from', '/tmp/to')
    await applyWorkspaceMigration(config, '/tmp/from', '/tmp/to')
    const issue = await fetchIssueDetail(config, 'OPS-1')

    expect(calls[0]?.url).toBe('http://127.0.0.1:4000/api/v1/state')
    expect(calls[1]?.url).toBe('http://127.0.0.1:4000/api/v1/refresh')
    expect(calls[2]?.url).toBe('http://127.0.0.1:4000/api/v1/workspace/migration/plan?from=%2Ftmp%2Ffrom&to=%2Ftmp%2Fto')
    expect(calls[3]?.url).toBe('http://127.0.0.1:4000/api/v1/workspace/migrate')
    expect(calls[4]?.url).toBe('http://127.0.0.1:4000/api/v1/issues/OPS-1')

    expect(calls[0]?.init?.headers).toMatchObject({ Accept: 'application/json', Authorization: 'Bearer token-123' })
    expect(calls[1]?.init?.method).toBe('POST')
    expect(calls[3]?.init?.method).toBe('POST')
    expect(calls[3]?.init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(String(calls[3]?.init?.body)).toContain('"dry_run":false')
    expect(issue.issue_identifier).toBe('OPS-1')
  })

  it('returns normalized API errors for UI-safe display', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'invalid_request',
            message: 'missing from path',
          },
        }),
        { status: 400, statusText: 'Bad Request' },
      )
    })

    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchWorkspaceMigrationPlan(config, '', '')).rejects.toThrowError('missing from path')

    try {
      await fetchWorkspaceMigrationPlan(config, '', '')
    } catch (error) {
      expect(toDisplayError(error)).toBe('invalid_request: missing from path')
    }
  })

  it('rejects blank issue identifiers before network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchIssueDetail(config, '   ')).rejects.toThrowError('issue identifier is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('omits Authorization header when api token is empty', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          generated_at: '2026-03-06T00:00:00Z',
          counts: { running: 0, retrying: 0 },
          running: [],
          retrying: [],
          codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
          rate_limits: null,
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchState({
      baseUrl: 'http://127.0.0.1:4000',
      apiToken: '',
    })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers.Accept).toBe('application/json')
    expect(headers.Authorization).toBeUndefined()
  })

  it('falls back to request_failed error for non-json error responses', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('not-json-error', {
        status: 500,
        statusText: 'Internal Server Error',
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    try {
      await postRefresh(config)
      throw new Error('expected postRefresh to fail')
    } catch (error) {
      expect(toDisplayError(error)).toBe('request_failed: 500 not-json-error')
    }
  })

  it('omits workspace migration query params when from/to are blank', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchWorkspaceMigrationPlan(config, '   ', '   ')

    expect(calls[0]?.url).toBe('http://127.0.0.1:4000/api/v1/workspace/migration/plan')
  })

  it('trims from/to values in migration apply body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await applyWorkspaceMigration(config, '  /tmp/from  ', ' /tmp/to ')

    const body = String(calls[0]?.init?.body ?? '')
    expect(body).toContain('"from":"/tmp/from"')
    expect(body).toContain('"to":"/tmp/to"')
  })
})

describe('isUnauthorizedError', () => {
  it('detects unauthorized display strings and error instances', async () => {
    expect(isUnauthorizedError('unauthorized: missing or invalid bearer token')).toBe(true)
    expect(isUnauthorizedError(new Error('unauthorized: missing token'))).toBe(true)

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'unauthorized',
            message: 'missing bearer token',
          },
        }),
        { status: 401 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      await postRefresh(config)
      throw new Error('expected postRefresh to fail')
    } catch (error) {
      expect(isUnauthorizedError(error)).toBe(true)
    }
  })

  it('returns false for non-unauthorized errors', () => {
    expect(isUnauthorizedError('request_failed: 500 Internal Server Error')).toBe(false)
    expect(isUnauthorizedError(new Error('boom'))).toBe(false)
    expect(isUnauthorizedError({})).toBe(false)
  })
})

describe('requestText via fetchIssueLogs', () => {
  it('requestText returns text content for successful responses', async () => {
    const logContent = 'line 1: agent started\nline 2: task completed'
    const fetchMock = vi.fn(async () => {
      return new Response(logContent, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchIssueLogs(config, 'OPS-42')

    expect(result).toBe(logContent)
    expect(fetchMock).toHaveBeenCalledOnce()
    const firstCall = fetchMock.mock.calls[0] as unknown as [unknown, ...unknown[]] | undefined
    const url = String(firstCall?.[0])
    expect(url).toContain('/api/v1/issues/OPS-42/logs')
  })

  it('requestText throws APIError for error responses', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message: 'log storage unavailable',
          },
        }),
        { status: 500, statusText: 'Internal Server Error' },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchIssueLogs(config, 'OPS-42')).rejects.toThrowError('log storage unavailable')

    try {
      await fetchIssueLogs(config, 'OPS-42')
    } catch (error) {
      expect(toDisplayError(error)).toBe('internal_error: log storage unavailable')
    }
  })
})
