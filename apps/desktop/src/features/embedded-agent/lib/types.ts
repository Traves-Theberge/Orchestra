export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: Date
  toolCalls?: ToolCallInfo[]
  toolResults?: ToolResultInfo[]
  jsonRenderSpec?: JsonRenderSpec | null
}

export type ToolCallInfo = {
  toolName: string
  args: Record<string, unknown>
  stepIndex?: number
}

export type ToolResultInfo = {
  toolName: string
  result: unknown
  isError?: boolean
  stepIndex?: number
}

export type JsonRenderSpec = {
  root: string
  elements: Record<string, {
    type: string
    props: Record<string, unknown>
    children?: string[]
  }>
}

export type ChatProviderConfig = {
  providerId: 'openrouter' | 'claude' | 'openai' | 'gemini'
  modelId: string
  apiKey: string
}

type WatchModeState = {
  enabled: boolean
  toggle: () => void
  notifications: { id: string; type: 'completion' | 'failure' | 'retry' | 'stall' | 'info'; title: string; message: string; timestamp: Date; dismissed: boolean; issueIdentifier?: string; actions?: { label: string; action: string; params?: Record<string, unknown> }[] }[]
  unreadCount: number
  dismiss: (id: string) => void
  dismissAll: () => void
}

type SchedulerState = {
  activeItems: { id: string; type: 'reminder' | 'action'; message?: string; toolName?: string; firesAt: Date; delayMinutes: number; createdAt: Date; fired: boolean; cancelled: boolean }[]
  cancel: (id: string) => void
}

type SuggestionsState = {
  suggestions: { id: string; text: string; action: string; params?: Record<string, unknown>; dismissed: boolean }[]
  enabled: boolean
  toggle: () => void
  dismiss: (id: string) => void
}

export type EmbeddedAgentContextValue = {
  messages: ChatMessage[]
  isStreaming: boolean
  sendMessage: (text: string) => Promise<void>
  stop: () => void
  clearChat: () => void
  providerConfig: ChatProviderConfig
  setProviderConfig: (config: ChatProviderConfig) => void
  availableKeys: Record<string, string>
  updateProvider: (providerId: ChatProviderConfig['providerId'], modelId?: string) => void
  isPanelOpen: boolean
  togglePanel: () => void
  watchMode: WatchModeState
  scheduler: SchedulerState
  contextSuggestions: SuggestionsState
  onNavigate?: (section: string, id?: string) => void
}

export const CHAT_PROVIDERS = [
  { id: 'openrouter' as const, label: 'OpenRouter' },
  { id: 'claude' as const, label: 'Anthropic' },
  { id: 'openai' as const, label: 'OpenAI' },
  { id: 'gemini' as const, label: 'Google' },
] as const
