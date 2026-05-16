import { createContext, use, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react'
import type { BackendConfig } from '@core/api/client'
import type { EmbeddedAgentContextValue } from './lib/types'
import { useProviderConfig } from './hooks/use-provider-config'
import { useEmbeddedChat } from './hooks/use-embedded-chat'
import { useWatchMode } from './hooks/use-watch-mode'
import { useScheduler } from './hooks/use-scheduler'
import { useContextSuggestions } from './hooks/use-context-suggestions'
import { createOrchestraTools } from './tools/orchestra-tools'
import { createNavigationTools } from './tools/navigation-tools'
import { createGitTools } from './tools/git-tools'
import { createSessionTools } from './tools/session-tools'
import { createSearchTools } from './tools/search-tools'
import { createCodeExecutionTools } from './tools/code-execution-tools'
import { createSchedulerTools } from './tools/scheduler-tools'
import { createMCPBridgeTools } from './tools/mcp-bridge-tools'
import { createMetaTools } from './tools/meta-tools'

const EmbeddedAgentContext = createContext<EmbeddedAgentContextValue | null>(null)

interface EmbeddedAgentProviderProps {
  config: BackendConfig | null
  onNavigate: (section: string, id?: string) => void
  activeSection?: string
  selectedProjectId?: string
  children: ReactNode
}

 
export function EmbeddedAgentProvider({ config, onNavigate, activeSection, selectedProjectId, children }: EmbeddedAgentProviderProps) {
  const { providerConfig, setProviderConfig, updateProvider, availableKeys, refetchKeys } = useProviderConfig(config)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const sendMessageRef = useRef<((text: string) => Promise<void>) | null>(null)

  // Tier 3: Watch mode
  const watchMode = useWatchMode(config, isPanelOpen)

  // Tier 3: Scheduler
  const scheduler = useScheduler(
    // onReminder: inject as a system message into chat
    useCallback((message: string) => {
      void sendMessageRef.current?.(`[Reminder] ${message}`)
    }, []),
    // onAction: trigger tool execution via chat
    useCallback((toolName: string, args: Record<string, unknown>) => {
      void sendMessageRef.current?.(`Run the ${toolName} tool with these parameters: ${JSON.stringify(args)}`)
    }, []),
  )

  // Tier 3: Context-aware suggestions
  const contextSuggestions = useContextSuggestions(config, activeSection || '', undefined, selectedProjectId, isPanelOpen)

  const tools = useMemo(() => {
    const orchestraTools = config ? createOrchestraTools(config) : {}
    const navigationTools = createNavigationTools(onNavigate)
    const gitTools = config ? createGitTools(config) : {}
    const sessionTools = config ? createSessionTools(config) : {}
    const searchTools = config ? createSearchTools(config) : {}
    const codeExecutionTools = config ? createCodeExecutionTools(config) : {}
    const schedulerTools = createSchedulerTools(scheduler)
    const mcpBridgeTools = config ? createMCPBridgeTools(config) : {}
    const domainTools = {
      ...orchestraTools,
      ...navigationTools,
      ...gitTools,
      ...sessionTools,
      ...searchTools,
      ...codeExecutionTools,
      ...schedulerTools,
      ...mcpBridgeTools,
    }
    const metaTools = createMetaTools(domainTools)
    return { ...domainTools, ...metaTools }
  }, [config, onNavigate, scheduler])

  const { messages, sendMessage, isStreaming, stop, clearChat } = useEmbeddedChat(providerConfig, tools)

  // Keep ref updated so scheduler callbacks can access latest sendMessage
  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  // Listen for grab-to-agent events from the browser pane
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.text && sendMessage) {
        sendMessage(detail.text)
      }
    }
    window.addEventListener('orchestra-grab-to-agent', handler)
    return () => window.removeEventListener('orchestra-grab-to-agent', handler)
  }, [sendMessage])

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => {
      if (!prev) refetchKeys() // re-fetch keys when opening panel
      return !prev
    })
  }, [refetchKeys])

  // Eagerly preload Whisper STT model when panel opens
  useEffect(() => {
    if (isPanelOpen && config) {
      import('@/workers/whisper-client').then(({ setWhisperBackendConfig, getWhisperClient }) => {
        setWhisperBackendConfig(config)
        getWhisperClient() // triggers preload on first call
      }).catch(() => {
        // Whisper preload is best-effort — ignore failures
      })
    }
  }, [isPanelOpen, config])

  // Destructure stable references to avoid busting useMemo on every render
  const {
    enabled: watchEnabled, toggle: watchToggle, notifications: watchNotifications,
    unreadCount: watchUnread, dismiss: watchDismiss, dismissAll: watchDismissAll,
  } = watchMode
  const { activeItems: schedActiveItems, cancel: schedCancel } = scheduler
  const {
    suggestions: ctxSuggestions, enabled: ctxEnabled,
    toggle: ctxToggle, dismiss: ctxDismiss,
  } = contextSuggestions

  const value = useMemo<EmbeddedAgentContextValue>(
    () => ({
      messages,
      isStreaming,
      sendMessage,
      stop,
      clearChat,
      providerConfig,
      setProviderConfig,
      availableKeys,
      updateProvider,
      isPanelOpen,
      togglePanel,
      watchMode: {
        enabled: watchEnabled,
        toggle: watchToggle,
        notifications: watchNotifications,
        unreadCount: watchUnread,
        dismiss: watchDismiss,
        dismissAll: watchDismissAll,
      },
      scheduler: {
        activeItems: schedActiveItems,
        cancel: schedCancel,
      },
      contextSuggestions: {
        suggestions: ctxSuggestions,
        enabled: ctxEnabled,
        toggle: ctxToggle,
        dismiss: ctxDismiss,
      },
      onNavigate,
    }),
    [
      messages, isStreaming, sendMessage, stop, clearChat,
      providerConfig, setProviderConfig, availableKeys, updateProvider,
      isPanelOpen, togglePanel,
      watchEnabled, watchToggle, watchNotifications, watchUnread, watchDismiss, watchDismissAll,
      schedActiveItems, schedCancel,
      ctxSuggestions, ctxEnabled, ctxToggle, ctxDismiss,
      onNavigate,
    ],
  )

  return (
    <EmbeddedAgentContext.Provider value={value}>
      {children}
    </EmbeddedAgentContext.Provider>
  )
}

 
export function useEmbeddedAgent(): EmbeddedAgentContextValue {
  const ctx = use(EmbeddedAgentContext)
  if (!ctx) {
    throw new Error('useEmbeddedAgent must be used within EmbeddedAgentProvider')
  }
  return ctx
}
