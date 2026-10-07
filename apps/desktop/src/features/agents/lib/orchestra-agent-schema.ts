import { z } from 'zod'
import type { AgentPermissions, OrchestraAgent, OrchestraAgentInput } from '@core/api/client'

const permission = z.enum(['allow', 'ask', 'deny']).or(z.literal(''))

export const orchestraAgentFormSchema = z.object({
  scope: z.enum(['global', 'project']),
  project_id: z.string(),
  name: z.string().trim()
    .min(1, 'Name is required')
    .max(64, 'Keep the name under 64 characters')
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'Use letters, numbers, - or _ (no spaces)'),
  description: z.string().trim().max(500, 'Keep the description under 500 characters'),
  mode: z.enum(['primary', 'subagent', 'all']),
  color: z.string().trim().refine(value => value === '' || /^#[0-9a-f]{6}$/i.test(value), 'Use a #rrggbb color'),
  model: z.string().trim(),
  effort: z.string().trim(),
  prompt: z.string().refine(value => value.trim().length > 0, 'Prompt is required'),
  skills: z.array(z.string()),
  mcp_servers: z.array(z.string()),
  permissions: z.object({ edit: permission, bash: permission, webfetch: permission }),
}).superRefine((value, ctx) => {
  if (value.scope === 'project' && !value.project_id) ctx.addIssue({ code: 'custom', path: ['project_id'], message: 'Choose a project for a project-scoped agent' })
})

export type OrchestraAgentFormValues = z.input<typeof orchestraAgentFormSchema>
export type OrchestraAgentFormErrors = Partial<Record<string, string>>

export function emptyAgentForm(scope: 'global' | 'project' = 'global', projectId = ''): OrchestraAgentFormValues {
  return { scope, project_id: projectId, name: '', description: '', mode: 'primary', color: '', model: '', effort: '', prompt: '', skills: [], mcp_servers: [], permissions: { edit: '', bash: '', webfetch: '' } }
}

export function agentToForm(agent: OrchestraAgent, projectId = ''): OrchestraAgentFormValues {
  return {
    scope: agent.scope, project_id: agent.scope === 'project' ? projectId : '', name: agent.name, description: agent.description ?? '', mode: agent.mode,
    color: agent.color ?? '', model: agent.model ?? '', effort: agent.effort ?? '', prompt: agent.prompt ?? '',
    skills: agent.skills ?? [], mcp_servers: agent.mcp_servers ?? [],
    permissions: { edit: agent.permissions?.edit ?? '', bash: agent.permissions?.bash ?? '', webfetch: agent.permissions?.webfetch ?? '' },
  }
}

/** Validates the editor and returns the API payload or a field → message map. */
export function validateAgentForm(values: OrchestraAgentFormValues): { ok: true; input: OrchestraAgentInput } | { ok: false; errors: OrchestraAgentFormErrors } {
  const result = orchestraAgentFormSchema.safeParse(values)
  if (!result.success) {
    const errors: OrchestraAgentFormErrors = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || 'form'
      if (!errors[key]) errors[key] = issue.message
    }
    return { ok: false, errors }
  }
  const data = result.data
  const permissions: AgentPermissions = {}
  for (const key of ['edit', 'bash', 'webfetch'] as const) if (data.permissions[key]) permissions[key] = data.permissions[key] as AgentPermissions[typeof key]
  return {
    ok: true,
    input: {
      scope: data.scope,
      ...(data.scope === 'project' ? { project_id: data.project_id } : {}),
      name: data.name,
      description: data.description,
      mode: data.mode,
      color: data.color,
      model: data.model,
      effort: data.effort,
      prompt: data.prompt,
      skills: data.skills,
      mcp_servers: data.mcp_servers,
      permissions,
    },
  }
}
