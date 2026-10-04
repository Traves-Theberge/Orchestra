import { tool } from 'ai'
import { z } from 'zod'
import {
  createIssue, fetchAgents, fetchIssueDetail, fetchIssues, fetchProjects,
  fetchState, postRefresh, stopIssue, updateIssue,
  type BackendConfig,
} from '@core/api/client'

const identifier = z.string().trim().min(1)
const state = z.enum(['Backlog', 'Todo', 'In Progress', 'Review', 'Done'])

/** Domain tools delegate to the same API used by the board. Errors propagate to the tool caller. */
export function createOrchestraTools(config: BackendConfig) {
  return {
    get_state: tool({
      description: 'Read the current orchestration snapshot, including active runs and retries.',
      inputSchema: z.object({}),
      execute: async () => fetchState(config),
    }),
    list_issues: tool({
      description: 'List tasks, optionally filtered by board state, project or assignee.',
      inputSchema: z.object({ states: z.array(state).optional(), project_id: identifier.optional(), assignee_id: identifier.optional() }),
      execute: async (input) => ({ issues: await fetchIssues(config, input.states, input.project_id, input.assignee_id) }),
    }),
    get_issue: tool({
      description: 'Read a task by its issue identifier.',
      inputSchema: z.object({ issue_identifier: identifier }),
      execute: async (input) => fetchIssueDetail(config, input.issue_identifier),
    }),
    create_issue: tool({
      description: 'Create a task in Backlog. Resolve the project ID before creating it.',
      inputSchema: z.object({
        title: identifier, description: z.string().default(''), project_id: identifier,
        assignee_id: z.string().default(''), provider: identifier.optional(),
      }),
      execute: async (input) => createIssue(config, { ...input, state: 'Backlog' }),
    }),
    update_issue: tool({
      description: 'Update task fields through the board API. State changes can launch execution, publish changes or clean workspaces under current project policy; use only when requested.',
      inputSchema: z.object({
        issue_identifier: identifier,
        updates: z.object({ title: identifier.optional(), description: z.string().optional(), state: state.optional(), assignee_id: z.string().optional(), provider: identifier.optional() }).refine(value => Object.keys(value).length > 0, 'At least one update is required'),
      }),
      execute: async (input) => updateIssue(config, input.issue_identifier, input.updates),
    }),
    stop_issue: tool({
      description: 'Stop execution of a task when requested by the user.',
      inputSchema: z.object({ issue_identifier: identifier }),
      execute: async (input) => stopIssue(config, input.issue_identifier),
    }),
    list_projects: tool({
      description: 'List registered projects and their IDs.',
      inputSchema: z.object({}),
      execute: async () => ({ projects: await fetchProjects(config) }),
    }),
    list_agents: tool({
      description: 'List configured agent names.',
      inputSchema: z.object({}),
      execute: async () => ({ agents: await fetchAgents(config) }),
    }),
    refresh: tool({
      description: 'Request an orchestration refresh. This can admit eligible tasks under current policy.',
      inputSchema: z.object({}),
      execute: async () => postRefresh(config),
    }),
  }
}
