import type { BackendConfig } from '@core/api/client'
import type { AgentSelection } from '@core/api/agent-catalog'

export type ChatDraftReceipt = {
  version: 1
  sessionId: string
  provider: string
  drafts: Record<string, string>
  title?: string
  creation: { sessionId: string; provider: string; title?: string; agent?: AgentSelection } | null
  agents?: Record<string, AgentSelection | null>
  submission: { sessionId: string; messageId: string; text: string } | null
  reply: { sessionId: string; requestId: string } | null
  blockedRequests: Record<string, boolean>
  uncertainSession: string
}

// Only the digest is used in storage. Credentials remain in renderer memory.
export async function chatDraftStorageKey(config: BackendConfig, projectId: string) {
  const identity = [config.baseUrl, config.apiToken, projectId]
  if (config.workspaceId) identity.push(config.workspaceId)
  const bytes = new TextEncoder().encode(JSON.stringify(identity))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `orchestra:chat-draft:v1:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`
}

function isDesktop() { return typeof window !== 'undefined' && !!window.orchestraDesktop }

function decodeReceipt(serialized: string | null): ChatDraftReceipt | null {
  try {
    const raw: unknown = JSON.parse(serialized ?? 'null')
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Partial<ChatDraftReceipt>
    const strings = (v: unknown): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(s => typeof s === 'string')
    const identity = (v: unknown, fields: string[]) => v === null || (!!v && typeof v === 'object' && fields.every(f => typeof (v as Record<string, unknown>)[f] === 'string' && (v as Record<string, unknown>)[f] !== ''))
    const agent = (v: unknown) => v === null || (!!v && typeof v === 'object' && ['agent_id', 'agent_scope', 'agent_content_hash', 'agent_format'].every(f => typeof (v as Record<string, unknown>)[f] === 'string') && ['project', 'global'].includes((v as AgentSelection).agent_scope))
    if (value.version !== 1 || typeof value.sessionId !== 'string' || typeof value.provider !== 'string' || !strings(value.drafts)
      || (value.title !== undefined && typeof value.title !== 'string')
      || !identity(value.creation, ['sessionId', 'provider']) || !identity(value.submission, ['sessionId', 'messageId', 'text'])
      || (value.creation?.title !== undefined && typeof value.creation.title !== 'string')
      || (value.creation?.agent !== undefined && !agent(value.creation.agent))
      || (value.agents !== undefined && (!value.agents || Array.isArray(value.agents) || typeof value.agents !== 'object' || !Object.values(value.agents).every(agent)))
      || !identity(value.reply, ['sessionId', 'requestId']) || typeof value.uncertainSession !== 'string'
      || !value.blockedRequests || typeof value.blockedRequests !== 'object' || !Object.values(value.blockedRequests).every(v => typeof v === 'boolean')) return null
    return value as ChatDraftReceipt
  } catch { return null }
}

export function readChatDraftReceipt(key: string): ChatDraftReceipt | null {
  if (!isDesktop()) {
    try { return decodeReceipt(sessionStorage.getItem(key)) } catch { return null }
  }
  // The tab receipt is the current renderer's pre-migration draft. Only remove
  // it after the profile write succeeds; failed migration must not lose it.
  let previous: ChatDraftReceipt | null = null
  try { previous = decodeReceipt(sessionStorage.getItem(key)) } catch { /* Profile storage may still be available. */ }
  if (previous) { writeChatDraftReceipt(key, previous); return previous }
  try { return decodeReceipt(localStorage.getItem(key)) } catch { return null }
}

export function writeChatDraftReceipt(key: string, value: ChatDraftReceipt) {
  try {
    const drafts = Object.fromEntries(Object.entries(value.drafts).filter(([, text]) => text !== ''))
    const storage = isDesktop() ? localStorage : sessionStorage
    storage.setItem(key, JSON.stringify({ ...value, drafts }))
    if (isDesktop()) {
      // A stale tab receipt must not supersede newer profile state on restart.
      try { sessionStorage.removeItem(key) } catch { /* The durable write already succeeded. */ }
    }
    return true
  } catch { return false }
}
