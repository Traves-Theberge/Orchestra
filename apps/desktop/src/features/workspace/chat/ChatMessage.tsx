import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy } from 'lucide-react'
import { HarnessIcon } from '@ui/HarnessIcon'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'
import type { WorkspaceChatMessage } from '@core/api/client'
import type { AgentObservation } from '@features/agents/lib/agent-display'
import {
  extractHtmlRendersFromContent,
  HtmlRenderVariants,
  type HtmlRenderReference,
} from './html-render'

const NO_RENDERS: HtmlRenderReference[] = []

function extractUserImages(text: string): { images: { name: string; url: string }[]; cleanedText: string } {
  const images: { name: string; url: string }[] = []
  const regex = /!\[([^\]]*)\]\((data:image\/[^)]+|https?:\/\/[^)]+)\)/g
  const cleaned = text.replace(regex, (_, alt, url) => {
    images.push({ name: alt || 'Image', url })
    return ''
  }).trim()
  return { images, cleanedText: cleaned }
}
export function ChatMessage({
  message,
  provider,
  projectId,
  htmlRenders = NO_RENDERS,
  onRegenerateVariant,
  onImplementVariant,
  variantActionsDisabled = false,
  agent,
  agentObservation,
}: {
  message: WorkspaceChatMessage
  provider: string
  projectId: string
  /** Pages this turn's html_render tool calls published; inline fences in the text are added after them. */
  htmlRenders?: readonly HtmlRenderReference[]
  onRegenerateVariant?: (index: number, render: HtmlRenderReference) => void
  onImplementVariant?: (index: number, render: HtmlRenderReference) => void
  variantActionsDisabled?: boolean
  /** Agent the turn ran under (assistant messages only). */
  agent?: { name: string; color: string }
  agentObservation?: AgentObservation
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const user = message.role === 'user'
  const userPayload = useMemo(() => {
    if (!user) return null
    return extractUserImages(message.text)
  }, [user, message.text])
  const assistantPayload = useMemo(() => {
    if (user) return null
    const inline = extractHtmlRendersFromContent(message.text)
    return { renders: [...htmlRenders, ...inline.renders], text: inline.cleanedText }
  }, [user, message.text, htmlRenders])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <article
      data-chat-message={message.role}
      className={`group/message min-w-0 ${
        user
          ? 'ml-auto max-w-[92%] rounded-2xl border border-border/30 bg-muted/40 px-4 py-3'
          : 'py-2'
      }`}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        {!user && message.role !== 'system' && <HarnessIcon id={provider} size={14} />}
        <span className={!user ? 'capitalize text-foreground/80' : ''}>
          {user ? 'You' : message.role === 'system' ? 'Session' : provider}
        </span>
        {!user && agent && (
          <span data-chat-agent className="flex min-w-0 items-center gap-1.5 text-foreground/70">
            <span aria-hidden="true" className="text-muted-foreground/50">·</span>
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />
            <span className="truncate">{agent.name}</span>
          </span>
        )}
        {!user && agentObservation && (agentObservation.kind === 'not_applied' || agentObservation.kind === 'applied_partial') && (
          <span role="note" title={agentObservation.detail || undefined} className="flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            {agentObservation.kind === 'not_applied' ? 'Agent not applied' : 'Agent partially applied'}{agentObservation.detail ? `: ${agentObservation.detail}` : ''}
          </span>
        )}
        {message.status !== 'completed' && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{message.status}</span>
        )}
      </div>

      {/* The turn's visualizations (tool results and inline fences) as selectable variants */}
      {assistantPayload && assistantPayload.renders.length > 0 && (
        <div className="mb-3">
          <HtmlRenderVariants
            renders={assistantPayload.renders}
            onRegenerate={onRegenerateVariant}
            onImplement={onImplementVariant}
            actionsDisabled={variantActionsDisabled}
          />
        </div>
      )}

      {user ? (
        <div className="space-y-2">
          {userPayload && userPayload.images.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-0.5">
              {userPayload.images.map((img, idx) => (
                <div
                  key={`${img.name}-${idx}`}
                  className="group/img relative overflow-hidden rounded-xl border border-border/50 bg-background/60 shadow-xs"
                >
                  <img
                    src={img.url}
                    alt={img.name}
                    className="max-h-72 max-w-full rounded-xl object-contain"
                    loading="lazy"
                  />
                  {img.name && img.name !== 'Image' && (
                    <div className="absolute bottom-1 left-1 max-w-[90%] truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white opacity-0 backdrop-blur-xs transition-opacity group-hover/img:opacity-100">
                      {img.name}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {userPayload && userPayload.cleanedText ? (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{userPayload.cleanedText}</p>
          ) : !userPayload?.images.length ? (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{message.text}</p>
          ) : null}
        </div>
      ) : assistantPayload?.text ? (
        <MarkdownRenderer
          content={assistantPayload.text}
          linkProjectId={projectId}
          enableMermaid={false}
          className="break-words text-[15px] leading-7 [&_p]:my-3 [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:border-none [&_pre]:bg-muted/30 [&_pre]:px-4 [&_pre]:py-5 [&_table]:block [&_table]:overflow-auto"
        />
      ) : null}

      {!user && (
        <div className="mt-2 flex items-center justify-end gap-2">
          {copyState === 'failed' && (
            <span role="status" className="text-[10px] text-muted-foreground">
              Could not copy response.
            </span>
          )}
          <button
            aria-label="Copy response"
            onClick={() => void copy()}
            title={copyState === 'copied' ? 'Copied' : 'Copy response'}
            className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copyState === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      )}
    </article>
  )
}
