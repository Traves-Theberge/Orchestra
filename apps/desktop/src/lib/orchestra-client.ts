import type { APIErrorEnvelope, EventEnvelope, GlobalStats, IssueDetailPayload, Project, ProjectStats, SnapshotPayload, AgentConfig } from '@/lib/orchestra-types'

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

  // Handle cases where response might be empty (204 No Content) or other non-JSON but successful responses
  if (response.status === 204) {
    return {} as T
  }

  return (await response.json()) as T
}

export async function updateIssue(
  config: BackendConfig,
  issueIdentifier: string,
  updates: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  return requestJSON<Record<string, unknown>>(config, `/api/v1/issues/${encodeURIComponent(normalized)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })
}

export async function stopIssueSession(config: BackendConfig, issueIdentifier: string): Promise<void> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  await requestJSON<void>(config, `/api/v1/issues/${encodeURIComponent(normalized)}/session`, {
    method: 'DELETE',
  })
}

export async function fetchState(config: BackendConfig): Promise<SnapshotPayload> {
  const payload = await requestJSON<unknown>(config, '/api/v1/state')
  return normalizeSnapshotPayload(payload)
}

export async function fetchIssues(config: BackendConfig, states?: string[], projectID?: string, assigneeID?: string): Promise<any[]> {
  const params = new URLSearchParams()
  if (states && states.length > 0) params.set('states', states.join(','))
  if (projectID) params.set('project_id', projectID)
  if (assigneeID) params.set('assignee_id', assigneeID)
  const payload = await requestJSON<{ issues: any[] }>(config, `/api/v1/issues?${params.toString()}`)
  return payload.issues || []
}

export async function createIssue(
  config: BackendConfig,
  payload: { title: string; description: string; state: string; priority: number; assignee_id: string; project_id: string },
): Promise<any> {
  return requestJSON<any>(config, '/api/v1/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function searchIssues(config: BackendConfig, query: string): Promise<any[]> {
  const params = new URLSearchParams({ q: query })
  const payload = await requestJSON<{ issues: any[] }>(config, `/api/v1/search?${params.toString()}`)
  return payload.issues || []
}

export async function fetchAgents(config: BackendConfig): Promise<string[]> {
  const payload = await requestJSON<{ agents: string[] }>(config, '/api/v1/agents')
  return payload.agents || []
}

export async function fetchAgentConfig(config: BackendConfig): Promise<{ commands: Record<string, string>; agent_provider: string }> {
  return requestJSON<{ commands: Record<string, string>; agent_provider: string }>(config, '/api/v1/config/agents')
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

export async function fetchProjects(config: BackendConfig): Promise<any[]> {
  const data = await requestJSON<any[]>(config, '/api/v1/projects')
  return data || []
}

export async function fetchProjectStats(config: BackendConfig, projectID: string): Promise<any> {
  return requestJSON<any>(config, `/api/v1/projects/${encodeURIComponent(projectID)}`)
}

export async function fetchWarehouseStats(config: BackendConfig): Promise<any> {
  return requestJSON<any>(config, '/api/v1/warehouse/stats')
}

export async function createProject(config: BackendConfig, rootPath: string): Promise<any> {
  return requestJSON<any>(config, '/api/v1/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root_path: rootPath }),
  })
}

export async function fetchIssueDetail(config: BackendConfig, issueIdentifier: string): Promise<any> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  return requestJSON<any>(config, `/api/v1/issues/${encodeURIComponent(normalized)}`)
}

export async function fetchIssueLogs(config: BackendConfig, issueIdentifier: string): Promise<string> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  const response = await fetch(new URL(`/api/v1/issues/${encodeURIComponent(normalized)}/logs`, config.baseUrl).toString(), {
    headers: buildHeaders(config),
  })

  if (!response.ok) {
    throw new APIError('logs_not_found', 'failed to fetch issue logs')
  }

  return response.text()
}

export async function fetchIssueDiff(config: BackendConfig, issueIdentifier: string): Promise<string> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  const response = await fetch(new URL(`/api/v1/issues/${encodeURIComponent(normalized)}/diff`, config.baseUrl).toString(), {
    headers: buildHeaders(config),
  })

  if (!response.ok) {
    throw new APIError('diff_failed', 'failed to fetch workspace diff')
  }

  return response.text()
}

export async function fetchArtifacts(config: BackendConfig, issueIdentifier: string): Promise<string[]> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  const payload = await requestJSON<{ artifacts: string[] }>(config, `/api/v1/issues/${encodeURIComponent(normalized)}/artifacts`)
  return payload.artifacts || []
}

export async function fetchArtifactContent(config: BackendConfig, issueIdentifier: string, relPath: string): Promise<string> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  const response = await fetch(new URL(`/api/v1/issues/${encodeURIComponent(normalized)}/artifacts/${relPath}`, config.baseUrl).toString(), {
    headers: buildHeaders(config),
  })

  if (!response.ok) {
    throw new APIError('fetch_failed', 'failed to fetch artifact content')
  }

  return response.text()
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

export async function fetchSessions(config: BackendConfig, projectId?: string): Promise<any[]> {
  const url = projectId ? `/api/v1/sessions?project_id=${projectId}` : '/api/v1/sessions'
  const data = await requestJSON<any[]>(config, url)
  return data || []
}

export async function deleteProject(config: BackendConfig, projectId: string): Promise<void> {
  return requestJSON<void>(config, `/api/v1/projects/${projectId}`, {
    method: 'DELETE',
  })
}

export async function refreshProject(config: BackendConfig, projectId: string): Promise<void> {
  return requestJSON<void>(config, `/api/v1/projects/${projectId}/refresh`, {
    method: 'POST',
  })
}

export async function fetchProjectTree(config: BackendConfig, projectId: string): Promise<any[]> {
  const data = await requestJSON<any[]>(config, `/api/v1/projects/${projectId}/tree`)
  return data || []
}

export async function fetchProjectGitHistory(config: BackendConfig, projectId: string): Promise<any[]> {
  const data = await requestJSON<any[]>(config, `/api/v1/projects/${projectId}/git`)
  return data || []
}

export async function fetchSessionDetail(config: BackendConfig, sessionId: string): Promise<any> {
  return requestJSON<any>(config, `/api/v1/sessions/${sessionId}`)
}

export async function gitCommit(config: BackendConfig, projectId: string, message: string): Promise<void> {
  await requestJSON<void>(config, `/api/v1/projects/${projectId}/git/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
}

export async function gitPush(config: BackendConfig, projectId: string, remote = 'origin', branch = 'main'): Promise<void> {
  await requestJSON<void>(config, `/api/v1/projects/${projectId}/git/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remote, branch }),
  })
}

export async function gitPull(config: BackendConfig, projectId: string, remote = 'origin', branch = 'main'): Promise<void> {
  await requestJSON<void>(config, `/api/v1/projects/${projectId}/git/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remote, branch }),
  })
}

export async function createGitHubPR(
  config: BackendConfig,
  issueIdentifier: string,
  payload: { title: string; body: string; head: string; base: string; owner?: string; repo?: string; token?: string }
): Promise<any> {
  return requestJSON<any>(config, `/api/v1/issues/${encodeURIComponent(issueIdentifier)}/pr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function updateAgentConfig(config: BackendConfig, payload: { commands: Record<string, string>, agent_provider: string }): Promise<void> {
  await requestJSON<void>(config, '/api/v1/config/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
export async function fetchAgentConfigs(config: BackendConfig, projectID?: string): Promise<AgentConfig[]> {
  const url = projectID ? `/api/v1/config/agents/items?project_id=${encodeURIComponent(projectID)}` : '/api/v1/config/agents/items'
  const data = await requestJSON<{ configs: AgentConfig[] }>(config, url)
  return data.configs || []
}

export async function updateAgentConfigByPath(config: BackendConfig, path: string, content: string): Promise<void> {
  await requestJSON<void>(config, '/api/v1/config/agents/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  })
}

export async function createAgentResource(config: BackendConfig, payload: { provider: string, type: string, name: string, scope: string, project_id?: string }): Promise<{ path: string }> {
  return requestJSON<{ path: string }>(config, '/api/v1/config/agents/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
