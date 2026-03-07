import type { APIErrorEnvelope, EventEnvelope, IssueDetailPayload, SnapshotPayload } from '@/lib/orchestra-types'

export type BackendConfig = {
  baseUrl: string
  apiToken: string
}

class APIError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof APIError) {
    return error.code === 'unauthorized'
  }
  if (error instanceof Error) {
    return /^unauthorized:/.test(error.message.trim().toLowerCase())
  }
  if (typeof error === 'string') {
    return /^unauthorized:/.test(error.trim().toLowerCase())
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeSnapshotPayload(value: unknown): SnapshotPayload {
  const root = isRecord(value) ? value : {}
  const counts = isRecord(root.counts) ? root.counts : {}
  const totals = isRecord(root.codex_totals) ? root.codex_totals : {}
  const rateLimits = isRecord(root.rate_limits) ? root.rate_limits : null

  const running = Array.isArray(root.running)
    ? root.running
        .filter((entry): entry is Record<string, unknown> => isRecord(entry))
        .map((entry) => ({
          issue_id: asString(entry.issue_id),
          issue_identifier: asString(entry.issue_identifier),
          state: asString(entry.state),
          session_id: asString(entry.session_id, ''),
          turn_count: asNumber(entry.turn_count, 0),
          last_event: asString(entry.last_event, ''),
          last_message: asString(entry.last_message, ''),
          last_event_at: asString(entry.last_event_at, ''),
          started_at: asString(entry.started_at, ''),
        }))
    : []

  const retrying = Array.isArray(root.retrying)
    ? root.retrying
        .filter((entry): entry is Record<string, unknown> => isRecord(entry))
        .map((entry) => ({
          issue_id: asString(entry.issue_id),
          issue_identifier: asString(entry.issue_identifier),
          state: asString(entry.state),
          attempt: asNumber(entry.attempt, 0),
          due_at: asString(entry.due_at),
          error: asString(entry.error),
        }))
    : []

  return {
    generated_at: asString(root.generated_at, new Date().toISOString()),
    counts: {
      running: asNumber(counts.running, 0),
      retrying: asNumber(counts.retrying, 0),
    },
    running,
    retrying,
    codex_totals: {
      input_tokens: asNumber(totals.input_tokens, 0),
      output_tokens: asNumber(totals.output_tokens, 0),
      total_tokens: asNumber(totals.total_tokens, 0),
      seconds_run: asNumber(totals.seconds_run, 0),
    },
    rate_limits: rateLimits,
  }
}

export function normalizeEventEnvelope(value: unknown, fallbackType = 'event'): EventEnvelope {
  const root = isRecord(value) ? value : {}
  return {
    type: asString(root.type, fallbackType),
    timestamp: asString(root.timestamp, new Date().toISOString()),
    data: isRecord(root.data) ? root.data : {},
  }
}

function buildHeaders(config: BackendConfig): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (config.apiToken.trim() !== '') {
    headers.Authorization = `Bearer ${config.apiToken.trim()}`
  }
  return headers
}

async function requestJSON<T>(config: BackendConfig, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, config.baseUrl).toString(), {
    ...init,
    headers: {
      ...buildHeaders(config),
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    let parsed: APIErrorEnvelope | null = null
    try {
      parsed = (await response.json()) as APIErrorEnvelope
    } catch {
      parsed = null
    }
    if (parsed?.error?.code && parsed?.error?.message) {
      throw new APIError(parsed.error.code, parsed.error.message)
    }
    throw new APIError('request_failed', `${response.status} ${response.statusText}`)
  }

  return (await response.json()) as T
}

export async function fetchState(config: BackendConfig): Promise<SnapshotPayload> {
  const payload = await requestJSON<unknown>(config, '/api/v1/state')
  return normalizeSnapshotPayload(payload)
}

export async function postRefresh(config: BackendConfig): Promise<Record<string, unknown>> {
  return requestJSON<Record<string, unknown>>(config, '/api/v1/refresh', {
    method: 'POST',
  })
}

export async function fetchWorkspaceMigrationPlan(
  config: BackendConfig,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams()
  if (from.trim() !== '') query.set('from', from.trim())
  if (to.trim() !== '') query.set('to', to.trim())
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return requestJSON<Record<string, unknown>>(config, `/api/v1/workspace/migration/plan${suffix}`)
}

export async function applyWorkspaceMigration(
  config: BackendConfig,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  return requestJSON<Record<string, unknown>>(config, '/api/v1/workspace/migrate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: from.trim(),
      to: to.trim(),
      dry_run: false,
    }),
  })
}

export async function fetchIssueDetail(config: BackendConfig, issueIdentifier: string): Promise<IssueDetailPayload> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  return requestJSON<IssueDetailPayload>(config, `/api/v1/${encodeURIComponent(normalized)}`)
}

export function toDisplayError(error: unknown): string {
  if (error instanceof APIError) {
    return `${error.code}: ${error.message}`
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'unexpected error'
}
