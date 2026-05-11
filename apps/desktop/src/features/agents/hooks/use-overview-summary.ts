import type { ProviderSummary } from '../panels/OverviewPanel'

interface ClaudeBundle {
  settings: { model?: string | null } | null
  claudeMd: string | null
  skills: Array<{ name: string }>
  hooks: unknown[]
  mcpServers: Record<string, unknown>
  subAgents: Array<{ name: string }>
}

export function computeClaudeSummary(b: ClaudeBundle): ProviderSummary {
  return {
    model: b.settings?.model ?? null,
    instructionsLines: b.claudeMd ? b.claudeMd.split('\n').length : null,
    skillsCount: b.skills.length,
    skillsAddedNames: b.skills.slice(0, 5).map(s => s.name.replace(/\.md$/, '')),
    mcpCount: Object.keys(b.mcpServers ?? {}).length,
    hooksCount: b.hooks.length,
    subAgentsCount: b.subAgents.length,
  }
}

// Project-vs-global summary: returns project bundle but with nulls
// for fields that are absent at project scope (inherits from global).
export function computeClaudeProjectSummary(
  global: ClaudeBundle,
  project: Partial<ClaudeBundle> | null,
): ProviderSummary | null {
  if (!project) return null
  const projectOnlySkills = (project.skills ?? []).filter(
    s => !global.skills.find(g => g.name === s.name)
  )
  return {
    model: project.settings?.model ?? null,
    instructionsLines: project.claudeMd ? project.claudeMd.split('\n').length : null,
    skillsCount: projectOnlySkills.length || null,
    skillsAddedNames: projectOnlySkills.slice(0, 5).map(s => s.name.replace(/\.md$/, '')),
    mcpCount: project.mcpServers ? Object.keys(project.mcpServers).length || null : null,
    hooksCount: project.hooks ? project.hooks.length || null : null,
    subAgentsCount: project.subAgents ? project.subAgents.length || null : null,
  }
}
