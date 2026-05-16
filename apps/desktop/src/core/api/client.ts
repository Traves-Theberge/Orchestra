import type { APIErrorEnvelope, BackendConfig, EventEnvelope, GlobalStats, Project, ProjectStats, SnapshotPayload, AgentConfig, DocItem, Issue, SessionDetail, SessionSummary } from '@core/api/types'

// Re-exported so existing `import { BackendConfig } from '@core/api/client'`
// callers keep working. Canonical definition lives in orchestra-types.ts.
export type { BackendConfig }

/** A tool exposed by an MCP (Model Context Protocol) server. */
export type MCPTool = {
  /** Tool name as registered with the MCP server. */
  name: string
  [key: string]: unknown
}

/** An MCP server registration managed by the orchestrator. */
export type MCPServer = {
  /** Server UUID, assigned by the backend. */
  id?: string
  /** Human-readable server name. */
  name: string
  /** Shell command used to launch the server process. */
  command: string
  [key: string]: unknown
}

/** Flattened issue record used in list views, merging Issue fields with runtime state. */
export type IssueListItem = Partial<Issue> & {
  id?: string
  issue_id?: string
  identifier?: string
  issue_identifier?: string
  state: string
  title?: string
  assigned_to_worker?: boolean
  due_at?: string
  error?: string
  last_message?: string
  session_id?: string
  [key: string]: unknown
}

/** A single historical event for an issue (e.g. state change, agent message). */
export type IssueHistoryEntry = {
  id?: string
  kind: string
  message?: string
  timestamp: string
  provider?: string
  input_tokens?: number
  output_tokens?: number
  [key: string]: unknown
}

/** A node in the project file tree returned by the backend. */
export type ProjectTreeNode = {
  name: string
  path: string
  is_dir: boolean
  children?: ProjectTreeNode[]
  [key: string]: unknown
}

/** A git commit record from a project repository. */
export type GitCommit = {
  hash?: string
  message: string
  author?: string
  date: string
  [key: string]: unknown
}

/** A single file entry from `git status` output. */
export type GitStatusEntry = {
  path: string
  status: string
  [key: string]: unknown
}

/** Result payload from a workspace migration plan or execution. */
export type WorkspaceMigrationResult = Record<string, unknown>

/** Result payload from a backend refresh operation. */
export type RefreshResult = Record<string, unknown>

/** Partial update fields for PATCH-ing an existing issue. */
export type IssueUpdatePayload = {
  state?: string
  assignee_id?: string
  provider?: string
  title?: string
  description?: string
  project_id?: string
  disabled_tools?: string[]
  [key: string]: unknown
}

/** Required fields for creating a new issue via the API. */
export type IssueCreatePayload = {
  title: string
  description: string
  state: string
  assignee_id: string
  project_id: string
  provider?: string
  runtime_target?: string
  disabled_tools?: string[]
}

/** A runtime execution target returned by GET /api/v1/config/runtimes. */
export type RuntimeEntry = {
  target: string
  configured: boolean
}

/** Response from creating a GitHub pull request through the orchestrator. */
export type GitHubPRResult = {
  url: string
  number: number
  [key: string]: unknown
}

/** Health check response from the speech-to-text subsystem. */
export type STTHealth = {
  ready: boolean
  binary?: string
  model?: string
  language?: string
  reason?: string
}

/** Result of a speech-to-text transcription request. */
export type STTTranscriptionResult = {
  text: string
  elapsed_ms?: number
  language?: string
}

class APIError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Checks whether an error represents an unauthorized (401) response.
 * @param error - The caught error value to inspect.
 * @returns `true` if the error indicates an authentication failure.
 */
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

/**
 * Safely coerces an unknown value into a well-typed {@link SnapshotPayload}.
 * Missing or malformed fields are replaced with sensible defaults.
 * @param value - Raw parsed JSON (or any value) from the backend.
 * @returns A fully populated SnapshotPayload.
 */
export function normalizeSnapshotPayload(value: unknown): SnapshotPayload {
  const root = isRecord(value) ? value : {}
  const counts = isRecord(root.counts) ? root.counts : {}
  const totals = isRecord(root.codex_totals) ? root.codex_totals : {}
  const rateLimits = isRecord(root.rate_limits) ? root.rate_limits : null

  const running = Array.isArray(root.running)
    ? root.running.flatMap((entry) => isRecord(entry) ? [{
        issue_id: asString(entry.issue_id),
        issue_identifier: asString(entry.issue_identifier),
        state: asString(entry.state),
        session_id: asString(entry.session_id, ''),
        turn_count: asNumber(entry.turn_count, 0),
        last_event: asString(entry.last_event, ''),
        last_message: asString(entry.last_message, ''),
        last_event_at: asString(entry.last_event_at, ''),
        started_at: asString(entry.started_at, ''),
      }] : [])
    : []

  const retrying = Array.isArray(root.retrying)
    ? root.retrying.flatMap((entry) => isRecord(entry) ? [{
        issue_id: asString(entry.issue_id),
        issue_identifier: asString(entry.issue_identifier),
        state: asString(entry.state),
        attempt: asNumber(entry.attempt, 0),
        due_at: asString(entry.due_at),
        error: asString(entry.error),
      }] : [])
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
      seconds_running: asNumber(totals.seconds_running, 0),
    },
    rate_limits: rateLimits,
    mcp_servers: isRecord(root.mcp_servers) ? (root.mcp_servers as Record<string, string>) : undefined,
  }
}

/**
 * Safely coerces an unknown value into a well-typed {@link EventEnvelope}.
 * @param value - Raw parsed JSON from the SSE stream.
 * @param fallbackType - Event type to use when the value lacks a `type` field.
 * @returns A fully populated EventEnvelope.
 */
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

async function requestJSON<T>(config: BackendConfig, path: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(new URL(path, config.baseUrl).toString(), {
      ...init,
      signal: init?.signal ?? controller.signal,
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

    const text = await response.text()
    if (!text) {
      return {} as T
    }

    return JSON.parse(text) as T
  } finally {
    clearTimeout(timeout)
  }
}

async function requestText(config: BackendConfig, path: string, init?: RequestInit, timeoutMs = 30000): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(new URL(path, config.baseUrl).toString(), {
      ...init,
      signal: init?.signal ?? controller.signal,
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

    return response.text()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Applies a partial update (PATCH) to an existing issue.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier (e.g. "ORK-42").
 * @param updates - Fields to update on the issue.
 * @returns The updated issue record.
 */
export async function updateIssue(
  config: BackendConfig,
  issueIdentifier: string,
  updates: IssueUpdatePayload,
): Promise<IssueListItem> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  return requestJSON<IssueListItem>(config, `/api/v1/issues/${encodeURIComponent(normalized)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })
}

/**
 * Permanently deletes an issue from the orchestrator.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier.
 */
export async function deleteIssue(config: BackendConfig, issueIdentifier: string): Promise<void> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  await requestJSON<void>(config, `/api/v1/issues/${encodeURIComponent(normalized)}`, {
    method: 'DELETE',
  })
}

/**
 * Stops the active agent session for an issue.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier.
 * @param provider - Optional provider filter when multiple providers are active.
 */
export async function stopIssueSession(config: BackendConfig, issueIdentifier: string, provider?: string): Promise<void> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  let path = `/api/v1/issues/${encodeURIComponent(normalized)}/session`
  if (provider) {
    path += `?provider=${encodeURIComponent(provider)}`
  }
  await requestJSON<void>(config, path, {
    method: 'DELETE',
  })
}

/**
 * Stops an issue, transitioning it out of its current active state.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier.
 * @returns The updated issue record.
 */
export async function stopIssue(config: BackendConfig, issueIdentifier: string): Promise<IssueListItem> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  return requestJSON<IssueListItem>(config, `/api/v1/issues/${encodeURIComponent(normalized)}/stop`, {
    method: 'POST',
  })
}

/**
 * Fetches the current runtime snapshot from the orchestrator.
 * @param config - Backend connection configuration.
 * @returns The normalized runtime snapshot.
 */
export async function fetchState(config: BackendConfig): Promise<SnapshotPayload> {
  const payload = await requestJSON<unknown>(config, '/api/v1/state')
  return normalizeSnapshotPayload(payload)
}

/**
 * Fetches a filtered list of issues from the orchestrator.
 * @param config - Backend connection configuration.
 * @param states - Optional array of state filters (e.g. ["RUNNING", "TRACKED"]).
 * @param projectID - Optional project ID filter.
 * @param assigneeID - Optional assignee ID filter.
 * @returns Array of matching issue list items.
 */
export async function fetchIssues(config: BackendConfig, states?: string[], projectID?: string, assigneeID?: string): Promise<IssueListItem[]> {
  const params = new URLSearchParams()
  if (states && states.length > 0) params.set('states', states.join(','))
  if (projectID) params.set('project_id', projectID)
  if (assigneeID) params.set('assignee_id', assigneeID)
  const payload = await requestJSON<{ issues: IssueListItem[] }>(config, `/api/v1/issues?${params.toString()}`)
  return payload.issues || []
}

/**
 * Creates a new issue in the orchestrator.
 * @param config - Backend connection configuration.
 * @param payload - Issue creation fields (title, description, state, assignee, project).
 * @returns The newly created issue record.
 */
export async function createIssue(
  config: BackendConfig,
  payload: IssueCreatePayload,
): Promise<IssueListItem> {
  return requestJSON<IssueListItem>(config, '/api/v1/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/**
 * Searches issues by a free-text query string.
 * @param config - Backend connection configuration.
 * @param query - Search query text.
 * @returns Array of matching issue list items.
 */
export async function searchIssues(config: BackendConfig, query: string): Promise<IssueListItem[]> {
  const params = new URLSearchParams({ q: query })
  const payload = await requestJSON<{ issues: IssueListItem[] }>(config, `/api/v1/search?${params.toString()}`)
  return payload.issues || []
}

/**
 * Fetches the list of registered agent names.
 * @param config - Backend connection configuration.
 * @returns Array of agent name strings.
 */
export async function fetchAgents(config: BackendConfig): Promise<string[]> {
  const payload = await requestJSON<{ agents: string[] }>(config, '/api/v1/agents')
  return payload.agents || []
}

/**
 * Fetches the global agent configuration (commands, provider, max turns).
 * @param config - Backend connection configuration.
 * @returns The current agent configuration object.
 */
export async function fetchAgentConfig(config: BackendConfig): Promise<{ commands: Record<string, string>; agent_provider: string; max_turns: number }> {
  return requestJSON<{ commands: Record<string, string>; agent_provider: string; max_turns: number }>(config, '/api/v1/config/agents')
}

/**
 * Partially updates the global agent configuration.
 * @param config - Backend connection configuration.
 * @param updates - Fields to patch (e.g. max_turns).
 * @returns The updated agent configuration.
 */
export async function patchAgentConfig(config: BackendConfig, updates: { max_turns?: number }): Promise<{ commands: Record<string, string>; agent_provider: string; max_turns: number }> {
  return requestJSON<{ commands: Record<string, string>; agent_provider: string; max_turns: number }>(config, '/api/v1/config/agents', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

/**
 * Triggers a full state refresh on the orchestrator backend.
 * @param config - Backend connection configuration.
 * @returns The refresh result payload.
 */
export async function postRefresh(config: BackendConfig): Promise<RefreshResult> {
  return requestJSON<RefreshResult>(config, '/api/v1/refresh', {
    method: 'POST',
  })
}

/**
 * Fetches a dry-run workspace migration plan between two paths.
 * @param config - Backend connection configuration.
 * @param from - Source workspace path.
 * @param to - Destination workspace path.
 * @returns The migration plan result.
 */
export async function fetchWorkspaceMigrationPlan(
  config: BackendConfig,
  from: string,
  to: string,
): Promise<WorkspaceMigrationResult> {
  const query = new URLSearchParams()
  if (from.trim() !== '') query.set('from', from.trim())
  if (to.trim() !== '') query.set('to', to.trim())
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return requestJSON<WorkspaceMigrationResult>(config, `/api/v1/workspace/migration/plan${suffix}`)
}

/**
 * Executes a workspace migration between two paths.
 * @param config - Backend connection configuration.
 * @param from - Source workspace path.
 * @param to - Destination workspace path.
 * @returns The migration execution result.
 */
export async function applyWorkspaceMigration(
  config: BackendConfig,
  from: string,
  to: string,
): Promise<WorkspaceMigrationResult> {
  return requestJSON<WorkspaceMigrationResult>(config, '/api/v1/workspace/migrate', {
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

/**
 * Fetches all registered projects from the orchestrator.
 * @param config - Backend connection configuration.
 * @returns Array of project records.
 */
export async function fetchProjects(config: BackendConfig): Promise<Project[]> {
  const data = await requestJSON<Project[]>(config, '/api/v1/projects')
  return data || []
}

/**
 * Fetches aggregate statistics for a specific project.
 * @param config - Backend connection configuration.
 * @param projectID - The project UUID.
 * @returns Project-level statistics (sessions, tokens, etc.).
 */
export async function fetchProjectStats(config: BackendConfig, projectID: string): Promise<ProjectStats> {
  return requestJSON<ProjectStats>(config, `/api/v1/projects/${encodeURIComponent(projectID)}`)
}

/**
 * Fetches platform-wide warehouse analytics (token totals, provider usage, recent sessions).
 * @param config - Backend connection configuration.
 * @returns Global statistics payload.
 */
export async function fetchWarehouseStats(config: BackendConfig): Promise<GlobalStats> {
  return requestJSON<GlobalStats>(config, '/api/v1/warehouse/stats')
}

/**
 * Registers a new project by its filesystem root path.
 * @param config - Backend connection configuration.
 * @param rootPath - Absolute filesystem path of the project root.
 * @returns The newly created project record.
 */
export async function createProject(config: BackendConfig, rootPath: string): Promise<Project> {
  return requestJSON<Project>(config, '/api/v1/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root_path: rootPath }),
  })
}

/**
 * Fetches full details for a single issue.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier.
 * @returns The detailed issue record.
 */
export async function fetchIssueDetail(config: BackendConfig, issueIdentifier: string): Promise<IssueListItem> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  return requestJSON<IssueListItem>(config, `/api/v1/issues/${encodeURIComponent(normalized)}`)
}

/**
 * Fetches raw session log text for an issue.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier.
 * @param provider - Optional provider filter.
 * @returns Raw log content as a string.
 */
export async function fetchIssueLogs(config: BackendConfig, issueIdentifier: string, provider?: string): Promise<string> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  const url = new URL(`/api/v1/issues/${encodeURIComponent(normalized)}/logs`, config.baseUrl)
  if (provider) url.searchParams.set('provider', provider)

  return requestText(config, url.pathname + url.search)
}

/**
 * Fetches the event history for an issue.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier.
 * @returns Array of historical event entries.
 */
export async function fetchIssueHistory(config: BackendConfig, issueIdentifier: string): Promise<IssueHistoryEntry[]> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  const data = await requestJSON<{ history: IssueHistoryEntry[] }>(config, `/api/v1/issues/${encodeURIComponent(normalized)}/history`)
  return data.history || []
}

/**
 * Fetches the workspace git diff for an issue.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier.
 * @param provider - Optional provider filter.
 * @returns Unified diff output as a string.
 */
export async function fetchIssueDiff(config: BackendConfig, issueIdentifier: string, provider?: string): Promise<string> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  const url = new URL(`/api/v1/issues/${encodeURIComponent(normalized)}/diff`, config.baseUrl)
  if (provider) url.searchParams.set('provider', provider)

  return requestText(config, url.pathname + url.search)
}

/**
 * Fetches the list of artifact paths produced by an issue's agent session.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier.
 * @param provider - Optional provider filter.
 * @returns Array of relative artifact file paths.
 */
export async function fetchArtifacts(config: BackendConfig, issueIdentifier: string, provider?: string): Promise<string[]> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  const url = new URL(`/api/v1/issues/${encodeURIComponent(normalized)}/artifacts`, config.baseUrl)
  if (provider) url.searchParams.set('provider', provider)

  const payload = await requestJSON<{ artifacts: string[] }>(config, url.pathname + url.search)
  return payload.artifacts || []
}

/**
 * Fetches the text content of a single artifact file.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier.
 * @param relPath - Relative path of the artifact within the workspace.
 * @param provider - Optional provider filter.
 * @returns The artifact file content as a string.
 */
export async function fetchArtifactContent(config: BackendConfig, issueIdentifier: string, relPath: string, provider?: string): Promise<string> {
  const normalized = issueIdentifier.trim()
  if (normalized === '') {
    throw new APIError('invalid_request', 'issue identifier is required')
  }
  const url = new URL(`/api/v1/issues/${encodeURIComponent(normalized)}/artifacts/${encodeURIComponent(relPath)}`, config.baseUrl)
  if (provider) url.searchParams.set('provider', provider)

  return requestText(config, url.pathname + url.search)
}

/**
 * Converts an unknown error into a user-friendly display string.
 * @param error - The caught error value.
 * @returns A human-readable error message.
 */
export function toDisplayError(error: unknown): string {
  if (error instanceof APIError) {
    return `${error.code}: ${error.message}`
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'unexpected error'
}

/**
 * Fetches session summaries, optionally filtered by project.
 * @param config - Backend connection configuration.
 * @param projectId - Optional project ID to filter sessions.
 * @returns Array of session summary records.
 */
export async function fetchSessions(config: BackendConfig, projectId?: string): Promise<SessionSummary[]> {
  const url = projectId ? `/api/v1/sessions?project_id=${projectId}` : '/api/v1/sessions'
  const data = await requestJSON<SessionSummary[]>(config, url)
  return data || []
}

/**
 * Deletes a project registration from the orchestrator.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID to delete.
 */
export async function deleteProject(config: BackendConfig, projectId: string): Promise<void> {
  return requestJSON<void>(config, `/api/v1/projects/${projectId}`, {
    method: 'DELETE',
  })
}

/** Save per-project issue source config (type, endpoint, token). Pass token="" to leave unchanged. */
export async function updateProjectIssueSource(
  config: BackendConfig,
  projectId: string,
  payload: { type: string; endpoint: string; token?: string }
): Promise<{ ok: boolean }> {
  return requestJSON<{ ok: boolean }>(
    config,
    `/api/v1/projects/${projectId}/issue-source`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  )
}

/** List available projects/teams from a tracker using stored or override credentials. */
export async function listIssueSourceProjects(
  config: BackendConfig,
  projectId: string,
  payload?: { type?: string; endpoint?: string; token?: string }
): Promise<Array<{ id: string; name: string }>> {
  return requestJSON<Array<{ id: string; name: string }>>(
    config,
    `/api/v1/projects/${projectId}/issue-source/list-projects`,
    { method: 'POST', body: JSON.stringify(payload ?? {}) }
  )
}

/** Test connectivity for a project's issue source. Can pass override values before saving. */
export async function testProjectIssueSource(
  config: BackendConfig,
  projectId: string,
  payload?: { type?: string; endpoint?: string; token?: string }
): Promise<{ ok: boolean; error?: string }> {
  return requestJSON<{ ok: boolean; error?: string }>(
    config,
    `/api/v1/projects/${projectId}/issue-source/test`,
    { method: 'POST', body: JSON.stringify(payload ?? {}) }
  )
}

/**
 * Triggers a refresh/rescan of a project's workspace.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID to refresh.
 */
export async function refreshProject(config: BackendConfig, projectId: string): Promise<void> {
  return requestJSON<void>(config, `/api/v1/projects/${projectId}/refresh`, {
    method: 'POST',
  })
}

/**
 * Fetches the file tree for a project, optionally rooted at a sub-path.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param path - Optional sub-directory path to scope the tree.
 * @returns Array of tree nodes (files and directories).
 */
export async function fetchProjectTree(config: BackendConfig, projectId: string, path?: string): Promise<ProjectTreeNode[]> {
  const query = path ? `?path=${encodeURIComponent(path)}` : ''
  const data = await requestJSON<ProjectTreeNode[]>(config, `/api/v1/projects/${projectId}/tree${query}`)
  return data || []
}

/**
 * Fetches the git commit history for a project.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @returns Array of git commit records.
 */
export async function fetchProjectGitHistory(config: BackendConfig, projectId: string): Promise<GitCommit[]> {
  const data = await requestJSON<GitCommit[]>(config, `/api/v1/projects/${projectId}/git`)
  return data || []
}

export type GitStatusResponse = {
  files: GitStatusEntry[]
  branch: { ahead: number; behind: number }
}

/**
 * Fetches the current git status (modified/untracked files) for a project.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @returns Git status response with files and branch info.
 */
export async function fetchProjectGitStatus(config: BackendConfig, projectId: string): Promise<GitStatusResponse> {
  const data = await requestJSON<GitStatusResponse>(config, `/api/v1/projects/${projectId}/git/status`)
  return data || { files: [], branch: { ahead: 0, behind: 0 } }
}

/**
 * Fetches the git diff for a project, optionally filtered by commit hash, file, or staged status.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param opts - Optional filters: hash, file, staged.
 * @returns Unified diff output as a string.
 */
export async function fetchProjectGitDiff(
  config: BackendConfig,
  projectId: string,
  opts?: { hash?: string; file?: string; staged?: boolean }
): Promise<string> {
  const params = new URLSearchParams()
  if (opts?.hash) params.set('hash', opts.hash)
  if (opts?.file) params.set('file', opts.file)
  if (opts?.staged) params.set('staged', 'true')
  const query = params.toString() ? `?${params.toString()}` : ''
  return requestText(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/diff${query}`)
}

/**
 * Fetches full detail for a specific agent session.
 * @param config - Backend connection configuration.
 * @param sessionId - The session UUID.
 * @returns The full session detail record including events.
 */
export async function fetchSessionDetail(config: BackendConfig, sessionId: string): Promise<SessionDetail> {
  return requestJSON<SessionDetail>(config, `/api/v1/sessions/${sessionId}`)
}

/**
 * Creates a git commit in a project workspace with the given message.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param message - Commit message text.
 */
export async function gitCommit(config: BackendConfig, projectId: string, message: string): Promise<void> {
  await requestJSON<void>(config, `/api/v1/projects/${projectId}/git/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
}

/**
 * Pushes commits to a remote git repository.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param remote - Remote name (defaults to "origin").
 * @param branch - Branch name (defaults to "main").
 */
export async function gitPush(config: BackendConfig, projectId: string, remote = 'origin', branch = 'main'): Promise<void> {
  await requestJSON<void>(config, `/api/v1/projects/${projectId}/git/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remote, branch }),
  })
}

/**
 * Pulls commits from a remote git repository.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param remote - Remote name (defaults to "origin").
 * @param branch - Branch name (defaults to "main").
 */
export async function gitPull(config: BackendConfig, projectId: string, remote = 'origin', branch = 'main'): Promise<void> {
  await requestJSON<void>(config, `/api/v1/projects/${projectId}/git/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remote, branch }),
  })
}

/**
 * Fetches from all remotes for a project repository.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 */
export async function gitFetch(config: BackendConfig, projectId: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/fetch`, { method: 'POST' })
}

/**
 * Creates a GitHub pull request for an issue through the orchestrator.
 * @param config - Backend connection configuration.
 * @param issueIdentifier - Human-readable issue identifier.
 * @param payload - PR creation fields (title, body, head/base branches, optional owner/repo/token).
 * @returns The created PR result with URL and number.
 */
export async function createGitHubPR(
  config: BackendConfig,
  issueIdentifier: string,
  payload: { title: string; body: string; head: string; base: string; owner?: string; repo?: string; token?: string }
): Promise<GitHubPRResult> {
  return requestJSON<GitHubPRResult>(config, `/api/v1/issues/${encodeURIComponent(issueIdentifier)}/pr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/**
 * Replaces the global agent configuration (commands map and default provider).
 * @param config - Backend connection configuration.
 * @param payload - The full agent configuration to set.
 */
export async function updateAgentConfig(config: BackendConfig, payload: { commands: Record<string, string>, agent_provider: string }): Promise<void> {
  await requestJSON<void>(config, '/api/v1/config/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
/**
 * Fetches the documentation tree structure.
 * @param config - Backend connection configuration.
 * @returns Array of doc tree items (files and folders).
 */
export async function fetchDocs(config: BackendConfig): Promise<DocItem[]> {
  const data = await requestJSON<{ docs: DocItem[] }>(config, '/api/v1/docs')
  return data.docs || []
}

/**
 * Fetches the rendered content of a documentation file.
 * @param config - Backend connection configuration.
 * @param path - Relative path of the document within the docs tree.
 * @returns The document content as a string.
 */
export async function fetchDocContent(config: BackendConfig, path: string): Promise<string> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(new URL(`/api/v1/docs/${encodedPath}`, config.baseUrl).toString(), {
    headers: buildHeaders(config),
  })
  if (!response.ok) {
    throw new Error(`failed to fetch doc content: ${response.statusText}`)
  }
  return response.text()
}

/**
 * Fetches all tools exposed by registered MCP servers.
 * @param config - Backend connection configuration.
 * @returns Array of MCP tool records.
 */
export async function fetchMCPTools(config: BackendConfig): Promise<MCPTool[]> {
  const data = await requestJSON<{ tools: MCPTool[] }>(config, '/api/v1/mcp/tools')
  return data.tools || []
}

/**
 * Fetches all registered MCP servers.
 * @param config - Backend connection configuration.
 * @returns Array of MCP server records.
 */
export async function fetchMCPServers(config: BackendConfig): Promise<MCPServer[]> {
  const data = await requestJSON<{ servers: MCPServer[] }>(config, '/api/v1/mcp/servers')
  return data.servers || []
}

/**
 * Deletes an MCP server registration.
 * @param config - Backend connection configuration.
 * @param id - The MCP server UUID to delete.
 */
export async function deleteMCPServer(config: BackendConfig, id: string): Promise<void> {
  await requestJSON<void>(config, `/api/v1/mcp/servers/${id}`, {
    method: 'DELETE',
  })
}

/** Options for creating a new GitHub repository through the orchestrator. */
export type CreateRepoOptions = {
  name: string
  description?: string
  private: boolean
}

/** Result returned after creating a GitHub repository. */
export type CreateRepoResult = {
  full_name: string
  html_url: string
  clone_url: string
  owner: string
  repo: string
}

/** A GitHub issue retrieved through the orchestrator's GitHub integration. */
export type GitHubIssue = {
  number: number
  title: string
  body: string
  state: string
  html_url: string
  labels: { name: string }[]
  created_at?: string
  updated_at?: string
  user?: { login: string; avatar_url: string }
}

/** A GitHub pull request retrieved through the orchestrator's GitHub integration. */
export type GitHubPR = {
  number: number
  title: string
  body: string
  state: string
  html_url: string
  diff_url: string
  head: { ref: string; label: string }
  base: { ref: string; label: string }
  user: { login: string; avatar_url: string }
  created_at: string
  merged_at: string | null
}

/** Current branch and list of all branches in a project repository. */
export type GitBranches = {
  current: string
  branches: string[]
  remotes?: string[]
}

/**
 * Fetches GitHub issues for a project via the orchestrator's GitHub integration.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param state - Issue state filter (defaults to "open").
 * @param page - Page number for pagination (defaults to 1).
 * @returns Paginated response with issues array and has_more flag.
 */
export async function fetchProjectGitHubIssues(
  config: BackendConfig, projectId: string, state: string = 'open', page: number = 1
): Promise<{ issues: GitHubIssue[]; has_more: boolean }> {
  return requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/issues?state=${state}&page=${page}`)
}

/**
 * Fetches the current branch and all branch names for a project.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @returns The current branch and list of all branches.
 */
export async function fetchProjectGitBranches(config: BackendConfig, projectId: string): Promise<GitBranches> {
  return requestJSON<GitBranches>(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/branches`)
}

/**
 * Fetches the default branch name for a project's repository.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @returns The default branch name (e.g. "main").
 */
export async function fetchDefaultBranch(config: BackendConfig, projectId: string): Promise<string> {
  const result = await requestJSON<{ branch: string }>(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/default-branch`)
  return result.branch
}

export type BranchDetail = {
  name: string
  is_remote: boolean
  last_commit_sha: string
  last_commit_message: string
  last_commit_date: string
  last_commit_author: string
  ahead: number
  behind: number
  is_default: boolean
  is_current: boolean
}

export type BranchesDetailResponse = {
  current: string
  default_branch: string
  branches: BranchDetail[]
}

export async function fetchProjectGitBranchesDetail(config: BackendConfig, projectId: string): Promise<BranchesDetailResponse> {
  return requestJSON<BranchesDetailResponse>(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/branches/detail`)
}

/**
 * Fetches GitHub pull requests for a project.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param page - Page number for pagination (defaults to 1).
 * @returns Paginated response with pulls array and has_more flag.
 */
export async function fetchProjectGitHubPulls(
  config: BackendConfig, projectId: string, page: number = 1
): Promise<{ pulls: GitHubPR[]; has_more: boolean }> {
  return requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/pulls?page=${page}`)
}

/**
 * Fetches the unified diff for a specific GitHub pull request.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param number - PR number.
 * @returns The PR diff as a string.
 */
export async function fetchProjectGitHubPullDiff(config: BackendConfig, projectId: string, number: number): Promise<string> {
  return requestText(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/pulls/${encodeURIComponent(String(number))}/diff`)
}

/**
 * Creates a new GitHub issue for a project.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param payload - Issue creation fields (title, body, optional labels).
 * @returns The created GitHub issue record.
 */
export async function createProjectGitHubIssue(config: BackendConfig, projectId: string, payload: { title: string; body: string; labels?: string[] }): Promise<GitHubIssue> {
  return requestJSON<GitHubIssue>(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/**
 * Updates an existing GitHub issue for a project.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param number - GitHub issue number.
 * @param payload - Fields to update (title, body, state).
 * @returns The updated GitHub issue record.
 */
export async function updateProjectGitHubIssue(config: BackendConfig, projectId: string, number: number, payload: { title?: string; body?: string; state?: string }): Promise<GitHubIssue> {
  return requestJSON<GitHubIssue>(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/issues/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/**
 * Creates a new GitHub pull request for a project.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param payload - PR creation fields (title, body, head branch, base branch).
 * @returns The created PR URL and number.
 */
export async function createProjectGitHubPull(config: BackendConfig, projectId: string, payload: { title: string; body: string; head: string; base: string }): Promise<{ html_url: string; number: number }> {
  return requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/pulls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/**
 * Disconnects a project from its GitHub repository integration.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 */
export async function disconnectProjectGitHub(config: BackendConfig, projectId: string): Promise<void> {
  await requestJSON<void>(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/disconnect`, {
    method: 'POST',
  })
}

/**
 * Creates a new GitHub repository for a project through the orchestrator.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param opts - Repository creation options (name, description, visibility).
 * @returns The created repository details.
 */
export async function createGitHubRepo(
  config: BackendConfig,
  projectId: string,
  opts: CreateRepoOptions
): Promise<CreateRepoResult> {
  return requestJSON<CreateRepoResult>(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/create-repo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
}

/** An MCP server configured for a specific provider (e.g. Claude, Codex). */
export type ProviderMCPServer = {
    name: string
    command: string
    args?: string[]
    url?: string
    env?: Record<string, string>
    type?: string  // "stdio" | "http"
    enabled: boolean
}

export type ProviderFileEntry = {
  name: string
  content: string
  path: string
}

export type ProviderFileListResponse = {
  items: ProviderFileEntry[]
  dir: string
}

/**
 * Fetches MCP servers configured for a specific provider.
 * @param config - Backend connection configuration.
 * @param provider - Provider name (e.g. "CLAUDE").
 * @param projectId - Optional project ID to scope the query.
 * @returns Array of provider-specific MCP server records.
 */
export async function fetchProviderMCPServers(config: BackendConfig, provider: string, projectId?: string): Promise<ProviderMCPServer[]> {
    const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
    return requestJSON<ProviderMCPServer[]>(config, `/api/v1/agents/${encodeURIComponent(provider)}/mcp${params}`)
}

/**
 * Adds an MCP server to a specific provider's configuration.
 * @param config - Backend connection configuration.
 * @param provider - Provider name.
 * @param server - Server definition (name, command, optional args).
 */
export async function addProviderMCPServer(config: BackendConfig, provider: string, server: { name: string; command: string; args?: string[] }): Promise<void> {
    await requestJSON(config, `/api/v1/agents/${encodeURIComponent(provider)}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(server),
    })
}

/**
 * Removes an MCP server from a specific provider's configuration.
 * @param config - Backend connection configuration.
 * @param provider - Provider name.
 * @param name - Name of the MCP server to remove.
 */
export async function updateProviderMCPServer(config: BackendConfig, provider: string, name: string, server: Partial<ProviderMCPServer>): Promise<void> {
    await requestJSON(config, `/api/v1/agents/${encodeURIComponent(provider)}/mcp/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(server),
    })
}

export async function toggleProviderMCPServer(config: BackendConfig, provider: string, name: string, enabled: boolean): Promise<void> {
    await requestJSON(config, `/api/v1/agents/${encodeURIComponent(provider)}/mcp/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
    })
}

export async function deleteProviderMCPServer(config: BackendConfig, provider: string, name: string): Promise<void> {
    await requestJSON(config, `/api/v1/agents/${encodeURIComponent(provider)}/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export async function fetchCodexConfigFiles(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/codex/config?${params}`)
}

export async function saveCodexConfigFile(config: BackendConfig, scope: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/codex/config?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, path }),
  })
}

export async function createCodexConfigFile(config: BackendConfig, scope: string, projectId?: string): Promise<void> {
  await saveCodexConfigFile(config, scope, 'model = "gpt-5.3-codex"\n', projectId)
}

export async function fetchCodexInstructionFiles(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/codex/instructions?${params}`)
}

export async function saveCodexInstructionFile(config: BackendConfig, scope: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/codex/instructions?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, path }),
  })
}

export async function createCodexInstructionFile(config: BackendConfig, scope: string, projectId?: string): Promise<void> {
  const defaultContent = scope === 'project' ? '# Project Instructions\n' : '# Global Instructions\n'
  await saveCodexInstructionFile(config, scope, defaultContent, projectId)
}

export async function fetchCodexSubAgents(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/codex/subagents?${params}`)
}

export async function saveCodexSubAgent(config: BackendConfig, scope: string, name: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/codex/subagents?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content, path }),
  })
}

export async function createCodexSubAgent(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '-')
  await saveCodexSubAgent(config, scope, slug, `name = "${slug}"\ndescription = "Describe what this subagent does"\nmodel = "gpt-5.3-codex"\n\nprompt = """\nYou are ${name.trim() || slug}. Describe your role and instructions here.\n"""\n`, projectId)
}

export async function deleteCodexSubAgent(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/codex/subagents/${encodeURIComponent(name)}?${params}`, { method: 'DELETE' })
}

export async function fetchCodexSkills(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/codex/skills?${params}`)
}

export async function saveCodexSkill(config: BackendConfig, scope: string, name: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/codex/skills?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content, path }),
  })
}

export async function createCodexSkill(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '-')
  await saveCodexSkill(config, scope, slug, `---\nname: ${slug}\ndescription: Describe what this skill does\n---\n\n# ${name.trim() || slug}\n\nSkill instructions go here.\n`, projectId)
}

export async function deleteCodexSkill(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/codex/skills/${encodeURIComponent(name)}?${params}`, { method: 'DELETE' })
}

export async function fetchCodexRules(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/codex/rules?${params}`)
}

export async function saveCodexRule(config: BackendConfig, scope: string, name: string, content: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/codex/rules?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  })
}

export async function deleteCodexRule(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/codex/rules/${encodeURIComponent(name)}?${params}`, { method: 'DELETE' })
}

export async function fetchGeminiSettingsFiles(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/gemini/settings?${params}`)
}

export async function saveGeminiSettingsFile(config: BackendConfig, scope: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/gemini/settings?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, path }),
  })
}

export async function createGeminiSettingsFile(config: BackendConfig, scope: string, projectId?: string): Promise<void> {
  await saveGeminiSettingsFile(config, scope, '{\n  "mcpServers": {}\n}\n', projectId)
}

export async function fetchGeminiContextFiles(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/gemini/context?${params}`)
}

export async function saveGeminiContextFile(config: BackendConfig, scope: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/gemini/context?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, path }),
  })
}

export async function createGeminiContextFile(config: BackendConfig, scope: string, projectId?: string): Promise<void> {
  const defaultContent = scope === 'project' ? '# Project Context\n' : '# Global Context\n'
  await saveGeminiContextFile(config, scope, defaultContent, projectId)
}

export async function fetchGeminiCommands(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/gemini/commands?${params}`)
}

export async function saveGeminiCommand(config: BackendConfig, scope: string, name: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/gemini/commands?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content, path }),
  })
}

export async function createGeminiCommand(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  await saveGeminiCommand(config, scope, name, `description = "${name}"\nprompt = """\nDescribe the task this command should run.\n"""\n`, projectId)
}

export async function deleteGeminiCommand(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/gemini/commands/${encodeURIComponent(name)}?${params}`, { method: 'DELETE' })
}

export async function fetchOpenCodeConfigFiles(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/opencode/config?${params}`)
}

export async function saveOpenCodeConfigFile(config: BackendConfig, scope: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/opencode/config?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, path }),
  })
}

export async function createOpenCodeConfigFile(config: BackendConfig, scope: string, projectId?: string): Promise<void> {
  await saveOpenCodeConfigFile(config, scope, '{\n  "$schema": "https://opencode.ai/config.json"\n}\n', projectId)
}

export async function fetchOpenCodeAgentsFiles(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/opencode/agents?${params}`)
}

export async function saveOpenCodeAgentFile(config: BackendConfig, scope: string, name: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/opencode/agents?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content, path }),
  })
}

export async function createOpenCodeAgentFile(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  await saveOpenCodeAgentFile(config, scope, name, `---\ndescription: Describe what this agent does\nmode: subagent\n---\n\nYou are ${name}. Describe your role and instructions here.\n`, projectId)
}

export async function deleteOpenCodeAgentFile(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/opencode/agents/${encodeURIComponent(name)}?${params}`, { method: 'DELETE' })
}

export async function fetchOpenCodeCommandsFiles(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/opencode/commands?${params}`)
}

export async function saveOpenCodeCommandFile(config: BackendConfig, scope: string, name: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/opencode/commands?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content, path }),
  })
}

export async function createOpenCodeCommandFile(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  await saveOpenCodeCommandFile(config, scope, name, `---\ndescription: Describe what this command does\nagent: build\n---\n\nRun ${name}.\n`, projectId)
}

export async function deleteOpenCodeCommandFile(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/opencode/commands/${encodeURIComponent(name)}?${params}`, { method: 'DELETE' })
}

export async function fetchOpenCodeSkillsFiles(config: BackendConfig, scope: string, projectId?: string): Promise<ProviderFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON(config, `/api/v1/agents/opencode/skills?${params}`)
}

export async function saveOpenCodeSkillFile(config: BackendConfig, scope: string, name: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/opencode/skills?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content, path }),
  })
}

export async function createOpenCodeSkillFile(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  await saveOpenCodeSkillFile(config, scope, name, `# ${name}\n\nDescribe what this skill does.\n`, projectId)
}

export async function deleteOpenCodeSkillFile(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/opencode/skills/${encodeURIComponent(name)}?${params}`, { method: 'DELETE' })
}

/** Permission and tool access configuration for a provider. */
export type ProviderPermissions = {
    approval_mode: string
    allow: string[]
    deny: string[]
    ask: string[]
    allowed_tools?: string[]
    enabled_plugins?: string[]
    sandbox?: string
}

/** Model selection and inference parameters for a provider. */
export type ProviderModelConfig = {
    model: string
    effort: string
    temperature: number | null
}

/** A lifecycle hook configured for a provider (e.g. pre-run, post-run scripts). */
export type ProviderHook = {
    event: string
    matcher?: string
    type: string
    command: string
    timeout?: number
}

/**
 * Fetches the permission configuration for a specific provider.
 * @param config - Backend connection configuration.
 * @param provider - Provider name.
 * @param projectId - Optional project ID for project-scoped permissions.
 * @returns The provider's permission settings.
 */
export async function fetchProviderPermissions(config: BackendConfig, provider: string, projectId?: string, scope?: string): Promise<ProviderPermissions> {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    if (scope) params.set('scope', scope)
    const query = params.toString()
    return requestJSON<ProviderPermissions>(config, `/api/v1/agents/${encodeURIComponent(provider)}/permissions${query ? `?${query}` : ''}`)
}

/**
 * Updates the permission configuration for a specific provider.
 * @param config - Backend connection configuration.
 * @param provider - Provider name.
 * @param perms - The full permissions object to set.
 */
export async function updateProviderPermissions(config: BackendConfig, provider: string, perms: ProviderPermissions, projectId?: string, scope?: string): Promise<void> {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    if (scope) params.set('scope', scope)
    const query = params.toString()
    await requestJSON(config, `/api/v1/agents/${encodeURIComponent(provider)}/permissions${query ? `?${query}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(perms),
    })
}

/**
 * Fetches the model configuration for a specific provider.
 * @param config - Backend connection configuration.
 * @param provider - Provider name.
 * @returns The provider's model settings (model name, effort, temperature).
 */
export async function fetchProviderModel(config: BackendConfig, provider: string, projectId?: string, scope?: string): Promise<ProviderModelConfig> {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    if (scope) params.set('scope', scope)
    const query = params.toString()
    return requestJSON<ProviderModelConfig>(config, `/api/v1/agents/${encodeURIComponent(provider)}/model${query ? `?${query}` : ''}`)
}

/**
 * Updates the model configuration for a specific provider.
 * @param config - Backend connection configuration.
 * @param provider - Provider name.
 * @param model - The model configuration to set.
 */
export async function updateProviderModel(config: BackendConfig, provider: string, model: ProviderModelConfig, projectId?: string, scope?: string): Promise<void> {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    if (scope) params.set('scope', scope)
    const query = params.toString()
    await requestJSON(config, `/api/v1/agents/${encodeURIComponent(provider)}/model${query ? `?${query}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(model),
    })
}

/**
 * Fetches lifecycle hooks configured for a specific provider.
 * @param config - Backend connection configuration.
 * @param provider - Provider name.
 * @returns Array of hook definitions.
 */
export async function fetchProviderHooks(config: BackendConfig, provider: string, scope?: string, projectId?: string): Promise<ProviderHook[]> {
    const params = new URLSearchParams()
    if (scope) params.set('scope', scope)
    if (projectId) params.set('project_id', projectId)
    const query = params.toString()
    return requestJSON<ProviderHook[]>(config, `/api/v1/agents/${encodeURIComponent(provider)}/hooks${query ? `?${query}` : ''}`)
}

/**
 * Replaces all lifecycle hooks for a specific provider.
 * @param config - Backend connection configuration.
 * @param provider - Provider name.
 * @param hooks - The full array of hooks to set.
 */
export async function updateProviderHooks(config: BackendConfig, provider: string, hooks: ProviderHook[], scope?: string, projectId?: string): Promise<void> {
    const params = new URLSearchParams()
    if (scope) params.set('scope', scope)
    if (projectId) params.set('project_id', projectId)
    const query = params.toString()
    await requestJSON(config, `/api/v1/agents/${encodeURIComponent(provider)}/hooks${query ? `?${query}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hooks),
    })
}

/* ================================================================== */
/*  Claude-specific config endpoints                                   */
/* ================================================================== */

export interface ClaudeSettingsResponse {
  settings: Record<string, unknown>
  path: string
  exists: boolean
}

export interface ClaudeInstructionsResponse {
  content: string
  path: string
  exists: boolean
}

export interface ClaudeFileEntry {
  name: string
  content: string
  path: string
}

export interface ClaudeFileListResponse {
  items: ClaudeFileEntry[]
  dir: string
}

export async function fetchClaudeSettings(config: BackendConfig, scope: string, projectId?: string): Promise<ClaudeSettingsResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON<ClaudeSettingsResponse>(config, `/api/v1/agents/claude/settings?${params}`)
}

export async function updateClaudeSettings(config: BackendConfig, scope: string, settings: Record<string, unknown>, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/claude/settings?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  })
}

export async function fetchClaudeInstructions(config: BackendConfig, scope: string, projectId?: string): Promise<ClaudeInstructionsResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON<ClaudeInstructionsResponse>(config, `/api/v1/agents/claude/instructions?${params}`)
}

export async function updateClaudeInstructions(config: BackendConfig, scope: string, content: string, projectId?: string, path?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/claude/instructions?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, path }),
  })
}

export async function deleteClaudeInstructions(config: BackendConfig, scope: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/claude/instructions?${params}`, { method: 'DELETE' })
}

export async function fetchClaudeRules(config: BackendConfig, scope: string, projectId?: string): Promise<ClaudeFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON<ClaudeFileListResponse>(config, `/api/v1/agents/claude/rules?${params}`)
}

export async function updateClaudeRule(config: BackendConfig, scope: string, name: string, content: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/claude/rules?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  })
}

export async function deleteClaudeRule(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/claude/rules/${encodeURIComponent(name)}?${params}`, { method: 'DELETE' })
}

export async function fetchClaudeSkills(config: BackendConfig, scope: string, projectId?: string): Promise<ClaudeFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON<ClaudeFileListResponse>(config, `/api/v1/agents/claude/skills?${params}`)
}

export async function updateClaudeSkill(config: BackendConfig, scope: string, name: string, content: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/claude/skills?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  })
}

export async function deleteClaudeSkill(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/claude/skills/${encodeURIComponent(name)}?${params}`, { method: 'DELETE' })
}

export async function fetchClaudeSubAgents(config: BackendConfig, scope: string, projectId?: string): Promise<ClaudeFileListResponse> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  return requestJSON<ClaudeFileListResponse>(config, `/api/v1/agents/claude/subagents?${params}`)
}

export async function updateClaudeSubAgent(config: BackendConfig, scope: string, name: string, content: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/claude/subagents?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  })
}

export async function deleteClaudeSubAgent(config: BackendConfig, scope: string, name: string, projectId?: string): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('project_id', projectId)
  await requestJSON(config, `/api/v1/agents/claude/subagents/${encodeURIComponent(name)}?${params}`, { method: 'DELETE' })
}

/**
 * Checks the health status of the speech-to-text subsystem.
 * @param config - Backend connection configuration.
 * @returns STT health status including readiness and model info.
 */
export async function fetchSTTHealth(config: BackendConfig): Promise<STTHealth> {
  return requestJSON<STTHealth>(config, '/api/v1/stt/health')
}

/**
 * Sends an audio recording to the backend for speech-to-text transcription.
 * @param config - Backend connection configuration.
 * @param audio - Audio blob to transcribe (typically WebM format).
 * @param language - Optional language hint for the transcription model.
 * @returns Transcription result with text and timing info.
 */
export async function transcribeAudio(config: BackendConfig, audio: Blob, language?: string): Promise<STTTranscriptionResult> {
  const form = new FormData()
  form.append('audio', audio, 'recording.webm')
  if (language && language.trim() !== '') {
    form.append('language', language.trim())
  }

  return requestJSON<STTTranscriptionResult>(config, '/api/v1/stt/transcribe', {
    method: 'POST',
    body: form,
  })
}

/**
 * Checks out a git branch in a project workspace.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param branch - Branch name to check out.
 */
export async function gitCheckout(config: BackendConfig, projectId: string, branch: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch }) })
}

/**
 * Creates a new git branch in a project workspace.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param name - Name of the new branch.
 */
export async function gitCreateBranch(config: BackendConfig, projectId: string, name: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/branches`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
}

/**
 * Deletes a git branch from a project workspace.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param branch - Branch name to delete.
 */
export async function gitDeleteBranch(config: BackendConfig, projectId: string, branch: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/branches/${encodeURIComponent(branch)}`, { method: 'DELETE' })
}

/**
 * Stages files for the next git commit in a project workspace.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param files - Array of file paths to stage.
 */
export async function gitStage(config: BackendConfig, projectId: string, files: string[]): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) })
}

/**
 * Unstages files from the git index in a project workspace.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param files - Array of file paths to unstage.
 */
export async function gitUnstage(config: BackendConfig, projectId: string, files: string[]): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/unstage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) })
}

/**
 * Merges a branch into the current branch in a project workspace.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param branch - Branch name to merge.
 */
export async function gitMerge(config: BackendConfig, projectId: string, branch: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  })
}

/**
 * Stashes uncommitted changes in a project workspace.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 */
export async function gitStash(config: BackendConfig, projectId: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/stash`, { method: 'POST' })
}

/**
 * Pops the most recent stash entry in a project workspace.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 */
export async function gitStashPop(config: BackendConfig, projectId: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/stash/pop`, { method: 'POST' })
}

export type StashEntry = { ref: string; message: string }

export async function gitStashList(config: BackendConfig, projectId: string): Promise<StashEntry[]> {
  const data = await requestJSON<StashEntry[]>(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/stash/list`)
  return data || []
}

export async function gitStashApply(config: BackendConfig, projectId: string, ref: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/stash/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref })
  })
}

export async function gitStashDrop(config: BackendConfig, projectId: string, ref: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/stash/drop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref })
  })
}

export type ConflictStatus = { in_merge: boolean; files: string[] }

export async function gitGetConflicts(config: BackendConfig, projectId: string): Promise<ConflictStatus> {
  return requestJSON<ConflictStatus>(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/conflicts`)
}

export async function gitMergeAbort(config: BackendConfig, projectId: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/merge/abort`, { method: 'POST' })
}

export async function gitConflictResolve(config: BackendConfig, projectId: string, file: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/git/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file })
  })
}

/**
 * Fetches reviews for a GitHub pull request.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param prNumber - The PR number.
 * @returns Array of review objects.
 */
export async function fetchPRReviews(config: BackendConfig, projectId: string, prNumber: number): Promise<unknown[]> {
  return requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/reviews`)
}

/**
 * Submits a review on a GitHub pull request.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param prNumber - The PR number.
 * @param body - Review body text.
 * @param event - Review event type (e.g. "APPROVE", "REQUEST_CHANGES", "COMMENT").
 */
export async function submitPRReview(config: BackendConfig, projectId: string, prNumber: number, body: string, event: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, event }) })
}

/**
 * Merges a GitHub pull request.
 * @param config - Backend connection configuration.
 * @param projectId - The project UUID.
 * @param prNumber - The PR number.
 * @param method - Merge method (e.g. "merge", "squash", "rebase").
 */
export async function mergePR(config: BackendConfig, projectId: string, prNumber: number, method: string): Promise<void> {
  await requestJSON(config, `/api/v1/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/merge`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method }) })
}

// --- Unsandbox Configuration ---

/** Configuration state for the Unsandbox remote execution integration. */
export type UnsandboxConfig = {
  configured: boolean
  public_key: string
  has_secret: boolean
}

/** Runtime status of the Unsandbox integration (validity, errors). */
export type UnsandboxStatus = {
  configured: boolean
  valid?: boolean
  error?: string
  key_info?: Record<string, unknown>
}

/**
 * Fetches the current Unsandbox API key configuration.
 * @param config - Backend connection configuration.
 * @returns The Unsandbox configuration state.
 */
export async function fetchUnsandboxConfig(config: BackendConfig): Promise<UnsandboxConfig> {
  return requestJSON<UnsandboxConfig>(config, '/api/v1/config/unsandbox')
}

/**
 * Saves Unsandbox API keys to the backend configuration.
 * @param config - Backend connection configuration.
 * @param publicKey - Unsandbox public API key.
 * @param secretKey - Unsandbox secret API key.
 * @returns The updated Unsandbox configuration.
 */
export async function saveUnsandboxConfig(config: BackendConfig, publicKey: string, secretKey: string): Promise<UnsandboxConfig> {
  return requestJSON<UnsandboxConfig>(config, '/api/v1/config/unsandbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_key: publicKey, secret_key: secretKey }),
  })
}

/**
 * Deletes the stored Unsandbox API keys from the backend.
 * @param config - Backend connection configuration.
 */
export async function deleteUnsandboxConfig(config: BackendConfig): Promise<void> {
  await requestJSON<void>(config, '/api/v1/config/unsandbox', {
    method: 'DELETE',
  })
}

/**
 * Fetches the current Unsandbox integration status (whether keys are valid).
 * @param config - Backend connection configuration.
 * @returns The Unsandbox runtime status.
 */
export async function fetchUnsandboxStatus(config: BackendConfig): Promise<UnsandboxStatus> {
  return requestJSON<UnsandboxStatus>(config, '/api/v1/unsandbox/status')
}

/** Result of executing code in the Unsandbox remote environment. */
export type UnsandboxExecuteResult = {
  status: string
  output: string
  error: string
  job_id: string
}

/**
 * Executes code in the Unsandbox remote sandbox environment.
 * @param config - Backend connection configuration.
 * @param language - Programming language (e.g. "python", "bash").
 * @param code - Source code to execute.
 * @param network - Network access level (defaults to "semitrusted").
 * @returns Execution result with output, errors, and job ID.
 */
export async function executeUnsandbox(
  config: BackendConfig,
  language: string,
  code: string,
  network?: string,
): Promise<UnsandboxExecuteResult> {
  return requestJSON<UnsandboxExecuteResult>(config, '/api/v1/unsandbox/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language, code, network: network || 'semitrusted' }),
  }, 150000)
}

/** An active or completed Unsandbox execution session. */
export type UnsandboxSession = {
  id: string
  language: string
  status: string
  created_at?: string
  [key: string]: unknown
}

/**
 * Fetches all Unsandbox execution sessions.
 * @param config - Backend connection configuration.
 * @returns Object containing array of session records.
 */
export async function fetchUnsandboxSessions(config: BackendConfig): Promise<{ sessions: UnsandboxSession[] }> {
  return requestJSON<{ sessions: UnsandboxSession[] }>(config, '/api/v1/unsandbox/sessions')
}

/** A service running within the Unsandbox environment. */
export type UnsandboxService = {
  id: string
  status: string
  [key: string]: unknown
}

/**
 * Fetches all services running in the Unsandbox environment.
 * @param config - Backend connection configuration.
 * @returns Object containing array of service records.
 */
export async function fetchUnsandboxServices(config: BackendConfig): Promise<{ services: UnsandboxService[] }> {
  return requestJSON<{ services: UnsandboxService[] }>(config, '/api/v1/unsandbox/services')
}

// --- Runtime Connections ---

/** Configuration for a Tailscale SSH remote runtime. */
export type TailscaleConfig = {
  configured: boolean
  ssh_host: string
  ssh_user: string
  ssh_key_path: string
  ssh_port: number
  worktree_root: string
}

/** Configuration for a Kubernetes remote runtime. */
export type KubernetesConfig = {
  configured: boolean
  kubeconfig_path: string
  namespace: string
  image: string
  git_repo_url: string
  service_account: string
}

/** Fetches the list of available runtime targets and their configured status. */
export async function fetchAvailableRuntimes(config: BackendConfig): Promise<RuntimeEntry[]> {
  const res = await requestJSON<{ runtimes: RuntimeEntry[] }>(config, '/api/v1/config/runtimes')
  return res.runtimes ?? []
}

/** Fetches the current Tailscale runtime configuration. */
export async function fetchTailscaleConfig(config: BackendConfig): Promise<TailscaleConfig> {
  return requestJSON<TailscaleConfig>(config, '/api/v1/config/tailscale')
}

/** Saves Tailscale runtime configuration to the backend. */
export async function saveTailscaleConfig(config: BackendConfig, data: Partial<TailscaleConfig>): Promise<TailscaleConfig> {
  return requestJSON<TailscaleConfig>(config, '/api/v1/config/tailscale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

/** Deletes the stored Tailscale runtime configuration. */
export async function deleteTailscaleConfig(config: BackendConfig): Promise<void> {
  await requestJSON<void>(config, '/api/v1/config/tailscale', { method: 'DELETE' })
}

/** Tests reachability of the configured Tailscale SSH host. */
export async function testTailscaleConfig(config: BackendConfig): Promise<{ reachable: boolean; error?: string }> {
  return requestJSON<{ reachable: boolean; error?: string }>(config, '/api/v1/config/tailscale/test')
}

/** Fetches the current Kubernetes runtime configuration. */
export async function fetchKubernetesConfig(config: BackendConfig): Promise<KubernetesConfig> {
  return requestJSON<KubernetesConfig>(config, '/api/v1/config/kubernetes')
}

/** Saves Kubernetes runtime configuration to the backend. */
export async function saveKubernetesConfig(config: BackendConfig, data: Partial<KubernetesConfig>): Promise<KubernetesConfig> {
  return requestJSON<KubernetesConfig>(config, '/api/v1/config/kubernetes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

/** Deletes the stored Kubernetes runtime configuration. */
export async function deleteKubernetesConfig(config: BackendConfig): Promise<void> {
  await requestJSON<void>(config, '/api/v1/config/kubernetes', { method: 'DELETE' })
}

/** Tests reachability of the configured Kubernetes cluster. */
export async function testKubernetesConfig(config: BackendConfig): Promise<{ reachable: boolean; server_version?: string; error?: string }> {
  return requestJSON<{ reachable: boolean; server_version?: string; error?: string }>(config, '/api/v1/config/kubernetes/test')
}

/**
 * Fetches configured agent provider API keys from the orchestrator.
 * @param config - Backend connection configuration.
 * @returns Object containing provider configuration status and keys.
 */
export async function fetchAgentProviderKeys(config: BackendConfig): Promise<{
  providers: Record<string, { configured: boolean; api_key?: string }>
}> {
  return requestJSON(config, '/api/v1/config/agent-providers')
}

/**
 * Saves an API key for a specific agent provider.
 * @param config - Backend connection configuration.
 * @param providerId - The provider identifier (e.g. 'openai', 'claude').
 * @param apiKey - The API key to save.
 */
export async function saveAgentProviderKey(
  config: BackendConfig,
  providerId: string,
  apiKey: string,
): Promise<void> {
  await requestJSON(config, '/api/v1/config/agent-providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: providerId, api_key: apiKey }),
  })
}


// ===========================================================================
// Usage tracking — per-provider session/cost analytics from local CLI logs.
// Mirrors Orca's claude-usage / codex-usage IPC surface as REST.
// ===========================================================================

export type UsageProvider = 'claude' | 'codex' | 'gemini' | 'opencode'
export type UsageScope = 'orchestra' | 'all'
export type UsageRange = '7d' | '30d' | '90d' | 'all'
export type UsageBreakdownKind = 'model' | 'project'

export type UsageScanState = {
  provider: UsageProvider
  enabled: boolean
  is_scanning: boolean
  last_scan_started_at?: number
  last_scan_completed_at?: number
  last_scan_error?: string
  has_any_data: boolean
  source_path_exists: boolean
  source_path?: string
}

export type UsageSummary = {
  provider: UsageProvider
  scope: UsageScope
  range: UsageRange
  sessions: number
  turns: number
  zero_cache_read_turns: number
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  cache_reuse_rate?: number
  estimated_cost_usd?: number
  top_model?: string
  top_project?: string
  has_any_data: boolean
  has_inferred_pricing: boolean
}

export type UsageDailyPoint = {
  day: string
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
}

export type UsageBreakdownRow = {
  key: string
  label: string
  sessions: number
  turns: number
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated_cost_usd?: number
  has_inferred_pricing: boolean
}

export type UsageSessionRow = {
  provider: UsageProvider
  session_id: string
  last_active_at: string
  duration_minutes: number
  project_label: string
  branch?: string
  model?: string
  turns: number
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  estimated_cost_usd?: number
  has_inferred_pricing: boolean
}

export type RateLimitWindow = {
  used_percent: number
  window_minutes: number
  resets_at?: number
  reset_description?: string
}

export type ProviderRateLimits = {
  provider: UsageProvider
  session?: RateLimitWindow
  weekly?: RateLimitWindow
  updated_at: number
  status: 'idle' | 'fetching' | 'ok' | 'error' | 'unavailable'
  error?: string
}

export type RateLimitState = {
  claude?: ProviderRateLimits
  codex?: ProviderRateLimits
  gemini?: ProviderRateLimits
  opencode?: ProviderRateLimits
}

function usageQS(scope: UsageScope, range: UsageRange, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ scope, range, ...extra })
  return `?${params.toString()}`
}

export async function fetchUsageScanState(config: BackendConfig, provider: UsageProvider): Promise<UsageScanState> {
  return requestJSON<UsageScanState>(config, `/api/v1/usage/${provider}/scan-state`)
}

export async function setUsageEnabled(config: BackendConfig, provider: UsageProvider, enabled: boolean): Promise<UsageScanState> {
  return requestJSON<UsageScanState>(config, `/api/v1/usage/${provider}/enabled`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

export async function refreshUsage(config: BackendConfig, provider: UsageProvider, force = false): Promise<UsageScanState> {
  return requestJSON<UsageScanState>(config, `/api/v1/usage/${provider}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  })
}

export async function fetchUsageSummary(config: BackendConfig, provider: UsageProvider, scope: UsageScope, range: UsageRange): Promise<UsageSummary> {
  return requestJSON<UsageSummary>(config, `/api/v1/usage/${provider}/summary${usageQS(scope, range)}`)
}

export async function fetchUsageDaily(config: BackendConfig, provider: UsageProvider, scope: UsageScope, range: UsageRange): Promise<UsageDailyPoint[]> {
  return requestJSON<UsageDailyPoint[]>(config, `/api/v1/usage/${provider}/daily${usageQS(scope, range)}`) ?? []
}

export async function fetchUsageBreakdown(config: BackendConfig, provider: UsageProvider, scope: UsageScope, range: UsageRange, kind: UsageBreakdownKind): Promise<UsageBreakdownRow[]> {
  return requestJSON<UsageBreakdownRow[]>(config, `/api/v1/usage/${provider}/breakdown${usageQS(scope, range, { kind })}`) ?? []
}

export async function fetchUsageSessions(config: BackendConfig, provider: UsageProvider, scope: UsageScope, range: UsageRange, limit = 25): Promise<UsageSessionRow[]> {
  return requestJSON<UsageSessionRow[]>(config, `/api/v1/usage/${provider}/sessions${usageQS(scope, range, { limit: String(limit) })}`) ?? []
}

export async function fetchRateLimits(config: BackendConfig): Promise<RateLimitState> {
  return requestJSON<RateLimitState>(config, '/api/v1/usage/rate-limits')
}

export async function refreshRateLimits(config: BackendConfig): Promise<RateLimitState> {
  return requestJSON<RateLimitState>(config, '/api/v1/usage/rate-limits/refresh', { method: 'POST' })
}

// ─── Tracker work item types ─────────────────────────────────────────────────

import type { WorkItem } from '@/entities/tracker/types'

/** Browse work items from a global tracker config (used by useTrackerWorkItems configId path). */
export async function browseTrackerItems(
  config: BackendConfig,
  configId: string,
  filter?: { states?: string[] },
): Promise<WorkItem[]> {
  const params = new URLSearchParams()
  if (filter?.states?.length) {
    params.set('states', filter.states.join(','))
  }
  const qs = params.toString()
  const path = `/api/v1/tracker/configs/${encodeURIComponent(configId)}/issues${qs ? '?' + qs : ''}`
  return requestJSON<WorkItem[]>(config, path)
}

/** Browse live work items from a project's per-project issue source. */
export async function browseProjectTrackerItems(
  config: BackendConfig,
  projectId: string,
  filter?: { states?: string[] },
): Promise<WorkItem[]> {
  const params = new URLSearchParams()
  if (filter?.states?.length) {
    params.set('states', filter.states.join(','))
  }
  const qs = params.toString()
  const path = `/api/v1/projects/${encodeURIComponent(projectId)}/tracker/issues${qs ? '?' + qs : ''}`
  return requestJSON<WorkItem[]>(config, path)
}

export type TrackerConfig = {
  id: string
  type: string
  display_name: string
  endpoint: string
  auth_method: string
  has_token: boolean
  extra?: string
  created_at: number
  updated_at: number
}

export async function listTrackerConfigs(config: BackendConfig): Promise<TrackerConfig[]> {
  return requestJSON<TrackerConfig[]>(config, '/api/v1/tracker/configs')
}

export async function createTrackerConfig(
  config: BackendConfig,
  payload: { type: string; display_name: string; endpoint?: string; auth_method?: string; token?: string; extra?: Record<string, unknown> },
): Promise<TrackerConfig> {
  return requestJSON<TrackerConfig>(config, '/api/v1/tracker/configs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function updateTrackerConfig(
  config: BackendConfig,
  id: string,
  payload: { display_name?: string; endpoint?: string; token?: string; extra?: Record<string, unknown> },
): Promise<TrackerConfig> {
  return requestJSON<TrackerConfig>(config, `/api/v1/tracker/configs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteTrackerConfig(config: BackendConfig, id: string): Promise<void> {
  await requestJSON<void>(config, `/api/v1/tracker/configs/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function testTrackerConfig(
  config: BackendConfig,
  id: string,
): Promise<{ ok: boolean; latency_ms?: number; error?: string }> {
  return requestJSON<{ ok: boolean; latency_ms?: number; error?: string }>(
    config,
    `/api/v1/tracker/configs/${encodeURIComponent(id)}/test`,
    { method: 'POST' },
  )
}
