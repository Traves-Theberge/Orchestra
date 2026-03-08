export type BackendConfig = {
  baseUrl: string
  apiToken: string
}

export type BackendProfile = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
}

export type BridgeProfilesPayload = {
  activeProfileId: string
  profiles: BackendProfile[]
}

export type SnapshotCounts = {
  running: number
  retrying: number
}

export type RunningEntry = {
  issue_id: string
  issue_identifier: string
  state: string
  session_id?: string
  turn_count?: number
  last_event?: string
  last_message?: string
  last_event_at?: string
  started_at?: string
}

export type RetryEntry = {
  issue_id: string
  issue_identifier: string
  state: string
  attempt: number
  due_at: string
  error: string
}

export type CodexTotals = {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  seconds_run: number
}

export type SnapshotPayload = {
  generated_at: string
  counts: SnapshotCounts
  running: RunningEntry[]
  retrying: RetryEntry[]
  codex_totals: CodexTotals
  rate_limits: Record<string, unknown> | null
}

export type EventEnvelope = {
  type: string
  timestamp: string
  data: Record<string, unknown>
}

export type APIErrorEnvelope = {
  error: {
    code: string
    message: string
  }
}

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
  running: Record<string, unknown> | null
  retry: Record<string, unknown> | null
  logs: Record<string, unknown>
  recent_events: Array<Record<string, unknown>>
  last_error: Record<string, unknown> | null
  tracked: Record<string, unknown>
}

export type Project = {
  id: string
  name: string
  root_path: string
  remote_url: string
}

export type ProjectStats = {
  total_sessions: number
  total_input: number
  total_output: number
  last_active: string
}

export type GlobalStats = {
  total_tokens: number
  total_input: number
  total_output: number
  provider_usage: Record<string, number>
  recent_sessions: any[]
}
