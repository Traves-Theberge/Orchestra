import { useRef, useEffect } from 'react'
import { Settings2 } from 'lucide-react'
import type { ChatMessage } from '../lib/types'
import { MessageBubble } from './MessageBubble'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  onAction: (action: string, params: Record<string, unknown>) => void
  hasApiKey: boolean
  onOpenSettings?: () => void
}

export function MessageList({ messages, isStreaming, onAction, hasApiKey, onOpenSettings }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isStreaming])

  const suggestions = ['What tasks are running?', 'Create a new task', 'Go to analytics']

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-between p-5">
        {/* Top */}
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
          <p className="text-3xl font-black tracking-tight bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent">Maestro</p>
          {hasApiKey ? (
            <p className="text-xs text-foreground/50 max-w-[260px]">
              Ask me to create tasks, check running agents, navigate the app, or anything else.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-foreground/50 max-w-[260px]">
                Add an API key in Settings to get started.
              </p>
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Settings2 className="size-3" />
                  Open Settings
                </button>
              )}
            </div>
          )}
        </div>

        {/* Bottom: suggestions */}
        {hasApiKey && (
          <div className="flex flex-wrap gap-1.5 pt-4">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onAction('send_chat', { message: s })}
                className="rounded-full border border-border/20 bg-muted/10 px-3 py-1 text-[10px] text-foreground/60 transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex-1 space-y-2 p-3">
        {messages.map((msg, i) => (
          <div key={msg.id} className="agent-message-enter">
            <MessageBubble
              message={msg}
              onAction={onAction}
              isStreaming={isStreaming && i === messages.length - 1}
            />
          </div>
        ))}

        {isStreaming && (
          <div className="agent-message-enter flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-border/20 bg-muted/20 px-4 py-2.5">
              <span className="agent-typing-dot size-1.5 rounded-full bg-primary/60" style={{ animationDelay: '0ms' }} />
              <span className="agent-typing-dot size-1.5 rounded-full bg-primary/60" style={{ animationDelay: '200ms' }} />
              <span className="agent-typing-dot size-1.5 rounded-full bg-primary/60" style={{ animationDelay: '400ms' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
