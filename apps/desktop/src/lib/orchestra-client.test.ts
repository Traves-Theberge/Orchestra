import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyWorkspaceMigration,
  fetchState,
  fetchIssueDetail,
  fetchWorkspaceMigrationPlan,
  isUnauthorizedError,
  normalizeEventEnvelope,
  normalizeSnapshotPayload,
  postRefresh,
  toDisplayError,
  type BackendConfig,
} from '@/lib/orchestra-client'

const config: BackendConfig = {
  baseUrl: 'http://127.0.0.1:4000',
  apiToken: 'token-123',
}

afterEach(() => {
  vi.unstubAllGlobals()
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
        seconds_run: 5,
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
        type: 'run_failed',
        timestamp: '2026-03-06T00:00:00Z',
        data: { issue_id: 'i-1' },
      },
      'fallback_type',
    )

    expect(normalized.type).toBe('run_failed')
    expect(normalized.timestamp).toBe('2026-03-06T00:00:00Z')
    expect(normalized.data).toEqual({ issue_id: 'i-1' })
  })

  it('applies fallback values for malformed envelopes', () => {
    const normalized = normalizeEventEnvelope({ data: 'bad-data' }, 'run_event')

    expect(normalized.type).toBe('run_event')
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
            codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_run: 0 },
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
          codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_run: 0 },
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
      expect(toDisplayError(error)).toBe('request_failed: 500 Internal Server Error')
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
