import { useMemo } from 'react'
import type { ProviderSummary } from '../panels/OverviewPanel'
import type { ClaudeConfigState } from '../hooks/use-claude-config'
import { computeClaudeSummary, computeClaudeProjectSummary } from '../hooks/use-overview-summary'

const EMPTY_SUMMARY: ProviderSummary = {
  model: null,
  instructionsLines: null,
  skillsCount: null,
  mcpCount: null,
  hooksCount: null,
  subAgentsCount: null,
}

export function useOverviewSummaries(
  isClaudeOrEightgent: boolean,
  agentHubProjectId: string | null,
  claudeGlobal: ClaudeConfigState,
  claudeProject: ClaudeConfigState,
): { globalSummary: ProviderSummary; projectSummary: ProviderSummary | null } {
  const claudeGlobalBundle = useMemo(() => ({
    settings: { model: (claudeGlobal.settings as { model?: string | null })?.model ?? null },
    claudeMd: claudeGlobal.instructionsExists ? claudeGlobal.instructions : null,
    skills: claudeGlobal.skills.map(s => ({ name: s.name })),
    hooks: claudeGlobal.hooks,
    mcpServers: Object.fromEntries(
      [
        ...claudeGlobal.providerMcpServers.map((s, i) => [s.name ?? `provider-${i}`, s]),
        ...claudeGlobal.orchestraMcpServers.map((s, i) => [s.name ?? `orchestra-${i}`, s]),
      ] as Array<[string, unknown]>,
    ),
    subAgents: claudeGlobal.subagents.map(a => ({ name: a.name })),
  }), [claudeGlobal])

  const globalSummary = useMemo<ProviderSummary>(() => {
    if (isClaudeOrEightgent) return computeClaudeSummary(claudeGlobalBundle)
    return EMPTY_SUMMARY
  }, [isClaudeOrEightgent, claudeGlobalBundle])

  const projectSummary = useMemo<ProviderSummary | null>(() => {
    if (!isClaudeOrEightgent) return null
    if (!agentHubProjectId) return null
    return computeClaudeProjectSummary(
      claudeGlobalBundle,
      {
        settings: { model: (claudeProject.settings as { model?: string | null })?.model ?? null },
        claudeMd: claudeProject.instructionsExists ? claudeProject.instructions : null,
        skills: claudeProject.skills.map(s => ({ name: s.name })),
        hooks: claudeProject.hooks,
        mcpServers: Object.fromEntries(
          [
            ...claudeProject.providerMcpServers.map((s, i) => [s.name ?? `provider-${i}`, s]),
            ...claudeProject.orchestraMcpServers.map((s, i) => [s.name ?? `orchestra-${i}`, s]),
          ] as Array<[string, unknown]>,
        ),
        subAgents: claudeProject.subagents.map(a => ({ name: a.name })),
      },
    )
  }, [isClaudeOrEightgent, agentHubProjectId, claudeGlobalBundle, claudeProject])

  return { globalSummary, projectSummary }
}
