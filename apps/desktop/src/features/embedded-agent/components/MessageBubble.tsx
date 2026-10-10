import type { ChatMessage } from '../lib/types'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'
import { ToolFeedback } from './ToolFeedback'
import { JsonRenderBlock } from './JsonRenderBlock'

interface MessageBubbleProps {
  message: ChatMessage
  onAction: (action: string, params: Record<string, unknown>) => void
  isStreaming?: boolean
}

export function MessageBubble({ message, onAction, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  // Don't render an empty assistant bubble while waiting for content
  const hasContent = !!message.content
  const hasTools = !!(message.toolCalls && message.toolCalls.length > 0)
  const hasRender = !!message.jsonRenderSpec

  if (!isUser && !hasContent && !hasTools && !hasRender) {
    return null
  }

  // If assistant has only tool calls (no text or render yet), show tools without bubble styling
  const toolsOnly = !isUser && !hasContent && !hasRender && hasTools

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`text-[13px] leading-relaxed ${
          isUser
            ? 'max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-primary-foreground shadow-sm shadow-primary/10'
            : toolsOnly
              ? 'w-full overflow-hidden'
              : 'w-full rounded-2xl rounded-tl-md border border-border/20 bg-muted/15 px-3.5 py-2.5 overflow-hidden'
        }`}
      >
        {/* Tool feedback (before text for assistant) */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2">
            <ToolFeedback
              toolCalls={message.toolCalls}
              toolResults={message.toolResults ?? []}
              isStreaming={isStreaming}
            />
          </div>
        )}

        {/* json-render rich UI */}
        {!isUser && message.jsonRenderSpec && (
          <div className="mb-2">
            <JsonRenderBlock
              spec={message.jsonRenderSpec}
              onAction={(action, params) => onAction(action, params ?? {})}
            />
          </div>
        )}

        {/* Text content */}
        {message.content && (
          isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <div className="agent-markdown break-words">
              <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
            </div>
          )
        )}
      </div>
    </div>
  )
}
