/** Remembers the last model/effort chosen under each agent, per backend. */
export type AgentModelChoice = { model: string; effort: string }

const prefix = 'orchestra.agent-model-memory.v1:'

function read(baseUrl: string): Record<string, AgentModelChoice> {
  try {
    const raw = localStorage.getItem(prefix + baseUrl)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, AgentModelChoice> : {}
  } catch { return {} }
}

export function readAgentModelChoice(baseUrl: string, agentId: string): AgentModelChoice | undefined {
  const choice = read(baseUrl)[agentId]
  return choice && typeof choice.model === 'string' ? { model: choice.model, effort: typeof choice.effort === 'string' ? choice.effort : '' } : undefined
}

export function writeAgentModelChoice(baseUrl: string, agentId: string, choice: AgentModelChoice) {
  try {
    const all = read(baseUrl)
    if (all[agentId]?.model === choice.model && all[agentId]?.effort === choice.effort) return
    localStorage.setItem(prefix + baseUrl, JSON.stringify({ ...all, [agentId]: choice }))
  } catch { /* storage unavailable: memory is best-effort */ }
}
