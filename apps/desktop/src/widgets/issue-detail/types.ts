import type { IssueHistoryEntry as APIIssueHistoryEntry, MCPTool } from '@/lib/orchestra-client'

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
  [key: string]: unknown
}

export type ToolSummary = MCPTool
export type IssueHistoryEntry = APIIssueHistoryEntry
