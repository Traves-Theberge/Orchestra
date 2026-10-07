import type { AgentCatalog, AgentCatalogItem, AgentSelection } from '@core/api/agent-catalog'

export const agentIdOf = (item: AgentCatalogItem) => item.agent_id || item.id

/** Whether the target harness can apply this agent as the primary mode. */
export function isAgentSelectable(item: AgentCatalogItem, catalog?: AgentCatalog): boolean {
  if (item.scope === 'builtin' || !agentIdOf(item)) return false
  if (typeof item.selectable === 'boolean') return item.selectable
  return item.selectable_as_primary && catalog?.selection_capability === 'selectable_primary'
}

export function toAgentSelection(item: AgentCatalogItem): AgentSelection {
  return { agent_id: agentIdOf(item), agent_scope: item.scope as AgentSelection['agent_scope'], agent_content_hash: item.content_hash, agent_format: item.format }
}
