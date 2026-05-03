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

/** Client-side filter for browsing work items. */
export interface WorkItemFilter {
  states?: string[]
  labels?: string[]
  assigneeId?: string
  search?: string
}
