import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Pencil, RotateCcw } from 'lucide-react'
import { HarnessIcon } from '@ui/HarnessIcon'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'
import type { WorkspaceChatMessage } from '@core/api/client'
import { harnessDisplayName, type AgentObservation } from '@features/agents/lib/agent-display'
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
const URL_PATTERN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

/** Plain text with bare URLs turned into links. */
function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN)
  if (parts.length === 1) return <>{text}</>
  return <>{parts.map((part, index) => index % 2 === 1
    ? <a key={index} href={part} target="_blank" rel="noreferrer" className="break-all underline decoration-foreground/25 underline-offset-[3px] transition-colors hover:decoration-foreground/70">{part}</a>
    : part)}</>
}

function messageTime(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
}

/** Edit, regenerate and version switching; one object so the memo compares it cheaply. */
export type ChatMessageRewind = {
  /** Set while rewinding is unavailable; the actions are disabled with this as their title. */
  disabledReason?: string
  onEdit: (message: WorkspaceChatMessage, text: string) => void
  onRegenerate: (message: WorkspaceChatMessage) => void
  onSwitchVersion: (branchId: string) => void
}

const ACTION_BUTTON = 'rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40'

/** In-place editor for a sent message: Enter sends, Shift+Enter is a newline, Escape cancels. */
function MessageEditor({ initial, disabledReason, onSubmit, onCancel }: { initial: string; disabledReason?: string; onSubmit: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(320, input.scrollHeight)}px` }
  }, [value])
  const text = value.trim()
  const canSend = !!text && text !== initial.trim() && !disabledReason
  const submit = () => { if (canSend) onSubmit(text) }
  return (
    <div className="w-full rounded-[20px] rounded-br-md bg-foreground/[0.07] px-4 pb-2 pt-2.5">
      <textarea ref={ref} autoFocus aria-label="Edit message" value={value} rows={1}
        onFocus={e => { const end = e.currentTarget.value.length; e.currentTarget.setSelectionRange(end, end) }}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }}
        className="block max-h-80 w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground outline-none" />
      <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[12px]">
        <button type="button" onClick={onCancel} className="rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Cancel</button>
        <button type="button" onClick={submit} disabled={!canSend} title={disabledReason}
          className="rounded-md bg-foreground/90 px-2.5 py-1 font-medium text-background transition-opacity hover:bg-foreground disabled:opacity-30">Send</button>
      </div>
    </div>
  )
}

/** `‹ 1 / 2 ›` between the versions of an edited message. */
function VersionSwitcher({ versions, rewind }: { versions: NonNullable<WorkspaceChatMessage['versions']>; rewind: ChatMessageRewind }) {
  const index = Math.max(0, versions.findIndex(version => version.active))
  const blocked = !!rewind.disabledReason
  const step = (offset: number, label: string) => {
    const target = versions[index + offset]
    return (
      <button type="button" aria-label={label} title={rewind.disabledReason || label} disabled={!target || blocked}
        onClick={() => { if (target) rewind.onSwitchVersion(target.branch_id) }}
        className="rounded p-0.5 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35">
        {offset < 0 ? <ChevronLeft className="size-3" /> : <ChevronRight className="size-3" />}
      </button>
    )
  }
  return (
    <div role="group" aria-label={`Message version ${index + 1} of ${versions.length}`} className="flex items-center tabular-nums text-muted-foreground/70">
      {step(-1, 'Previous version')}
      <span className="px-0.5">{index + 1} / {versions.length}</span>
      {step(1, 'Next version')}
    </div>
  )
}

function UserMessage({ message, images, text, rewind }: { message: WorkspaceChatMessage; images: { name: string; url: string }[]; text: string; rewind?: ChatMessageRewind }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const long = text.length > 700 || text.split('\n').length > 10
  const time = messageTime(message.created_at)
  const problem = message.status === 'failed' || message.status === 'cancelled'
  const copy = async () => {
    try { await navigator.clipboard.writeText(message.text); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch { /* clipboard unavailable */ }
  }
  // Only the text is editable; attached images go along unchanged. The editor
  // stays open with the text until the edit lands (the edited message then
  // replaces this one); Cancel or a failure in the dialog keeps the text here.
  const submitEdit = (edited: string) => {
    if (!rewind) return
    const imageMarkdown = images.map(image => `![${image.name}](${image.url})`).join('\n\n')
    rewind.onEdit(message, imageMarkdown ? `${edited}\n\n${imageMarkdown}` : edited)
  }
  const editButton = useRef<HTMLButtonElement>(null)
  const refocusEdit = useRef(false)
  const cancelEdit = () => { refocusEdit.current = true; setEditing(false) }
  useEffect(() => {
    if (editing || !refocusEdit.current) return
    refocusEdit.current = false
    editButton.current?.focus()
  }, [editing])
  const versions = rewind && message.versions && message.versions.length > 1 ? message.versions : undefined
  return (
    <article data-chat-message="user" aria-label="Your message" className={`group/message ml-auto flex min-w-0 flex-col items-end gap-1.5 ${editing ? 'w-full max-w-[92%]' : 'max-w-[82%]'}`}>
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {images.map((img, idx) => (
            <img key={`${img.name}-${idx}`} src={img.url} alt={img.name} loading="lazy" title={img.name !== 'Image' ? img.name : undefined}
              className="max-h-64 max-w-full rounded-2xl object-contain shadow-sm shadow-black/10" />
          ))}
        </div>
      )}
      {editing && rewind ? (
        <MessageEditor initial={text} disabledReason={rewind.disabledReason} onSubmit={submitEdit} onCancel={cancelEdit} />
      ) : text && (
        <div className={`relative rounded-[20px] rounded-br-md px-4 py-2.5 text-[14px] leading-relaxed text-foreground ${problem ? 'bg-destructive/10' : 'bg-foreground/[0.07]'}`}>
          <p className={`whitespace-pre-wrap break-words ${long && !expanded ? 'line-clamp-[10]' : ''}`}><LinkifiedText text={text} /></p>
          {long && (
            <button type="button" onClick={() => setExpanded(value => !value)} className="mt-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
      <div className="flex h-4 items-center gap-2 pr-1 text-[10.5px] text-muted-foreground/60">
        <div className="flex items-center gap-2 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 group-focus-within/message:opacity-100">
          {problem && <span className="text-destructive opacity-100">Not delivered</span>}
          {time && <time dateTime={message.created_at}>{time}</time>}
          {rewind && !editing && (
            <button ref={editButton} type="button" onClick={() => setEditing(true)} disabled={!!rewind.disabledReason} aria-label="Edit message"
              title={rewind.disabledReason || 'Edit message'} className={ACTION_BUTTON}>
              <Pencil className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            aria-label="Copy message"
            title={copied ? 'Copied' : 'Copy message'}
            className={ACTION_BUTTON}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </div>
        {versions && rewind && <VersionSwitcher versions={versions} rewind={rewind} />}
      </div>
    </article>
  )
}

function ChatMessageView({
  message,
  provider,
  projectId,
  htmlRenders = NO_RENDERS,
  onRegenerateVariant,
  onImplementVariant,
  variantActionsDisabled = false,
  agent,
  agentObservation,
  rewind,
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
  /** Edit (your messages), Regenerate (replies) and version switching; absent hides them. */
  rewind?: ChatMessageRewind
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

  if (user && userPayload) return <UserMessage message={message} images={userPayload.images} text={userPayload.cleanedText || (userPayload.images.length ? '' : message.text)} rewind={rewind} />

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
        <span className={!user ? 'text-foreground/80' : ''}>
          {user ? 'You' : message.role === 'system' ? 'Session' : harnessDisplayName(provider)}
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
          {rewind && message.role === 'assistant' && (
            <button type="button" aria-label="Regenerate response" onClick={() => rewind.onRegenerate(message)} disabled={!!rewind.disabledReason}
              title={rewind.disabledReason || 'Regenerate response'} className={ACTION_BUTTON}>
              <RotateCcw className="size-3.5" />
            </button>
          )}
          <button
            aria-label="Copy response"
            onClick={() => void copy()}
            title={copyState === 'copied' ? 'Copied' : 'Copy response'}
            className={ACTION_BUTTON}
          >
            {copyState === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      )}
    </article>
  )
}

type ChatMessageProps = Parameters<typeof ChatMessageView>[0]
const sameRewind = (a?: ChatMessageRewind, b?: ChatMessageRewind) => a === b || (!!a && !!b
  && a.disabledReason === b.disabledReason && a.onEdit === b.onEdit && a.onRegenerate === b.onRegenerate && a.onSwitchVersion === b.onSwitchVersion)
/** Messages re-render only when their content or display inputs change, not on every timeline update. */
export const ChatMessage = memo(ChatMessageView, (a: ChatMessageProps, b: ChatMessageProps) =>
  a.message === b.message && a.provider === b.provider && a.projectId === b.projectId
  && sameRewind(a.rewind, b.rewind)
  && a.variantActionsDisabled === b.variantActionsDisabled
  && a.onRegenerateVariant === b.onRegenerateVariant && a.onImplementVariant === b.onImplementVariant
  && (a.htmlRenders ?? NO_RENDERS).length === (b.htmlRenders ?? NO_RENDERS).length
  && (a.htmlRenders ?? NO_RENDERS).every((render, i) => render === (b.htmlRenders ?? NO_RENDERS)[i] || JSON.stringify(render) === JSON.stringify((b.htmlRenders ?? NO_RENDERS)[i]))
  && a.agent?.name === b.agent?.name && a.agent?.color === b.agent?.color
  && a.agentObservation?.kind === b.agentObservation?.kind && a.agentObservation?.detail === b.agentObservation?.detail)
