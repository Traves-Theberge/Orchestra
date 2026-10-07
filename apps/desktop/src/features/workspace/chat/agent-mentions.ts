import { useEffect, useState } from 'react'
import { fetchUnifiedAgents, type BackendConfig, type OrchestraAgent } from '@core/api/client'
import { isSubagentMode } from '@features/agents/lib/agent-display'
import { useAgentsRevision } from '@features/agents/lib/agents-events'

/** The `@query` token that ends at the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([\w.\-/]*)$/.exec(text.slice(0, caret))
  if (!match) return null
  return { start: caret - match[2].length - 1, query: match[2] }
}

/** Replaces the `@query` token with `@name ` and returns the new caret. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `
  const rest = text.slice(caret).replace(/^\S*/, '')
  return { text: text.slice(0, start) + inserted + rest.replace(/^ /, ''), caret: start + inserted.length }
}

/** Unified agent list for one project + harness; empty when the backend lacks the endpoint. */
export function useAgentDirectory(config: BackendConfig, projectId: string, harness: string, active = true): OrchestraAgent[] {
  const [state, setState] = useState<{ key: string; agents: OrchestraAgent[] }>({ key: '', agents: [] })
  const key = JSON.stringify([config.baseUrl, config.apiToken, config.workspaceId, projectId, harness])
  const revision = useAgentsRevision()
  useEffect(() => {
    if (!active || !harness) return
    let cancelled = false
    void Promise.resolve().then(() => fetchUnifiedAgents(config, { projectId: projectId === '__orchestrator__' ? undefined : projectId, harness }))
      .then(agents => { if (!cancelled) setState({ key, agents }) })
      .catch(() => { if (!cancelled) setState({ key, agents: [] }) })
    return () => { cancelled = true }
  }, [config, projectId, harness, key, active, revision])
  return state.key === key ? state.agents : []
}

/** Subagents the selected harness can receive as `@name` mentions. */
export function mentionCandidates(agents: OrchestraAgent[], harness: string, query: string): OrchestraAgent[] {
  const target = harness.toLowerCase()
  const needle = query.toLowerCase()
  const seen = new Set<string>()
  return agents.filter(agent => {
    if (!isSubagentMode(agent.mode) || agent.selectable === false || seen.has(agent.name)) return false
    const compatible = agent.source === 'orchestra'
      ? !agent.compatible_harnesses || agent.compatible_harnesses.some(id => id.toLowerCase() === target)
      : !agent.harness || agent.harness.toLowerCase() === target
    if (!compatible || !agent.name.toLowerCase().includes(needle)) return false
    seen.add(agent.name)
    return true
  }).sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)) || a.name.localeCompare(b.name)).slice(0, 8)
}
