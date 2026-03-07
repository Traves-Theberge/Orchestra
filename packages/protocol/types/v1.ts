export type StateResponseV1 = {
  generated_at: string
  counts: {
    running: number
    retrying: number
  }
  running: Array<Record<string, unknown>>
  retrying: Array<Record<string, unknown>>
  codex_totals: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    seconds_running: number
  }
  rate_limits: unknown
}

export type RefreshResponseV1 = {
  queued: boolean
  coalesced: boolean
  requested_at: string
  operations: string[]
}

export type IssueResponseV1 = {
  issue_identifier: string
  issue_id: string
  status: string
  workspace: {
    path: string
  }
  attempts?: {
    restart_count: number
    current_retry_attempt: number
  }
  running?: Record<string, unknown> | null
  retry?: Record<string, unknown> | null
  logs?: Record<string, unknown>
  recent_events?: Array<Record<string, unknown>>
  last_error?: unknown
  tracked: Record<string, unknown>
}

export type WorkspaceMigrateResponseV1 = {
  from: string
  to: string
  dry_run: boolean
  result: {
    applied: boolean
    actions: Array<{
      type: string
      source: string
      target: string
      note?: string
    }>
  }
}

export type WorkspaceMigrationPlanResponseV1 = {
  from: string
  to: string
  result: {
    applied: boolean
    actions: Array<{
      type: string
      source: string
      target: string
      note?: string
    }>
  }
}
