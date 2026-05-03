/** Connection credentials for the orchestrator backend API. */
export type BackendConfig = {
  /** Base URL of the orchestrator HTTP server (e.g. "http://127.0.0.1:4010"). */
  baseUrl: string
  /** Bearer token used to authenticate API requests. */
  apiToken: string
  /** Optional map of MCP server names to their connection URIs. */
  mcpServers?: Record<string, string>
}

/** A named backend connection profile persisted by the desktop bridge. */
export type BackendProfile = {
  /** Unique identifier for this profile. */
  id: string
  /** Human-readable profile name. */
  name: string
  /** Base URL of the orchestrator HTTP server. */
  baseUrl: string
  /** Bearer token for authentication. */
  apiToken: string
}

/** Payload returned by the desktop bridge containing all saved backend profiles. */
export type BridgeProfilesPayload = {
  /** ID of the currently active profile. */
  activeProfileId: string
  /** All available backend profiles. */
  profiles: BackendProfile[]
}

/** Aggregate counts included in a runtime snapshot. */
export type SnapshotCounts = {
  /** Number of issues currently being executed by agents. */
  running: number
  /** Number of issues waiting for a retry attempt. */
  retrying: number
}

/** An issue that is actively being worked on by an agent. */
export type RunningEntry = {
  /** Internal UUID of the issue. */
  issue_id: string
  /** Human-readable issue identifier (e.g. "ORK-42"). */
  issue_identifier: string
  /** Current lifecycle state (typically "RUNNING"). */
  state: string
  /** Active agent session ID, if available. */
  session_id?: string
  /** Number of agent conversation turns completed so far. */
  turn_count?: number
  /** Kind of the most recent event (e.g. "tool_call"). */
  last_event?: string
  /** Text of the most recent agent message. */
  last_message?: string
  /** ISO-8601 timestamp of the most recent event. */
  last_event_at?: string
  /** ISO-8601 timestamp when the run started. */
  started_at?: string
  /** Provider executing this run. */
  provider?: string
  /** Issue title. */
  title?: string
  /** Issue description body. */
  description?: string
  /** ID of the assignee agent. */
  assignee_id?: string
  /** ID of the project this issue belongs to. */
  project_id?: string
  /** Filesystem path to the session log file. */
  session_log_path?: string
  /** Tool names disabled for this run. */
  disabled_tools?: string[]
  /** Token usage counters for this run. */
  tokens?: { input_tokens: number; output_tokens: number; total_tokens: number }
}

/** An issue that failed and is scheduled for an automatic retry. */
export type RetryEntry = {
  /** Internal UUID of the issue. */
  issue_id: string
  /** Human-readable issue identifier. */
  issue_identifier: string
  /** Current lifecycle state (typically "RETRYING"). */
  state: string
  /** Zero-based retry attempt number. */
  attempt: number
  /** ISO-8601 timestamp when the next retry is due. */
  due_at: string
  /** Error message from the failed attempt. */
  error: string
  /** Provider that will handle the retry. */
  provider?: string
}

/** Cumulative token usage and runtime totals across all codex sessions. */
export type CodexTotals = {
  /** Total input (prompt) tokens consumed. */
  input_tokens: number
  /** Total output (completion) tokens produced. */
  output_tokens: number
  /** Sum of input and output tokens. */
  total_tokens: number
  /** Total wall-clock seconds spent running agent sessions. */
  seconds_running: number
}

/** Full point-in-time snapshot of the orchestrator runtime state. */
export type SnapshotPayload = {
  /** ISO-8601 timestamp when this snapshot was generated. */
  generated_at: string
  /** Aggregate running/retrying counts. */
  counts: SnapshotCounts
  /** All currently running issue entries. */
  running: RunningEntry[]
  /** All issues currently awaiting retry. */
  retrying: RetryEntry[]
  /** Cumulative token and runtime totals. */
  codex_totals: CodexTotals
  /** Provider-level rate limit information, if any. */
  rate_limits: Record<string, unknown> | null
  /** Map of MCP server name to status, when available. */
  mcp_servers?: Record<string, string>
}

/** Generic wrapper for a single SSE event received from the orchestrator. */
export type EventEnvelope = {
  /** Event type identifier (e.g. "RUN_STARTED", "HOOK_COMPLETED"). */
  type: string
  /** ISO-8601 timestamp of the event. */
  timestamp: string
  /** Arbitrary event payload data. */
  data: Record<string, unknown>
}

/** Standard error response shape returned by the orchestrator API. */
export type APIErrorEnvelope = {
  error: {
    /** Machine-readable error code (e.g. "unauthorized", "not_found"). */
    code: string
    /** Human-readable error description. */
    message: string
  }
}

/** Detailed server-side payload for a single issue, including runtime and log data. */
export type IssueDetailPayload = {
  issue_identifier: string
  issue_id: string
  status: string
  attempts: {
    restart_count: number
    current_retry_attempt: number
  }
  workspace: {
    path: string
  }
  running: RunningEntry | null
  retry: RetryEntry | null
  logs: { codex_session_logs: Array<{ label: string; path: string; url?: string }> }
  recent_events: Array<Record<string, unknown>>
  last_error: string | null
  tracked: Record<string, unknown>
}

/** A registered project (local workspace) managed by the orchestrator.
 *
 * `github_token` is redacted by the backend: it is either an empty string
 * ("not connected") or a fixed sentinel ("<set>") indicating a token is
 * configured server-side. Treat as opaque truthy/falsy only — never as the
 * actual secret. */
export type Project = {
  id: string
  name: string
  root_path: string
  remote_url: string
  github_owner?: string
  github_repo?: string
  github_token?: string
  tracker_config_id?: string
  path_exists?: boolean
}

/** Aggregate statistics for a single project. */
export type ProjectStats = {
  total_sessions: number
  total_input: number
  total_output: number
  success_count?: number
  failure_count?: number
  last_active: string
}

/** Platform-wide token usage and session statistics (warehouse). */
export type ProviderTokens = {
  total: number
  input: number
  output: number
  cache_read: number
  cache_write: number
  thinking: number
}

/** Per-provider session counts and success rates. */
export type ProviderSessionStats = {
  total: number
  completed: number
  failed: number
  avg_duration: number
}

export type GlobalStats = {
  total_tokens: number
  total_input: number
  total_output: number
  total_cache_read: number
  total_cache_write: number
  total_thinking: number
  provider_usage: Record<string, number>
  provider_tokens?: Record<string, ProviderTokens>
  model_usage: Record<string, number>
  provider_sessions?: Record<string, ProviderSessionStats>
  recent_sessions: SessionSummary[]
}

/** Abbreviated session record used in list views and statistics. */
export type SessionSummary = {
  id: string
  source?: string
  provider?: string
  model?: string
  project_id?: string
  project_name?: string
  total_input: number
  total_output: number
  updated_at: string
  [key: string]: unknown
}

/** Configuration file (CLAUDE.md, skill file, etc.) for an agent. */
export type AgentConfig = {
  name: string
  content: string
  path: string
  category: 'CORE' | 'SKILL'
  scope: 'GLOBAL' | 'PROJECT'
  provider?: string
  resource_type?: string
  variant?: string
  priority?: number
  origin?: string
  depth?: number
}

/** A documentation file or folder in the docs tree. */
export type DocItem = {
  name: string
  path: string
  category: string
  is_folder: boolean
  children?: DocItem[]
}

/** A single event within an agent session timeline. */
export type SessionEvent = {
  kind: string
  timestamp: string
  message: string
  input_tokens?: number
  output_tokens?: number
  raw_payload?: string
  [key: string]: unknown
}

/** Full detail record for an individual agent session. */
export type SessionDetail = {
  id: string
  provider: string
  project_name?: string
  created_at: string
  total_input: number
  total_output: number
  events?: SessionEvent[]
  [key: string]: unknown
}

/** A reference to an issue that blocks another issue. */
export type Blocker = {
  id: string
  identifier?: string
  state?: string
}

/** Full issue record as stored by the orchestrator. */
export type Issue = {
  id: string
  identifier: string
  title: string
  description?: string
  priority?: number
  state: string
  branch_name?: string
  url?: string
  project_id?: string
  assignee_id?: string
  assigned_to_worker: boolean
  labels?: string[]
  blocked_by?: Blocker[]
  provider?: string
  disabled_tools?: string[]
  created_at?: string
  updated_at?: string
}
