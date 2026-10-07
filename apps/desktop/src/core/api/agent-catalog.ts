import { requestJSON } from './client'
import type { BackendConfig } from './types'

export type AgentResourceKind = 'agent_definition' | 'skill' | 'orchestra_config'
export type AgentResourceScope = 'project' | 'global'
export type AgentSelection = { agent_id: string; agent_scope: AgentResourceScope; agent_content_hash: string; agent_format: string }
export type AgentCatalogItem = {
  id: string; item_id?: string; agent_id?: string; kind: AgentResourceKind; harness: string; scope: AgentResourceScope | 'builtin'
  path: string; content_hash: string; format: string; display_name: string; description: string; mode: string
  selectable_as_primary: boolean; selection_status: string; reason?: string
  // Normalized Agent fields (agents-profiles spec); optional while backends roll out.
  name?: string; source?: 'harness' | 'orchestra'; compatible_harnesses?: string[]
  model?: string; effort?: string; color?: string; skills?: string[]; mcp_servers?: string[]
  permissions?: Partial<Record<'edit' | 'bash' | 'webfetch', 'allow' | 'ask' | 'deny'>>
  /** Computed for the requested ?harness; takes precedence over selectable_as_primary when present. */
  selectable?: boolean; unavailable_reason?: string
}
export type AgentCatalog = {
  project_id: string; workspace_id?: string; root: string; harness: string; scope: string; observation: string
  selection_capability: string; reason?: string; items: AgentCatalogItem[]
  capabilities?: { list: boolean; create: boolean; update: boolean; delete: boolean; select_primary: boolean }
}
export type AgentResource = AgentCatalogItem & { content: string }
export type AgentMutation = { request_id: string; expected_hash: string; content?: string; format?: string }
export type AgentMutationReceipt = { request_id: string; status: 'completed' | 'rejected' | 'unknown' | 'pending'; resource?: AgentCatalogItem; content_hash?: string; error?: string; message?: string }

function path(config: BackendConfig, projectId: string, harness: string, scope: string, extra?: Record<string, string>) {
  const query = new URLSearchParams({ harness, scope, ...extra })
  if (config.workspaceId) query.set('workspace_id', config.workspaceId)
  return `/api/v1/projects/${encodeURIComponent(projectId)}/agent-catalog${extra ? '/resource' : ''}?${query}`
}

export async function fetchAgentCatalog(config: BackendConfig, projectId: string, harness: string, scope = 'effective') {
  const result = await requestJSON<AgentCatalog>(config, path(config, projectId, harness, scope))
  if (result.project_id !== projectId || result.harness?.toLowerCase() !== harness.toLowerCase() || !Array.isArray(result.items) || (config.workspaceId && result.workspace_id !== config.workspaceId)) throw new Error('Agent catalog belongs to another harness or workspace.')
  return result
}
export async function fetchAgentResource(config: BackendConfig, projectId: string, harness: string, scope: AgentResourceScope, kind: AgentResourceKind, id: string) {
  const result = await requestJSON<AgentResource>(config, path(config, projectId, harness, scope, { kind, resource_id: id }))
  if (result.id !== id || result.kind !== kind || result.scope !== scope || result.harness?.toLowerCase() !== harness.toLowerCase() || typeof result.content !== 'string' || !result.content_hash) throw new Error('Agent resource identity or content could not be verified.')
  return result
}
export function mutateAgentResource(config: BackendConfig, projectId: string, harness: string, scope: AgentResourceScope, kind: AgentResourceKind, id: string, operation: 'create' | 'update' | 'delete', request: AgentMutation) {
  return requestJSON<AgentMutationReceipt>(config, path(config, projectId, harness, scope, { kind, resource_id: id }), { method: operation === 'create' ? 'POST' : operation === 'update' ? 'PUT' : 'DELETE', body: JSON.stringify(request), headers: { 'Content-Type': 'application/json' } })
}
export function fetchAgentMutationReceipt(config: BackendConfig, projectId: string, requestId: string) {
  return requestJSON<AgentMutationReceipt>(config, `/api/v1/projects/${encodeURIComponent(projectId)}/agent-catalog/receipts/${encodeURIComponent(requestId)}`)
}
