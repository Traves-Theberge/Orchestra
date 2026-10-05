import type { IssueHistoryEntry as APIIssueHistoryEntry, MCPTool } from '@core/api/client'

export type IssueDetailResult = {
  id?: string
  issue_id?: string
  identifier?: string
  issue_identifier?: string
  title?: string
  description?: string
  state?: string
  assignee_id?: string
  priority?: number
  project_id?: string
  branch_name?: string
  url?: string
  provider?: string
  disabled_tools?: string[]
  updated_at?: string
  pr_url?: string
  feedback?: string
  plan?: string
  plan_gate?: { status: 'planning' | 'awaiting_approval' | 'approved' | 'stale' | 'failed' | 'unsupported'; plan_hash?: string; reason?: string }
  review_gate?: { status: 'not_reviewed' | 'running' | 'awaiting_human_approval' | 'changes_requested' | 'approved' | 'stale' | 'interrupted' | 'failed'; head_sha?: string; pr_url?: string; attempt_id?: string; reviewer_provider?: string; reviewer_agent_id?: string; feedback?: string }
  base_sha?: string
  [key: string]: unknown
}

export type ToolSummary = MCPTool
export type IssueHistoryEntry = APIIssueHistoryEntry
