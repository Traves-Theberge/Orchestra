// apps/desktop/src/entities/tracker/types.ts

/** Source identifier for a WorkItem — which tracker produced it. */
export type WorkItemSource = 'github' | 'linear' | 'jira' | 'sqlite' | 'memory'

/** Unified domain type for a tracked work item across all backends. */
export interface WorkItem {
  /** Tracker-prefixed unique ID, e.g. "linear:abc-123", "jira:10001", "gh:42". */
  id: string
  /** Human-readable identifier as displayed by the source tracker, e.g. "ENG-42". */
  identifier: string
  source: WorkItemSource
  title: string
  description: string
  state: string
  priority: number
  url: string
  labels: string[]
  assignees: string[]
  /** Single primary assignee — set by all backends. */
  assignee_id?: string
  project_id?: string
  branch_name?: string
  pr_url?: string
  created_at: string
  updated_at: string
  /** Tracker-specific metadata (Linear cycle, Jira sprint, JQL match, etc.). */
  extra: Record<string, unknown>
}

/** A configured tracker connection. Tokens are never exposed to the frontend. */
export interface TrackerConfig {
  id: string
  type: string
  display_name: string
  endpoint: string
  auth_method: 'apikey' | 'oauth' | string
  /** True if a token is stored (encrypted) on the backend. */
  has_token: boolean
  /** JSON-encoded provider-specific extras (state_map, jql, cycle filter). */
  extra: string
  created_at: number
  updated_at: number
}

/** A top-level container in the tracker (Linear team, Jira project, GitHub repo). */
export interface TrackerProject {
  id: string
  name: string
}

/** A workflow state available in a tracker connection. */
export interface TrackerState {
  id: string
  name: string
  type: 'todo' | 'in_progress' | 'done' | 'cancelled' | string
}

/** Client-side filter for browsing work items. */
export interface WorkItemFilter {
  states?: string[]
  labels?: string[]
  assigneeId?: string
  search?: string
}

/** Request body for creating a tracker config. */
export interface CreateTrackerConfigRequest {
  type: string
  display_name: string
  endpoint: string
  auth_method: string
  token: string
  extra?: Record<string, unknown>
}

/** Request body for updating a tracker config. All fields optional. */
export interface UpdateTrackerConfigRequest {
  display_name?: string
  endpoint?: string
  auth_method?: string
  token?: string
  extra?: Record<string, unknown>
}

/** Result of a test-connection ping. */
export interface TestConnectionResult {
  ok: boolean
  error?: string
}
