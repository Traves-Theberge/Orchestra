import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

// ── Tool Registry ──────────────────────────────────────────────

type ToolCategory = 'issues' | 'projects' | 'git' | 'sessions' | 'search' | 'code' | 'scheduling' | 'mcp' | 'navigation' | 'system'

type ToolRegistryEntry = {
  name: string
  category: ToolCategory
  summary: string
  when: string
  prerequisites?: string
  mutates: boolean
  confirm: boolean
}

const TOOL_REGISTRY: ToolRegistryEntry[] = [
  // ── Issues ───────────────────────────────────────────────────
  {
    name: 'list_issues',
    category: 'issues',
    summary: 'List issues, optionally filtered by state, project, or assignee.',
    when: 'User asks to show, list, or view issues.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'create_issue',
    category: 'issues',
    summary: 'Create a new issue with title, description, state, and optional provider.',
    when: 'User asks to create, add, or file a new issue/task/ticket.',
    mutates: true,
    confirm: false,
  },
  {
    name: 'update_issue',
    category: 'issues',
    summary: 'Update fields on an existing issue by identifier.',
    when: 'User asks to change, update, edit, or move an issue.',
    mutates: true,
    confirm: false,
  },
  {
    name: 'delete_issue',
    category: 'issues',
    summary: 'Permanently delete an issue by identifier.',
    when: 'User explicitly asks to delete or remove an issue.',
    mutates: true,
    confirm: true,
  },
  {
    name: 'dispatch_agent',
    category: 'issues',
    summary: 'Assign an agent provider to an issue without changing the issue state.',
    when: 'User asks to dispatch, assign, or start an agent on an issue.',
    mutates: true,
    confirm: false,
  },
  {
    name: 'stop_session',
    category: 'issues',
    summary: 'Stop the active agent session for an issue.',
    when: 'User asks to stop, kill, or cancel a running session.',
    mutates: true,
    confirm: true,
  },

  // ── Projects ─────────────────────────────────────────────────
  {
    name: 'list_projects',
    category: 'projects',
    summary: 'List all projects in the orchestrator.',
    when: 'User asks to list or show projects.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'find_projects',
    category: 'projects',
    summary: 'Search for projects by name.',
    when: 'User mentions a project by name and you need to resolve its ID.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'get_project_stats',
    category: 'projects',
    summary: 'Get statistics for a project (sessions, tokens, activity).',
    when: 'User asks for project stats, metrics, or analytics.',
    prerequisites: 'Requires project_id — resolve via find_projects if user gives a name.',
    mutates: false,
    confirm: false,
  },

  // ── Git ──────────────────────────────────────────────────────
  {
    name: 'git_status',
    category: 'git',
    summary: 'Get modified, staged, and untracked files for a project.',
    when: 'User asks for git status, what changed, or working tree state.',
    prerequisites: 'Requires project_id — resolve via find_projects if user gives a name.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'git_history',
    category: 'git',
    summary: 'Get commit log and/or diff for a project.',
    when: 'User asks for git log, commit history, recent changes, or diff.',
    prerequisites: 'Requires project_id — resolve via find_projects if user gives a name.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'git_branches',
    category: 'git',
    summary: 'List, checkout, create, delete, or merge branches.',
    when: 'User asks about branches, wants to switch, create, delete, or merge.',
    prerequisites: 'Requires project_id — resolve via find_projects if user gives a name.',
    mutates: true,
    confirm: true,
  },
  {
    name: 'git_commit_flow',
    category: 'git',
    summary: 'Stage files and create a commit in one step.',
    when: 'User asks to commit, stage and commit, or save changes.',
    prerequisites: 'Requires project_id — resolve via find_projects if user gives a name.',
    mutates: true,
    confirm: false,
  },
  {
    name: 'git_sync',
    category: 'git',
    summary: 'Push or pull commits to/from a remote.',
    when: 'User asks to push, pull, or sync with remote.',
    prerequisites: 'Requires project_id — resolve via find_projects if user gives a name.',
    mutates: true,
    confirm: true,
  },
  {
    name: 'git_stash',
    category: 'git',
    summary: 'Stash or pop uncommitted changes.',
    when: 'User asks to stash, stash pop, or shelve changes.',
    prerequisites: 'Requires project_id — resolve via find_projects if user gives a name.',
    mutates: true,
    confirm: false,
  },

  // ── Sessions ─────────────────────────────────────────────────
  {
    name: 'summarize_session',
    category: 'sessions',
    summary: 'Summarize what happened in an issue session (actions, tokens, outcome).',
    when: 'User asks what the agent did, session summary, or what happened on an issue.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'get_session_logs',
    category: 'sessions',
    summary: 'Get the event timeline for an issue session.',
    when: 'User asks for session logs, events, or timeline.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'get_raw_logs',
    category: 'sessions',
    summary: 'Get raw text output from an agent session.',
    when: 'User asks for raw logs, exact output, or debugging info.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'list_sessions',
    category: 'sessions',
    summary: 'List all agent sessions, optionally filtered by project.',
    when: 'User asks to list or show sessions.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'get_session_detail',
    category: 'sessions',
    summary: 'Get full details for a specific session by ID.',
    when: 'User asks for details on a specific session.',
    mutates: false,
    confirm: false,
  },

  // ── Search ───────────────────────────────────────────────────
  {
    name: 'search_issues',
    category: 'search',
    summary: 'Search issues by text query or filter by state/project/assignee.',
    when: 'User asks to find, search, or filter issues.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'search_sessions',
    category: 'search',
    summary: 'Search session history, optionally by project.',
    when: 'User asks to search or find sessions.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'search_docs',
    category: 'search',
    summary: 'Search documentation by keyword or retrieve a specific doc.',
    when: 'User asks to search docs or find documentation.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'get_warehouse_stats',
    category: 'search',
    summary: 'Get platform-wide analytics (tokens, providers, sessions).',
    when: 'User asks about token usage, analytics, or platform stats.',
    mutates: false,
    confirm: false,
  },

  // ── Code Execution ───────────────────────────────────────────
  {
    name: 'execute_code',
    category: 'code',
    summary: 'Run a code snippet in the Unsandbox environment.',
    when: 'User asks to run, execute, or test code.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'check_sandbox_status',
    category: 'code',
    summary: 'Check if the Unsandbox environment is configured and available.',
    when: 'Before first code execution in a session, or user asks if sandbox is ready.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'list_sandbox_sessions',
    category: 'code',
    summary: 'List recent code execution sessions.',
    when: 'User asks about previous code runs or sandbox history.',
    mutates: false,
    confirm: false,
  },

  // ── Scheduling ───────────────────────────────────────────────
  {
    name: 'schedule_reminder',
    category: 'scheduling',
    summary: 'Schedule a reminder message to appear after a delay.',
    when: 'User asks to be reminded of something in X minutes.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'schedule_action',
    category: 'scheduling',
    summary: 'Schedule a tool execution to run after a delay.',
    when: 'User asks to run something later or on a timer.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'cancel_schedule',
    category: 'scheduling',
    summary: 'Cancel a pending scheduled item.',
    when: 'User asks to cancel a reminder or scheduled action.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'list_schedules',
    category: 'scheduling',
    summary: 'List all active scheduled reminders and actions.',
    when: 'User asks what is scheduled or pending.',
    mutates: false,
    confirm: false,
  },

  // ── MCP ──────────────────────────────────────────────────────
  {
    name: 'list_mcp_servers',
    category: 'mcp',
    summary: 'List all connected MCP servers.',
    when: 'User asks what MCP servers are connected.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'discover_mcp_tools',
    category: 'mcp',
    summary: 'Discover tools exposed by connected MCP servers (namespaced).',
    when: 'User asks what MCP tools are available.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'mcp_server_status',
    category: 'mcp',
    summary: 'Check connection status of all MCP servers with tool counts.',
    when: 'User asks for MCP status or health.',
    mutates: false,
    confirm: false,
  },

  // ── Navigation ───────────────────────────────────────────────
  {
    name: 'navigate_to',
    category: 'navigation',
    summary: 'Navigate the app to a specific section.',
    when: 'User asks to go to, open, or show a section (issues, projects, settings, etc).',
    mutates: false,
    confirm: false,
  },
  {
    name: 'open_settings_tab',
    category: 'navigation',
    summary: 'Open a specific tab within Settings.',
    when: 'User asks to open a specific settings tab (backend, agents, integrations, etc).',
    mutates: false,
    confirm: false,
  },

  // ── System ───────────────────────────────────────────────────
  {
    name: 'get_orchestrator_state',
    category: 'system',
    summary: 'Get the full orchestrator runtime snapshot (issues, agents, sessions).',
    when: 'User asks for system status, what is running, or runtime state.',
    mutates: false,
    confirm: false,
  },
  {
    name: 'render_ui',
    category: 'system',
    summary: 'Render a custom UI component using a JSON render spec.',
    when: 'You want to display structured data visually (tables, metrics, cards, code blocks).',
    mutates: false,
    confirm: false,
  },
]

// ── Category metadata ──────────────────────────────────────────

const CATEGORY_DESCRIPTIONS: Record<ToolCategory, string> = {
  issues: 'Create, update, delete, dispatch, and stop issues',
  projects: 'List, search, and get stats for projects',
  git: 'Git operations: status, history, branches, commit, push/pull, stash',
  sessions: 'Session logs, summaries, and details for agent runs',
  search: 'Search issues, sessions, docs, and platform analytics',
  code: 'Execute code in the Unsandbox sandbox',
  scheduling: 'Reminders and deferred tool executions',
  mcp: 'MCP server discovery and status',
  navigation: 'Navigate the app UI',
  system: 'Orchestrator state and rich UI rendering',
}

// ── Meta-tools ─────────────────────────────────────────────────

/**
 * Creates the meta-tools (search_tools, get_tool_schema) that enable
 * progressive tool discovery. The agent calls search_tools to find
 * relevant tools by category or keyword, then get_tool_schema to
 * inspect exact parameter shapes before calling them.
 */
export function createMetaTools(allTools: ToolSet) {
  return {
    search_tools: tool({
      description:
        'Discover available tools by category or keyword. Call this when the user\'s request needs a tool not in your core set (e.g. git, sessions, code execution, scheduling, MCP). ' +
        'Returns tool names, descriptions, and usage hints. ' +
        'Categories: issues, projects, git, sessions, search, code, scheduling, mcp, navigation, system.',
      inputSchema: z.object({
        query: z.string().optional().describe('Keyword to search across tool names and descriptions'),
        category: z.enum(['issues', 'projects', 'git', 'sessions', 'search', 'code', 'scheduling', 'mcp', 'navigation', 'system']).optional().describe('Filter by tool category'),
        detail: z.enum(['names', 'summary', 'full']).optional().default('summary').describe('Level of detail: names (just names), summary (name + description + when), full (all metadata)'),
      }),
      execute: async (params) => {
        let results = [...TOOL_REGISTRY]

        // Filter by category
        if (params.category) {
          results = results.filter((t) => t.category === params.category)
        }

        // Filter by keyword
        if (params.query) {
          const q = params.query.toLowerCase()
          results = results.filter((t) =>
            t.name.toLowerCase().includes(q) ||
            t.summary.toLowerCase().includes(q) ||
            t.when.toLowerCase().includes(q)
          )
        }

        // If no filters, return category overview
        if (!params.category && !params.query) {
          const counts = new Map<string, number>()
          for (const t of TOOL_REGISTRY) {
            counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
          }
          const categories = Object.entries(CATEGORY_DESCRIPTIONS).map(([cat, desc]) => ({
            category: cat,
            description: desc,
            tool_count: counts.get(cat) ?? 0,
          }))
          return { type: 'category_overview', categories, total_tools: TOOL_REGISTRY.length }
        }

        // Format by detail level
        switch (params.detail) {
          case 'names':
            return { tools: results.map((t) => t.name), count: results.length }
          case 'full':
            return { tools: results, count: results.length }
          case 'summary':
          default:
            return {
              tools: results.map((t) => ({
                name: t.name,
                summary: t.summary,
                when: t.when,
                ...(t.prerequisites ? { prerequisites: t.prerequisites } : {}),
                ...(t.confirm ? { confirm: true } : {}),
              })),
              count: results.length,
            }
        }
      },
    }),

    get_tool_schema: tool({
      description:
        'Get the full input schema (parameter names, types, descriptions) for a specific tool. ' +
        'Call this when you know which tool to use but need to confirm its exact parameters before calling it.',
      inputSchema: z.object({
        tool_name: z.string().describe('Exact name of the tool to inspect'),
      }),
      execute: async (params) => {
        const targetTool = allTools[params.tool_name]
        if (!targetTool) {
          const suggestions = TOOL_REGISTRY.flatMap((t) =>
            t.name.includes(params.tool_name) || params.tool_name.includes(t.name) ? [t.name] : []
          )
          return {
            error: `Tool "${params.tool_name}" not found.`,
            ...(suggestions.length > 0 ? { did_you_mean: suggestions } : {}),
          }
        }

        // Extract schema from the tool's parameters
        const registryEntry = TOOL_REGISTRY.find((t) => t.name === params.tool_name)
        try {
          const toolAny = targetTool as Record<string, unknown>
          const schema = toolAny.parameters ?? toolAny.inputSchema
           
          const jsonSchema = schema
            ? zodToJsonSchema(schema as any)
            : { type: 'object', properties: {} }
          return {
            name: params.tool_name,
            description: registryEntry?.summary || '',
            schema: jsonSchema,
            ...(registryEntry?.prerequisites ? { prerequisites: registryEntry.prerequisites } : {}),
            ...(registryEntry?.confirm ? { confirm_required: true } : {}),
          }
        } catch {
          // Fallback: return registry info without parsed schema
          return {
            name: params.tool_name,
            description: registryEntry?.summary || '',
            schema: { note: 'Schema available but could not be serialized. Call the tool directly.' },
          }
        }
      },
    }),
  }
}
