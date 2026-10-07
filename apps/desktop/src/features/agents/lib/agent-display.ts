import type { HarnessCapabilities } from '@core/api/client'

/** Human label for an agent id like "orchestra:global:orchestra:reviewer" or "review/security". */
export function agentDisplayName(id: string): string {
  const last = id.split(':').filter(Boolean).at(-1) ?? id
  return last.split('/').filter(Boolean).at(-1) ?? last
}

const PALETTE = ['#60a5fa', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#a3e635']
const CSS_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i

/** The agent's own color when it is a plain CSS color, otherwise a stable palette color. */
export function agentColor(color: string | undefined, key: string): string {
  if (color && CSS_COLOR.test(color.trim())) return color.trim()
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export type AgentObservation = { kind: 'applied' | 'applied_partial' | 'not_applied' | 'unknown'; detail: string }

/** Parses `applied | applied_partial:<what> | not_applied:<why>`. */
export function parseAgentObservation(value?: string): AgentObservation | undefined {
  if (!value) return undefined
  const index = value.indexOf(':')
  const head = (index < 0 ? value : value.slice(0, index)).trim()
  const detail = index < 0 ? '' : value.slice(index + 1).trim()
  if (head === 'applied' || head === 'applied_partial' || head === 'not_applied') return { kind: head, detail }
  return { kind: 'unknown', detail: value }
}

export const isPrimaryMode = (mode?: string) => !mode || mode === 'primary' || mode === 'all' || mode === 'agent'
export const isSubagentMode = (mode?: string) => mode === 'subagent' || mode === 'all'

const HARNESS_LABELS: Record<string, string> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', antigravity: 'Antigravity', '8gent': '8gent' }
export const harnessLabel = (id: string) => HARNESS_LABELS[id.toLowerCase()] ?? id

export function findCapabilities(list: HarnessCapabilities[] | undefined, harness: string): HarnessCapabilities | undefined {
  return list?.find(item => item.harness?.toLowerCase() === harness.toLowerCase())
}

/** "Applied on <harness> via <mechanism>" for the mechanism that applies this kind of agent. */
export function capabilityHint(caps: HarnessCapabilities | undefined, harness: string, source?: string): string | undefined {
  if (!caps) return undefined
  const flag = source === 'orchestra' ? caps.agent_inline ?? caps.agent_select : caps.agent_select ?? caps.agent_inline
  if (!flag?.supported || !flag.mechanism) return undefined
  return `Applied on ${harnessLabel(harness)} via ${flag.mechanism}${flag.note ? ` (${flag.note})` : ''}`
}

export type CompatibilityRow = { harness: string; status: 'full' | 'partial' | 'unavailable'; mechanism?: string; missing: string[]; note?: string }

/** Which harnesses could apply an Orchestra agent with these settings, and what each would drop. */
export function compatibilityPreview(list: HarnessCapabilities[], agent: { skills?: string[]; mcp_servers?: string[]; model?: string; effort?: string; permissions?: Record<string, string | undefined> }): CompatibilityRow[] {
  return list.filter(caps => caps.harness && caps.harness.toLowerCase() !== 'gemini').map(caps => {
    const inline = caps.agent_inline
    if (!inline?.supported) return { harness: caps.harness, status: 'unavailable', missing: [], note: inline?.note || 'Orchestra agents are not supported' }
    const missing: string[] = []
    if (agent.skills?.length && !caps.skills?.supported) missing.push('skills')
    if (agent.mcp_servers?.length && !caps.mcp?.supported) missing.push('MCP')
    if (agent.model && !caps.model?.supported) missing.push('model')
    if (agent.effort && !caps.effort?.supported) missing.push('effort')
    if (Object.values(agent.permissions ?? {}).some(Boolean) && !caps.permissions?.supported) missing.push('permissions')
    return { harness: caps.harness, status: missing.length ? 'partial' : 'full', mechanism: inline.mechanism, missing, note: inline.note }
  })
}
