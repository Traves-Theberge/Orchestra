import { useCallback } from 'react'
import { X, RefreshCcw, Settings2 } from 'lucide-react'
import { Button } from '@ui/button'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { useEmbeddedAgent } from './EmbeddedAgentProvider'
import { MessageList } from './components/MessageList'
import { ChatInput } from './components/ChatInput'
import { WatchNotifications, WatchToggle } from './components/WatchNotifications'
import { SchedulePanel } from './components/SchedulePanel'

export function EmbeddedAgentPanel({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const {
    messages,
    isStreaming,
    sendMessage,
    stop,
    clearChat,
    providerConfig,
    togglePanel,
    watchMode,
    scheduler,
  } = useEmbeddedAgent()

  const { onNavigate } = useEmbeddedAgent()

  const handleAction = useCallback(
    (action: string, params: Record<string, unknown>) => {
      if (action === 'send_chat' && typeof params.message === 'string') {
        void sendMessage(params.message)
      } else if (action === 'view_issue' && typeof params.identifier === 'string') {
        onNavigate?.('TASKS', params.identifier)
      } else if (action === 'review_diff' && typeof params.identifier === 'string') {
        onNavigate?.('TASKS', params.identifier)
      } else if (action === 'stop_session' && typeof params.identifier === 'string') {
        void sendMessage(`Stop the session for ${params.identifier}`)
      }
    },
    [sendMessage, onNavigate],
  )

  const modelLabel = providerConfig.modelId
    ? providerConfig.modelId.split('/').pop()?.replace(/-/g, ' ') ?? providerConfig.modelId
    : null

  return (
    <div
      className="agent-panel-enter fixed bottom-6 right-6 z-50 flex flex-col overflow-hidden rounded-xl border border-border/50 bg-background shadow-xl shadow-black/30"
      style={{ top: '140px', width: 'min(420px, calc(100vw - 48px))' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <div className="min-w-0 flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 shrink-0">Maestro</p>
          {modelLabel ? (
            <span className="text-[12px] font-medium text-foreground/70 truncate capitalize">{modelLabel}</span>
          ) : onOpenSettings ? (
            <button
              onClick={() => { togglePanel(); onOpenSettings() }}
              className="text-[12px] font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Configure API key
            </button>
          ) : (
            <span className="text-[12px] font-medium text-muted-foreground/60">No API key</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 -mt-1">
          <WatchToggle
            enabled={watchMode.enabled}
            onToggle={watchMode.toggle}
            unreadCount={watchMode.unreadCount}
          />
          {onOpenSettings && (
            <AppTooltip content="Agent settings">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { togglePanel(); onOpenSettings() }}
                className="size-7 p-0 text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04]"
              >
                <Settings2 className="size-3.5" />
              </Button>
            </AppTooltip>
          )}
          <AppTooltip content="New chat">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearChat}
              className="size-7 p-0 text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04]"
            >
              <RefreshCcw className="size-3.5" />
            </Button>
          </AppTooltip>
          <AppTooltip content="Close (Ctrl+.)">
            <Button
              variant="ghost"
              size="sm"
              onClick={togglePanel}
              className="size-7 p-0 text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04]"
            >
              <X className="size-3.5" />
            </Button>
          </AppTooltip>
        </div>
      </div>

      {/* Watch mode notifications */}
      {watchMode.enabled && watchMode.notifications.filter((n) => !n.dismissed).length > 0 && (
        <WatchNotifications
          enabled={watchMode.enabled}
          onToggle={watchMode.toggle}
          notifications={watchMode.notifications}
          onDismiss={watchMode.dismiss}
          onDismissAll={watchMode.dismissAll}
          onAction={handleAction}
        />
      )}

      {/* Scheduled items */}
      <SchedulePanel
        items={scheduler.activeItems}
        onCancel={scheduler.cancel}
      />

      {/* Body */}
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        onAction={handleAction}
        hasApiKey={!!providerConfig.apiKey}
        onOpenSettings={onOpenSettings ? () => { togglePanel(); onOpenSettings() } : undefined}
      />

      {/* Footer */}
      <ChatInput
        onSend={(text) => void sendMessage(text)}
        onStop={stop}
        isStreaming={isStreaming}
        disabled={!providerConfig.apiKey}
      />
    </div>
  )
}
