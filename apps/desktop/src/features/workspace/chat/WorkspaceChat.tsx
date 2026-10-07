import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, CheckCircle2, ChevronRight, Loader2, Paperclip, ShieldCheck, Sparkles, Square, SquarePen, Terminal, X } from 'lucide-react'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { HarnessIcon } from '@ui/HarnessIcon'
import { ChatMessage } from './ChatMessage'
import { useChatZoom } from './chat-zoom'
import { CHAT_SESSION_EVENT } from './MaestroConversations'
import { extractHtmlRendersFromEvents, type HtmlRenderReference } from './html-render'

const IMPLEMENT_REFERENCE_HTML_LIMIT = 24_000

function regenerateVariantPrompt(index: number, render: HtmlRenderReference): string {
  return `Regenerate Variant #${index + 1} ("${render.title}") as a fresh, improved take that keeps its direction. Publish it as an HTML render.`
}

function implementVariantPrompt(index: number, render: HtmlRenderReference): string {
  const request = `Implement Variant #${index + 1} ("${render.title}") in this project. Integrate it with the existing components, styles, and conventions rather than pasting the standalone HTML.`
  const html = render.html?.trim()
  if (!html || html.length > IMPLEMENT_REFERENCE_HTML_LIMIT) return request
  // The fence must be longer than any backtick run inside the page.
  const longestRun = Math.max(0, ...(html.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${request}\n\nReference HTML for the variant:\n\n${fence}html\n${html}\n${fence}`
}
import { MessageRail } from './MessageRail'
import { HarnessPicker } from './HarnessPicker'
import { AgentPicker } from './AgentPicker'
import { AgentMentionMenu } from './AgentMentions'
import { insertMention, mentionCandidates, mentionQuery, useAgentDirectory } from './agent-mentions'
import { readAgentModelChoice, writeAgentModelChoice } from './agent-model-memory'
import { agentColor, agentDisplayName, parseAgentObservation } from '@features/agents/lib/agent-display'
import { type AgentSelection } from '@core/api/agent-catalog'
import { useAppStore } from '@core/store'
import { chatDraftStorageKey, readChatDraftReceipt, writeChatDraftReceipt } from './chat-draft-storage'
import {
  createWorkspaceChatSession, renameWorkspaceChatSession, switchWorkspaceChatProvider, fetchWorkspaceChat, fetchWorkspaceChatProviders, fetchWorkspaceChatModels,
  listWorkspaceChatSessions, sendWorkspaceChatMessage, stopWorkspaceChatTurn, replyWorkspaceChatRequest,
  type BackendConfig, type WorkspaceChatProvider, type WorkspaceChatSession,
  type WorkspaceChatSnapshot, type WorkspaceChatRequest, type WorkspaceChatEvent, type WorkspaceChatModelCatalog,
} from '@core/api/client'

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const isWorking = (session?: WorkspaceChatSession) => session?.status === 'running' || session?.status === 'stopping'
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const textValue = (value: unknown) => typeof value === 'string' ? value : ''

export type ChatAttachment = {
  id: string
  name: string
  type: string
  size: number
  url: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
// Codex reasoning items carry summary/content as string arrays; tolerate the older { text } part shape.
function reasoningText(item: Record<string, unknown>): string {
  const parts = (value: unknown) => Array.isArray(value) ? value.map(part => typeof part === 'string' ? part : textValue(record(part).text)).filter(Boolean) : []
  const summary = parts(item.summary)
  return (summary.length ? summary : parts(item.content)).join('\n\n')
}
function AgentActivity({ events }: { events: WorkspaceChatEvent[] }) {
  const items = new Map<string, { label: string; text: string; status: string }>()
  const reasoningParts = new Map<string, Record<string, string>>()
  for (const event of events) {
    const payload = record(event.payload)
    const item = record(payload.item)
    const kind = textValue(item.type)
    const key = `${event.turn_id ?? ''}:${event.item_id || textValue(item.id) || event.sequence}`
    if (['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'reasoning'].includes(kind)) {
      const label = ({ commandExecution: 'Command', fileChange: 'File changes', mcpToolCall: 'Tool', webSearch: 'Search', reasoning: 'Reasoning' })[kind] ?? kind
      const detail = kind === 'commandExecution' ? [textValue(item.command), textValue(item.aggregatedOutput)].filter(Boolean).join('\n')
        : kind === 'fileChange' && Array.isArray(item.changes) ? item.changes.map(change => { const c = record(change); return [textValue(c.path), textValue(record(c.kind).type), textValue(c.diff)].filter(Boolean).join('\n') }).join('\n\n')
        : kind === 'reasoning' ? reasoningText(item)
        : kind === 'mcpToolCall' ? JSON.stringify(item, null, 2) : textValue(item.query) || textValue(item.text)
      if (kind === 'reasoning') {
        // The completed item is authoritative; streamed deltas fill in until then. Never show raw JSON for reasoning.
        const text = detail || items.get(key)?.text || ''
        if (text || event.type !== 'item/completed') items.set(key, { label, text, status: event.type === 'item/completed' ? 'completed' : 'running' })
        else items.delete(key)
        continue
      }
      items.set(key, { label, text: detail || JSON.stringify(item, null, 2), status: event.type === 'item/completed' ? 'completed' : 'running' })
    } else if (event.type === 'item/reasoning/summaryTextDelta' || event.type === 'item/reasoning/textDelta') {
      if (items.get(key)?.status === 'completed') continue
      const part = event.type === 'item/reasoning/summaryTextDelta' ? `s${Number(payload.summaryIndex ?? 0)}` : `c${Number(payload.contentIndex ?? 0)}`
      const parts = { ...reasoningParts.get(key) }
      parts[part] = (parts[part] ?? '') + (event.delta || textValue(payload.delta))
      reasoningParts.set(key, parts)
      // Prefer the summary stream; fall back to raw reasoning text when the model produced no summary.
      const ordered = (prefix: string) => Object.keys(parts).filter(k => k.startsWith(prefix)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map(k => parts[k])
      const summaries = ordered('s')
      items.set(key, { label: 'Reasoning', text: (summaries.length ? summaries : ordered('c')).filter(Boolean).join('\n\n'), status: 'running' })
    } else if (event.type === 'item/commandExecution/outputDelta' && items.has(key)) {
      const previous = items.get(key)!
      items.set(key, { ...previous, text: previous.text + (event.delta || textValue(payload.delta)) })
    } else if (event.type === 'orchestra/tool/started') {
      const operation = textValue(record(payload.arguments).operation)
      items.set(key, { label: 'Orchestra control', text: operation || textValue(payload.tool), status: 'running' })
    } else if (event.type === 'orchestra/tool/completed') {
      items.set(key, { label: 'Orchestra control', text: JSON.stringify(payload, null, 2), status: payload.success === false ? 'failed' : 'completed' })
    } else if (event.type === 'turn/plan/updated') {
      items.set(`plan:${event.turn_id}`, { label: 'Plan', text: textValue(payload.explanation) + '\n' + (Array.isArray(payload.plan) ? payload.plan.map(step => { const s = record(step); return `${textValue(s.status)}: ${textValue(s.step)}` }).join('\n') : ''), status: 'updated' })
    } else if (event.type === 'error') {
      items.set(key, { label: 'Provider error', text: textValue(record(payload.error).message) || textValue(payload.message) || JSON.stringify(payload), status: 'failed' })
    }
  }
  // Reasoning with no text yet is noise; show it once a summary arrives.
  for (const [key, item] of items) if (item.label === 'Reasoning' && !item.text.trim()) items.delete(key)
  if (!items.size) return null
  return <div aria-label="Agent activity" className="space-y-2">{[...items].map(([key, item]) => <details key={key} className="group/tool overflow-hidden rounded-xl border border-border/40 bg-muted/10 text-xs"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 font-medium"><ChevronRight className="size-3 text-muted-foreground transition-transform group-open/tool:rotate-90" />{item.label === 'Command' ? <Terminal className="size-3.5 text-muted-foreground" /> : <Sparkles className="size-3.5 text-muted-foreground" />}<span className="flex-1">{item.label}</span><span className="flex items-center gap-1 text-[10px] font-normal text-muted-foreground">{item.status === 'completed' && <CheckCircle2 className="size-3" />}{item.status === 'running' && <Loader2 className="size-3 animate-spin" />}{item.status}</span></summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border/30 bg-background/40 px-4 py-3 font-mono text-[11px] leading-5">{item.text}</pre></details>)}</div>
}

function HarnessDivider({ provider }: { provider: string }) {
  return <div role="separator" aria-label={`Switched to ${provider.toLowerCase()}`} className="mb-5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground/60"><span className="h-px flex-1 bg-border/60" /><HarnessIcon id={provider.toLowerCase()} size={12} /><span>Continued on {provider.charAt(0) + provider.slice(1).toLowerCase()}</span><span className="h-px flex-1 bg-border/60" /></div>
}

function AgentDivider({ name, color }: { name: string; color?: string }) {
  return <div role="separator" aria-label={`Switched to ${name}`} className="mb-5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground/60"><span className="h-px flex-1 bg-border/60" />{color ? <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: color }} /> : null}<span>Switched to {name}</span><span className="h-px flex-1 bg-border/60" /></div>
}

function StreamingAssistant({ events, projectId, provider }: { events: WorkspaceChatEvent[]; projectId: string; provider?: string }) {
  const completed = new Set(events.filter(e => e.type === 'turn/completed').map(e => e.turn_id))
  const items = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'item/agentMessage/delta' || completed.has(event.turn_id)) continue
    const key = `${event.turn_id}:${event.item_id}`
    items.set(key, (items.get(key) ?? '') + (event.delta ?? ''))
  }
  return <>{[...items].map(([id, text]) => <article key={id} className="py-2"><div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground"><HarnessIcon id={provider || 'agent'} size={14} /><span className="capitalize">{provider || 'Agent'}</span> · streaming</div><MarkdownRenderer content={text} enableMermaid={false} isStreaming={true} linkProjectId={projectId} className="break-words text-[13px] leading-7 [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:bg-muted/30" /></article>)}</>
}

function AgentWorkingStatus({
  status,
  provider,
  onInterrupt,
}: {
  status?: string
  provider?: string
  onInterrupt?: () => void
}) {
  const isStopping = status === 'stopping'
  const displayName = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'Agent'

  return (
    <div
      role="status"
      aria-label={isStopping ? 'Stopping current turn…' : `${displayName} turn in progress…`}
      className="my-2.5 flex items-center justify-between py-1 text-xs text-muted-foreground animate-in fade-in-0 duration-150 select-none"
    >
      <div className="flex items-center gap-2">
        <HarnessIcon id={provider || 'agent'} size={14} />
        <span className="font-medium text-foreground/80">
          {isStopping ? 'Stopping current turn…' : `${displayName} is thinking…`}
        </span>
        {!isStopping && (
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-primary/70 animate-pulse" />
            <span className="size-1.5 rounded-full bg-primary/70 animate-pulse [animation-delay:200ms]" />
            <span className="size-1.5 rounded-full bg-primary/70 animate-pulse [animation-delay:400ms]" />
          </span>
        )}
      </div>

      {!isStopping && onInterrupt && (
        <button
          type="button"
          onClick={onInterrupt}
          aria-label="Stop generation"
          title="Stop generation (Esc)"
          className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <span>Stop</span>
          <kbd className="font-mono text-[10px] text-muted-foreground/60">Esc</kbd>
        </button>
      )}
    </div>
  )
}

function AgentQuestion({ request, disabled, onReply }: { request: WorkspaceChatRequest; disabled: boolean; onReply: (answer: Record<string, unknown>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const questions = Array.isArray(request.params.questions) ? request.params.questions.map(record) : []
  const valid = questions.length > 0 && questions.every(q => textValue(q.id) && answers[textValue(q.id)]?.trim())
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-primary/30 p-4">
    <legend className="px-1 text-xs font-semibold">Agent needs your input</legend>
    {questions.map(q => {
      const id = textValue(q.id)
      return <div key={id}><label htmlFor={`question-${request.id}-${id}`} className="mb-2 block text-sm">{textValue(q.question) || textValue(q.header) || id}</label>
        {Array.isArray(q.options) && <div className="mb-2 flex flex-wrap gap-2">{q.options.map(record).map(option => <button type="button" key={textValue(option.label)} aria-pressed={answers[id] === textValue(option.label)} title={textValue(option.description)} onClick={() => setAnswers(previous => ({ ...previous, [id]: textValue(option.label) }))} className={`rounded-md border px-3 py-2 text-xs transition-colors ${answers[id] === textValue(option.label) ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border bg-background hover:bg-accent'}`}>{textValue(option.label)}</button>)}</div>}
        <input id={`question-${request.id}-${id}`} type={q.isSecret === true ? 'password' : 'text'} value={answers[id] ?? ''} onChange={e => setAnswers(previous => ({ ...previous, [id]: e.target.value }))} className="w-full rounded border border-border bg-background p-2 text-sm" />
      </div>
    })}
    {!questions.length && <p className="text-xs text-muted-foreground">This request has an unsupported question format. Interrupt the turn to recover.</p>}
    <button disabled={disabled || !valid} onClick={() => onReply({ answers: Object.fromEntries(questions.map(q => [textValue(q.id), { answers: [answers[textValue(q.id)]] }])) })} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-40">Submit answers</button>
  </fieldset>
}

function RuntimeRequestCard({ request, disabled, onReply }: { request: WorkspaceChatRequest; disabled: boolean; onReply: (answer: Record<string, unknown>) => void }) {
  if (request.method === 'item/tool/requestUserInput') return <AgentQuestion request={request} disabled={disabled} onReply={onReply} />
  if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(request.method)) return <p role="status" className="text-xs text-muted-foreground">Unsupported agent request: {request.method}</p>
  return <div role="group" aria-label="Agent approval" className="overflow-hidden rounded-xl border border-amber-500/25 bg-card shadow-sm"><div className="flex items-center gap-2 border-b border-border/30 px-4 py-3"><ShieldCheck className="size-4 text-amber-500" /><p className="text-xs font-semibold">{request.method.includes('fileChange') ? 'Allow file changes?' : 'Allow this command?'}</p><span className="ml-auto text-[10px] text-muted-foreground">Permission required</span></div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] leading-5">{textValue(request.params.command) || textValue(request.params.reason) || JSON.stringify(request.params, null, 2)}</pre><div className="flex justify-end gap-2 border-t border-border/30 px-4 py-2.5"><button disabled={disabled} onClick={() => onReply({ decision: 'decline' })} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40">Deny</button><button disabled={disabled} onClick={() => onReply({ decision: 'accept' })} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-40">Allow once</button></div></div>
}

/** Mounted with a backend/project key: no draft or session is shared across workspaces. */
type WorkspaceChatProps = {
  config: BackendConfig; projectId: string; projectName: string; headerTools?: ReactNode; headerNavigation?: ReactNode; contentOverride?: ReactNode; onShowChat?: () => void; active?: boolean
  /** When provided, the project › title breadcrumb renders into this element instead of an inline header. `null` renders it nowhere (inactive chats). */
  breadcrumbSlot?: HTMLElement | null
}
export function WorkspaceChat(props: WorkspaceChatProps) {
  // This key stays in React memory; persisted keys are credential digests only.
  return <ScopedWorkspaceChat key={JSON.stringify([props.config.baseUrl, props.config.apiToken, props.projectId, props.config.workspaceId ?? ''])} {...props} />
}
function ScopedWorkspaceChat({ config, projectId, projectName, headerTools, headerNavigation, contentOverride, onShowChat, active = true, breadcrumbSlot }: WorkspaceChatProps) {
  const requestedConversation = useAppStore(state => state.requestedWorkspaceConversation)
  const [providers, setProviders] = useState<WorkspaceChatProvider[]>([])
  const providersRef = useRef(providers)
  providersRef.current = providers
  const [sessions, setSessions] = useState<WorkspaceChatSession[]>([])
  const [provider, setProvider] = useState('')
  const [agentSelections, setAgentSelections] = useState<Record<string, AgentSelection | null>>({})
  const [modelSelection, setModelSelection] = useState({ key: '', model: '' })
  const [effortSelection, setEffortSelection] = useState({ key: '', model: '', effort: '' })
  const [modelCatalog, setModelCatalog] = useState<{ key: string; data?: WorkspaceChatModelCatalog; error?: string }>({ key: '' })
  const [sessionId, setSessionId] = useState('')
  const [snapshot, setSnapshot] = useState<WorkspaceChatSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [titleEditor, setTitleEditor] = useState<{ id: string; original: string; value: string } | null>(null)
  const titleSaving = useRef(false)
  const drafts = useRef<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [observationError, setObservationError] = useState<string | null>(null)
  const [uncertainSession, setUncertainSession] = useState('')
  const [blockedRequests, setBlockedRequests] = useState<Record<string, boolean>>({})
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const onHarnessChange = () => setRevision(r => r + 1)
    window.addEventListener('orchestra:harness-registration-changed', onHarnessChange)
    return () => window.removeEventListener('orchestra:harness-registration-changed', onHarnessChange)
  }, [])
  const generation = useRef(0)
  const mutationPending = useRef(false)
  const submitted = useRef<{ sessionId: string; messageId: string; text: string } | null>(null)
  const submittedReply = useRef<{ sessionId: string; requestId: string } | null>(null)
  const creating = useRef<{ sessionId: string; provider: string; title?: string; agent?: AgentSelection; uncertain: boolean } | null>(null)
  const storageKey = useRef('')
  const storageBaseUrl = config.baseUrl
  const storageApiToken = config.apiToken
  const [storageReady, setStorageReady] = useState(false)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const followRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const working = isWorking(snapshot?.session)
  const chatZoom = useChatZoom()
  useEffect(() => { window.dispatchEvent(new CustomEvent(CHAT_SESSION_EVENT, { detail: { projectId, sessionId } })) }, [projectId, sessionId])
  const selectedProvider = providers.find(p => p.id.toLowerCase() === (snapshot?.session.provider || creating.current?.provider || provider).toLowerCase())
  const legacyGeminiSession = snapshot?.session.id === sessionId && snapshot.session.provider.toLowerCase() === 'gemini'
  const agentHarness = snapshot?.session.provider || creating.current?.provider || provider
  const agentKey = JSON.stringify([sessionId, agentHarness])
  const inheritedAgent = snapshot?.session.requested_agent_id && snapshot.session.requested_agent_scope ? { agent_id: snapshot.session.requested_agent_id, agent_scope: snapshot.session.requested_agent_scope, agent_content_hash: snapshot.session.requested_agent_content_hash ?? '', agent_format: snapshot.session.requested_agent_format ?? '' } : undefined
  const selectedAgent = Object.hasOwn(agentSelections, agentKey) ? agentSelections[agentKey] ?? undefined : inheritedAgent
  const agentDirectory = useAgentDirectory(config, projectId, agentHarness, active)
  const [mention, setMention] = useState<{ start: number; query: string; active: number } | null>(null)
  const mentionOptions = mention ? mentionCandidates(agentDirectory, agentHarness, mention.query) : []
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (list.length === 0) return

    for (const file of list) {
      if (file.size > 15 * 1024 * 1024) continue
      const reader = new FileReader()
      reader.onload = () => {
        const url = reader.result as string
        if (typeof url === 'string') {
          setAttachments(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              name: file.name || `image-${Date.now()}.${file.type.split('/')[1] || 'png'}`,
              type: file.type,
              size: file.size,
              url,
            },
          ])
        }
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault()
      addFiles(imageFiles)
    }
  }, [addFiles])
  const nativeSession = snapshot?.session.id === sessionId && snapshot?.session.conversation_mode === 'native_session'
  const nativeComposer = nativeSession || (!sessionId && selectedProvider?.conversation_mode === 'native_session')
  const catalogProvider = snapshot?.session.provider || provider
  const catalogKey = catalogProvider ? JSON.stringify([config.baseUrl, config.apiToken, projectId, sessionId, catalogProvider]) : ''
  const catalog = modelCatalog.key === catalogKey ? modelCatalog.data : undefined
  const selectedModel = modelSelection.key === catalogKey && catalog?.models.some(m => m.model === modelSelection.model) ? modelSelection.model : ''
  const effortModel = selectedModel ? catalog?.models.find(m => m.model === selectedModel) : undefined
  const effortOptions = effortModel?.supported_reasoning_efforts ?? []
  const selectedEffort = effortSelection.key === catalogKey && effortSelection.model === (effortModel?.model ?? '') && effortOptions.some(e => e.reasoning_effort === effortSelection.effort) ? effortSelection.effort : ''
  const messages = snapshot?.messages ?? []
  const draftHero = !messages.length && !working
  const events = snapshot?.events ?? []
  const datedTimeline = messages.length > 0 && messages.every((m, index) => Number.isFinite(Date.parse(m.created_at)) && (index === 0 || Date.parse(m.created_at) >= Date.parse(messages[index - 1].created_at)))
  const eventsBetween = (start: number, end: number) => events.filter(e => { const timestamp = Date.parse(e.created_at); return Number.isFinite(timestamp) && timestamp > start && timestamp <= end })
  /** Agent and applied receipt for an assistant message: its own fields, then its prompt's, then the session's for the latest turn. */
  const messageAgent = (index: number) => {
    const message = messages[index]
    if (message.role !== 'assistant') return {}
    let prompt: typeof message | undefined
    for (let i = index - 1; i >= 0; i--) if (messages[i].role === 'user') { prompt = messages[i]; break }
    const latest = index === messages.length - 1
    const id = message.effective_agent_id || prompt?.effective_agent_id || prompt?.requested_agent_id || (latest ? snapshot?.session.effective_agent_id : '') || ''
    const observation = parseAgentObservation(message.agent_observation || prompt?.agent_observation || (latest ? snapshot?.session.agent_observation : undefined))
    if (!id) return { agentObservation: observation }
    const known = agentDirectory.find(agent => agent.id === id)
    return { agent: { name: known?.name || agentDisplayName(id), color: agentColor(known?.color, id) }, agentObservation: observation }
  }
  /** Divider before a user turn whose agent differs from the previous user turn's. */
  const agentSwitch = (index: number) => {
    const message = messages[index]
    if (message.role !== 'user') return undefined
    let previous: typeof message | undefined
    for (let i = index - 1; i >= 0; i--) if (messages[i].role === 'user') { previous = messages[i]; break }
    if (!previous) return undefined
    const id = message.requested_agent_id || ''
    if (id === (previous.requested_agent_id || '')) return undefined
    if (!id) return { name: projectId === '__orchestrator__' ? 'Maestro' : 'default agent' }
    const known = agentDirectory.find(agent => agent.id === id)
    return { name: known?.name || agentDisplayName(id), color: agentColor(known?.color, id) }
  }
  const updateMention = (input: HTMLTextAreaElement) => {
    const token = mentionQuery(input.value, input.selectionStart ?? input.value.length)
    setMention(token ? { ...token, active: 0 } : null)
  }
  const pickMention = (name: string) => {
    const input = textareaRef.current
    if (!mention || !input) return
    const next = insertMention(draft, mention.start, input.selectionStart ?? draft.length, name)
    setDraft(next.text)
    drafts.current[sessionId] = next.text
    setMention(null)
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(next.caret, next.caret) })
  }
  const rememberAgentModel = (model: string, effort: string) => {
    if (selectedAgent) writeAgentModelChoice(config.baseUrl, selectedAgent.agent_id, { model, effort })
  }
  const chooseAgent = (value?: AgentSelection) => {
    setAgentSelections(previous => ({ ...previous, [agentKey]: value ?? null }))
    const remembered = value ? readAgentModelChoice(config.baseUrl, value.agent_id) : undefined
    if (remembered) {
      setModelSelection({ key: catalogKey, model: remembered.model })
      setEffortSelection({ key: catalogKey, model: remembered.model, effort: remembered.effort })
    }
  }

  const persist = (selectedId = sessionId) => {
    if (!storageKey.current) return
    if (!writeChatDraftReceipt(storageKey.current, {
      version: 1, sessionId: selectedId, provider, drafts: drafts.current, title: draftTitle,
      agents: agentSelections,
      creation: creating.current ? { sessionId: creating.current.sessionId, provider: creating.current.provider, title: creating.current.title, agent: creating.current.agent } : null,
      submission: submitted.current, reply: submittedReply.current,
      blockedRequests: submittedReply.current ? { ...blockedRequests, [submittedReply.current.requestId]: true } : blockedRequests, uncertainSession,
    })) setStorageWarning('Draft storage is unavailable. Keep this tab open to retain unsent drafts and recovery identities.')
  }
  useEffect(() => {
    let cancelled = false
    void chatDraftStorageKey({ baseUrl: storageBaseUrl, apiToken: storageApiToken, workspaceId: config.workspaceId }, projectId).then(key => {
      if (cancelled) return
      storageKey.current = key
      const saved = readChatDraftReceipt(key)
      if (saved) {
        setDraftTitle(saved.title ?? '')
        setAgentSelections(saved.agents ?? {})
        // Input typed while the digest is loading belongs to the fresh draft.
        drafts.current = { ...saved.drafts, ...drafts.current }
        creating.current = saved.creation ? { ...saved.creation, uncertain: true } : null
        submitted.current = saved.creation ? null : saved.submission
        submittedReply.current = saved.reply
        setBlockedRequests(saved.blockedRequests)
        const recoveredId = saved.creation?.sessionId || saved.submission?.sessionId || saved.reply?.sessionId || saved.sessionId
        setSessionId(recoveredId)
        const restoredProvider = saved.creation?.provider || saved.provider
        const activeProvider = restoredProvider.toLowerCase() === 'gemini' && !saved.creation
          ? providersRef.current.find(item => item.enabled && item.id.toLowerCase() === 'antigravity')?.id ?? ''
          : restoredProvider
        setProvider(activeProvider)
        setDraft(drafts.current[recoveredId] ?? '')
        if (saved.creation || saved.submission || saved.reply || saved.uncertainSession) {
          setUncertainSession(saved.creation?.sessionId || saved.submission?.sessionId || saved.reply?.sessionId || saved.uncertainSession)
          setError('Restored an operation with an unknown outcome. Checking its identity; nothing will be resent automatically.')
        }
      }
      setStorageReady(true)
    }).catch(() => { if (!cancelled) { setStorageWarning('Draft storage is unavailable. Keep this tab open to retain unsent drafts and recovery identities.'); setStorageReady(true) } })
    return () => { cancelled = true }
  }, [storageBaseUrl, storageApiToken, projectId, config.workspaceId])
  useEffect(() => { if (storageReady) persist() })

  useEffect(() => {
    if (!active || !catalogKey) return
    let cancelled = false
    setModelCatalog({ key: catalogKey })
    void fetchWorkspaceChatModels(config, projectId, catalogProvider).then(result => {
      if (cancelled) return
      if (result.project_id !== projectId || result.provider !== catalogProvider || result.observation !== 'provider_catalog' || !Array.isArray(result.models)) throw new Error('Model catalog belongs to another workspace or provider.')
      setModelCatalog({ key: catalogKey, data: { ...result, models: result.models.filter(m => !m.hidden && typeof m.model === 'string' && m.model.trim()) } })
    }).catch(err => { if (!cancelled) setModelCatalog({ key: catalogKey, error: errorText(err) }) })
    return () => { cancelled = true }
  }, [config, projectId, catalogProvider, catalogKey, revision, active])

  useEffect(() => {
    if (!active) return
    const epoch = ++generation.current
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchWorkspaceChatProviders(config, projectId), listWorkspaceChatSessions(config, projectId)])
      .then(([catalog, history]) => {
        if (cancelled || generation.current !== epoch) return
        if (!Array.isArray(catalog.providers) || !Array.isArray(history.sessions)) throw new Error('Workspace chat returned an invalid provider or session catalog. Refresh before continuing.')
        if (history.sessions.some(session => session.project_id !== projectId || (config.workspaceId && session.workspace_id !== config.workspaceId))) throw new Error('Conversation history belongs to another workspace.')
        const activeProviders = catalog.providers.filter(item => item.id.toLowerCase() !== 'gemini')
        setProviders(activeProviders)
        setSessions(history.sessions)
        setProvider(previous => {
          const match = activeProviders.find(p => p.id.toLowerCase() === previous.toLowerCase() && p.enabled)
          if (match) return match.id
          return activeProviders.find(p => p.id.toLowerCase() === 'antigravity' && p.enabled)?.id ?? activeProviders.find(p => p.enabled)?.id ?? ''
        })
      })
      .catch(err => { if (!cancelled) setError(errorText(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; generation.current = epoch + 1 }
  }, [config, projectId, revision, active])

  useEffect(() => {
    if (!active || !sessionId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const result = await fetchWorkspaceChat(config, projectId, sessionId)
        if (cancelled) return
        if (result.session.project_id !== projectId || result.session.id !== sessionId || (config.workspaceId && result.session.workspace_id !== config.workspaceId)) {
          throw new Error('Chat response belongs to another workspace.')
        }
        setSnapshot(result)
        if (creating.current?.sessionId === sessionId && creating.current.uncertain) {
          if (result.session.provider !== creating.current.provider) throw new Error('Created conversation belongs to another provider.')
          creating.current = null
          submitted.current = null
          setUncertainSession('')
          setError('Conversation recovered. Your draft has not been sent; send it when ready.')
        }
        const submission = submitted.current
        if (submission?.sessionId === sessionId && result.messages.some(m => m.client_message_id === submission.messageId)) {
          setUncertainSession('')
          setError(null)
          setDraft(previous => previous === submission.text ? '' : previous)
          if (drafts.current[sessionId] === submission.text) drafts.current[sessionId] = ''
          submitted.current = null
        }
        const response = submittedReply.current
        if (response?.sessionId === sessionId && result.requests?.some(r => r.id === response.requestId && (r.status === 'answered' || r.status === 'stale'))) {
          setUncertainSession('')
          setError(null)
          submittedReply.current = null
        }
        setObservationError(null)
        setSessions(previous => [result.session, ...previous.filter(s => s.id !== result.session.id)])
        timer = setTimeout(() => void load(), isWorking(result.session) ? 1000 : 5000)
      } catch (err) {
        if (!cancelled) {
          setObservationError(`${errorText(err)} Rechecking conversation state; no message will be resent.`)
          timer = setTimeout(() => void load(), 5000)
        }
      }
    }
    void load()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [config, projectId, sessionId, pending, revision, active])

  useEffect(() => {
    if (followRef.current) {
      const el = timelineRef.current
      if (el) {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [snapshot?.messages?.length, snapshot?.events?.length, snapshot?.cursor])
  useEffect(() => {
    followRef.current = true
    setShowJump(false)
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight
    }
  }, [sessionId])
  useEffect(() => { const input = textareaRef.current; if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(240, Math.max(88, input.scrollHeight))}px` } }, [draft])

  const mutate = useCallback(async (action: () => Promise<void>, allowPreacceptRejection = false) => {
    if (mutationPending.current) return
    mutationPending.current = true
    const epoch = generation.current
    setPending(true)
    setError(null)
    try { await action() } catch (err) {
      if (generation.current === epoch) {
        const rejected = allowPreacceptRejection && ['chat_not_found', 'unauthorized_project_path', 'chat_busy', 'invalid_chat_request', 'chat_provider_unavailable', 'unauthorized'].includes(textValue(record(err).code))
        if (rejected) {
          const rejectedSubmission = submitted.current
          submitted.current = null
          const creation = creating.current
          if (creation && (creation.sessionId === sessionId || creation.sessionId === rejectedSubmission?.sessionId)) { creating.current = null; setSessionId(''); setSnapshot(null) }
          setError(`${errorText(err)} Message was not accepted. Your draft is retained.`)
        }
        else {
          const creation = creating.current
          if (creation && (creation.sessionId === sessionId || creation.sessionId === submitted.current?.sessionId)) { creation.uncertain = true; setUncertainSession(creation.sessionId); setError(`${errorText(err)} Conversation creation may have landed; checking its identity. No message will be sent automatically.`) }
          else { setUncertainSession(submitted.current?.sessionId || sessionId); setError(`${errorText(err)} Check the conversation before sending again; delivery may be uncertain.`) }
        }
      }
    } finally {
      mutationPending.current = false
      if (generation.current === epoch) setPending(false)
    }
  }, [sessionId])

  const newConversation = () => {
    if (pending || mutationPending.current || creating.current) return
    onShowChat?.()
    setSessionId(''); setSnapshot(null); setError(null); setObservationError(null); setTitleEditor(null); setDraftTitle('')
    setDraft(drafts.current[''] ?? '')
    textareaRef.current?.focus()
  }
  const chooseConversation = (id: string) => {
    if (pending) return
    setSessionId(id); setSnapshot(null); setError(null); setObservationError(null); setTitleEditor(null)
    setDraft(drafts.current[id] ?? '')
  }
  useEffect(() => {
    const request = requestedConversation
    if (!request || !active || loading || pending || mutationPending.current || creating.current || request.projectId !== projectId || request.baseUrl !== config.baseUrl || request.apiToken !== config.apiToken || request.workspaceId !== config.workspaceId) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      if (request.sessionId === '') {
        newConversation()
      } else if (!sessions.some(session => session.id === request.sessionId && session.project_id === projectId)) {
        setObservationError('The selected conversation was not found in this workspace. Refresh its history before opening it.')
      } else {
        chooseConversation(request.sessionId)
        persist(request.sessionId)
      }
      useAppStore.getState().clearWorkspaceConversationRequest(request.requestId)
    })
    return () => { cancelled = true }
    // Selection uses this render's session list and draft recovery state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedConversation, active, loading, pending, projectId, config.baseUrl, config.apiToken, config.workspaceId, sessions])
  const retryCreate = () => {
    const creation = creating.current
    if (!creation || !creation.uncertain || pending || mutationPending.current) return
    creation.uncertain = false
    void mutate(async () => {
      const epoch = generation.current
      const session = creation.title || creation.agent ? await createWorkspaceChatSession(config, projectId, creation.provider, creation.sessionId, { ...(creation.title ? { title: creation.title } : {}), ...creation.agent }) : await createWorkspaceChatSession(config, projectId, creation.provider, creation.sessionId)
      if (generation.current !== epoch) return
      if (session.project_id !== projectId || session.provider !== creation.provider || session.id !== creation.sessionId) throw new Error('Created conversation belongs to another workspace or provider.')
      const result = await fetchWorkspaceChat(config, projectId, creation.sessionId)
      if (generation.current !== epoch) return
      if (result.session.project_id !== projectId || result.session.provider !== creation.provider || result.session.id !== creation.sessionId) throw new Error('Recovered conversation belongs to another workspace or provider.')
      creating.current = null; submitted.current = null
      setSnapshot(result); setSessionId(result.session.id)
      setDraft(drafts.current[result.session.id] ?? '')
      setSessions(previous => [result.session, ...previous.filter(s => s.id !== result.session.id)])
      setUncertainSession(''); setObservationError(null)
      setError('Conversation recovered. Your draft has not been sent; send it when ready.')
    })
  }
  /**
   * Sends the draft (with attachments), or `override` text instead. An override
   * leaves the user's draft and attachments untouched.
   */
  const send = (override?: string) => {
    const overriding = override !== undefined
    const hasContent = overriding ? override.trim().length > 0 : draft.trim().length > 0 || attachments.length > 0
    if (!storageReady || legacyGeminiSession || creating.current || submitted.current || !hasContent || working || pending || mutationPending.current || observationError || (sessionId && uncertainSession === sessionId) || (sessionId ? snapshot?.session.id !== sessionId : !selectedProvider?.enabled || loading)) return
    let text = overriding ? override.trim() : draft.trim()
    if (!overriding) {
      if (attachments.length > 0) {
        const imageMarkdown = attachments.map(att => `![${att.name}](${att.url})`).join('\n\n')
        text = text ? `${text}\n\n${imageMarkdown}` : imageMarkdown
      }
      setAttachments([])
    }
    const messageId = crypto.randomUUID()
    const targetId = sessionId || crypto.randomUUID()
    submitted.current = { sessionId: targetId, messageId, text }
    followRef.current = true
    void mutate(async () => {
      const epoch = generation.current
      if (!sessionId) {
        creating.current = { sessionId: targetId, provider, title: draftTitle || undefined, agent: selectedAgent, uncertain: false }
        if (selectedAgent) setAgentSelections(previous => ({ ...previous, [JSON.stringify([targetId, provider])]: selectedAgent }))
        setSessionId(targetId)
        drafts.current[targetId] = overriding ? draft : text
        persist(targetId)
        const session = draftTitle || selectedAgent ? await createWorkspaceChatSession(config, projectId, provider, targetId, { ...(draftTitle ? { title: draftTitle } : {}), ...selectedAgent }) : await createWorkspaceChatSession(config, projectId, provider, targetId)
        if (generation.current !== epoch) return
        if (session.project_id !== projectId || session.provider !== provider || session.id !== targetId) throw new Error('Created conversation belongs to another workspace or provider.')
        creating.current = null
        setSessions(previous => [session, ...previous.filter(s => s.id !== session.id)])
        setSnapshot({ session, messages: [], events: [], requests: [] })
      }
      // Save the client message identity before crossing the dispatch boundary.
      persist(targetId)
      const result = selectedAgent ? await sendWorkspaceChatMessage(config, projectId, targetId, messageId, text, selectedModel || undefined, selectedEffort || undefined, selectedAgent) : selectedEffort
        ? await sendWorkspaceChatMessage(config, projectId, targetId, messageId, text, selectedModel || undefined, selectedEffort)
        : selectedModel ? await sendWorkspaceChatMessage(config, projectId, targetId, messageId, text, selectedModel)
        : await sendWorkspaceChatMessage(config, projectId, targetId, messageId, text)
      if (generation.current !== epoch) return
      if (result.session.project_id !== projectId || result.session.id !== targetId) throw new Error('Message response belongs to another workspace.')
      setSnapshot(previous => previous ? {
        ...previous,
        session: result.session,
        messages: [...previous.messages.filter(m => m.id !== result.message.id), result.message],
      } : null)
      if (!overriding) {
        setDraft('')
        drafts.current[targetId] = ''
        if (!sessionId) drafts.current[''] = ''
      }
      submitted.current = null
      persist(targetId)
    }, true)
  }
  const variantActionsDisabled = !storageReady || legacyGeminiSession || working || pending || !sessionId || snapshot?.session.id !== sessionId || !!creating.current || !!submitted.current || uncertainSession === sessionId || !!observationError
  const regenerateVariant = (index: number, render: HtmlRenderReference) => send(regenerateVariantPrompt(index, render))
  const implementVariant = (index: number, render: HtmlRenderReference) => send(implementVariantPrompt(index, render))

  const interrupt = () => {
    if (!working || pending || snapshot?.session.status === 'stopping') return
    void mutate(async () => {
      const epoch = generation.current
      const result = await stopWorkspaceChatTurn(config, projectId, sessionId)
      if (generation.current !== epoch) return
      if (result.session.project_id !== projectId || result.session.id !== sessionId) throw new Error('Stop response belongs to another workspace.')
      setSnapshot(previous => previous ? { ...previous, session: result.session } : null)
    })
  }

  const conversationTitle = snapshot?.session.title || draftTitle || 'New conversation'
  const saveTitle = async () => {
    const edit = titleEditor
    if (!edit || titleSaving.current || mutationPending.current) return
    const title = edit.value.trim()
    if (!title || Array.from(title).length > 200) { setError('Conversation name must contain 1–200 characters.'); return }
    if (!edit.id) { setDraftTitle(title); setTitleEditor(null); setError(null); return }
    if (title === edit.original) { setTitleEditor(null); return }
    titleSaving.current = true
    mutationPending.current = true
    setPending(true)
    const epoch = generation.current
    try {
      let renamed: WorkspaceChatSession
      try { renamed = await renameWorkspaceChatSession(config, projectId, edit.id, title, edit.original) }
      catch (failure) {
        // A lost response may have committed. Observe before reporting or retrying.
        const observed = await fetchWorkspaceChat(config, projectId, edit.id)
        if (observed.session.id !== edit.id || observed.session.project_id !== projectId || (config.workspaceId && observed.session.workspace_id !== config.workspaceId)) throw new Error('Rename observation belongs to another workspace.')
        if (observed.session.title !== title) {
          if (generation.current === epoch) { setSnapshot(observed); setSessions(previous => previous.map(s => s.id === edit.id ? observed.session : s)) }
          throw failure
        }
        renamed = observed.session
      }
      if (generation.current !== epoch) return
      if (renamed.id !== edit.id || renamed.project_id !== projectId || (config.workspaceId && renamed.workspace_id !== config.workspaceId)) throw new Error('Rename response belongs to another workspace.')
      setSnapshot(previous => previous?.session.id === edit.id ? { ...previous, session: renamed } : previous)
      setSessions(previous => previous.map(s => s.id === edit.id ? renamed : s))
      setTitleEditor(null); setError(null)
    } catch (failure) { if (generation.current === epoch) setError(errorText(failure)) }
    finally { titleSaving.current = false; mutationPending.current = false; if (generation.current === epoch) setPending(false) }
  }

  const switchHarness = async (id: string) => {
    const current = snapshot?.session
    if (!current || current.id !== sessionId || mutationPending.current) return
    mutationPending.current = true
    setPending(true)
    const epoch = generation.current
    try {
      try { await switchWorkspaceChatProvider(config, projectId, current.id, id, current.provider) }
      catch (failure) {
        // A lost response may have committed. Observe before reporting.
        const observed = await fetchWorkspaceChat(config, projectId, current.id)
        if (observed.session.provider.toLowerCase() !== id.toLowerCase()) throw failure
      }
      const observed = await fetchWorkspaceChat(config, projectId, current.id)
      if (generation.current !== epoch) return
      if (observed.session.id !== current.id || observed.session.project_id !== projectId || (config.workspaceId && observed.session.workspace_id !== config.workspaceId)) throw new Error('Harness switch response belongs to another workspace.')
      setSnapshot(observed)
      setSessions(previous => previous.map(s => s.id === current.id ? observed.session : s))
      setProvider(observed.session.provider)
      setError(null)
    } catch (failure) { if (generation.current === epoch) setError(errorText(failure)) }
    finally { mutationPending.current = false; if (generation.current === epoch) setPending(false) }
  }

  const reply = (request: WorkspaceChatRequest, answer: Record<string, unknown>) => {
    if (request.status !== 'pending' || pending || observationError || blockedRequests[request.id]) return
    setBlockedRequests(previous => ({ ...previous, [request.id]: true }))
    submittedReply.current = { sessionId, requestId: request.id }
    persist()
    void mutate(async () => {
      const epoch = generation.current
      const result = await replyWorkspaceChatRequest(config, projectId, sessionId, request.id, crypto.randomUUID(), answer)
      if (generation.current !== epoch) return
      if (result.id !== request.id || result.turn_id !== request.turn_id) throw new Error('Reply response belongs to another agent request.')
      setSnapshot(previous => previous ? { ...previous, requests: previous.requests?.map(r => r.id === result.id ? result : r) } : null)
    })
  }

  const breadcrumb = <>
    <AppTooltip content="New conversation" side="bottom"><button type="button" aria-label="New conversation" disabled={pending} onClick={newConversation} className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"><SquarePen size={13} /></button></AppTooltip>
    <span className="max-w-36 shrink-0 truncate text-[11px] text-muted-foreground">{projectName}</span><ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
    <h2 className={`min-w-8 truncate text-[13px] font-medium ${breadcrumbSlot === undefined ? 'flex-1' : 'max-w-[50ch]'}`}>{titleEditor ? <input autoFocus aria-label="Conversation name" value={titleEditor.value} disabled={pending} onFocus={e => e.currentTarget.select()} onChange={e => setTitleEditor({ ...titleEditor, value: e.target.value })} onBlur={() => { void saveTitle() }} onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void saveTitle() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTitleEditor(null) } }} className="w-full min-w-[20ch] rounded border border-border bg-background px-1 outline-none focus:border-primary" /> : <button type="button" aria-label={`Rename conversation: ${conversationTitle}`} title={conversationTitle} disabled={pending || !!creating.current || (sessionId !== '' && snapshot?.session.id !== sessionId)} onClick={() => setTitleEditor({ id: sessionId, original: conversationTitle, value: conversationTitle })} className="block w-full max-w-[50ch] truncate rounded px-1 text-left hover:bg-accent disabled:opacity-50">{conversationTitle}</button>}</h2>
    {(working || observationError) && <span className="shrink-0 text-[10px] text-muted-foreground">{observationError ? 'Disconnected' : 'Working'}</span>}
  </>

  return (
    <section aria-label={`${projectName} workspace chat`} onKeyDown={e => {
      if (e.defaultPrevented || e.key !== 'Escape' || e.nativeEvent.isComposing) return
      if (working) { e.preventDefault(); interrupt() }
    }} className="relative flex h-full min-h-0 min-w-0 flex-col bg-background">
      {breadcrumbSlot === undefined ? <header className="shrink-0 px-3 pt-1">
        <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        {breadcrumb}
        {headerNavigation}
        {headerTools && <div className="flex shrink-0 items-center gap-0.5">
          {headerTools}
        </div>}
        </div>
      </header> : <>
        {breadcrumbSlot && createPortal(<nav aria-label="Conversation" className="flex min-w-0 items-center gap-1.5">{breadcrumb}</nav>, breadcrumbSlot)}
        {(headerNavigation || headerTools) && <header className="flex shrink-0 items-center justify-end gap-0.5 px-3 pt-1">{headerNavigation}{headerTools}</header>}
      </>}
      {contentOverride && <div className="min-h-0 flex-1 overflow-auto">{contentOverride}</div>}
      <div hidden={!!contentOverride} className={`${contentOverride ? 'hidden' : 'flex'} min-h-0 flex-1 flex-col`}>
      {(error || observationError) && <div role="alert" className="border-b border-destructive/20 bg-destructive/5 px-5 py-3 text-xs text-destructive">{error || observationError}</div>}
      {creating.current?.uncertain && creating.current.sessionId === sessionId && <div className="px-5 py-2"><button disabled={pending} onClick={retryCreate} className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40">Retry creating chat</button><p className="mt-1 text-[10px] text-muted-foreground">Reuses the same conversation identity. Your message stays unsent.</p></div>}
      <div className="relative min-h-0 flex-1">
      <MessageRail messages={messages} timelineRef={timelineRef} />
      <div ref={timelineRef} aria-label="Chat timeline" onScroll={e => { const el = e.currentTarget; followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; setShowJump(!followRef.current) }} className="h-full overflow-y-auto px-4 py-6 sm:px-6">
        <div role="log" aria-label="Conversation messages" className="mx-auto max-w-[760px] space-y-5 pb-4" style={{ zoom: chatZoom }}>
          {messages.map((message, index) => {
            const turnEvents = datedTimeline ? eventsBetween(index === 0 ? -Infinity : Date.parse(messages[index - 1].created_at), Date.parse(message.created_at)) : []
            const htmlRenders = extractHtmlRendersFromEvents(turnEvents)
            return (
              <Fragment key={message.id}>
                {datedTimeline && <AgentActivity events={turnEvents} />}
                <div data-rail-message-id={message.id}>
                  {index > 0 && message.provider && messages[index - 1].provider && message.provider !== messages[index - 1].provider && <HarnessDivider provider={message.provider} />}
                  {(() => { const change = agentSwitch(index); return change ? <AgentDivider {...change} /> : null })()}
                  <ChatMessage message={message} provider={message.provider || snapshot?.session.provider || ''} projectId={projectId} htmlRenders={htmlRenders} onRegenerateVariant={regenerateVariant} onImplementVariant={implementVariant} variantActionsDisabled={variantActionsDisabled} {...messageAgent(index)} />
                </div>
              </Fragment>
            )
          })}
          <AgentActivity events={datedTimeline ? events.filter(e => !Number.isFinite(Date.parse(e.created_at)) || Date.parse(e.created_at) > Date.parse(messages[messages.length - 1].created_at)) : events} />
          <StreamingAssistant events={working ? events : []} projectId={projectId} provider={snapshot?.session.provider || provider} />
          {snapshot?.requests?.filter(request => request.status !== 'pending').map(request => <p key={request.id} role="status" className="text-[11px] text-muted-foreground">Agent request {request.status}</p>)}
          {working && (
            <AgentWorkingStatus
              status={snapshot?.session.status}
              provider={snapshot?.session.provider || provider}
              onInterrupt={interrupt}
            />
          )}
          <div ref={endRef} />
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          aria-label="Scroll to latest message"
          onClick={() => {
            followRef.current = true
            setShowJump(false)
            timelineRef.current?.scrollTo?.({ top: timelineRef.current.scrollHeight, behavior: 'smooth' })
          }}
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/80 bg-background/95 backdrop-blur px-3 py-1.5 text-xs font-medium text-foreground shadow-md hover:bg-accent transition-all"
        >
          <ArrowDown className="size-3.5" />
          Latest
        </button>
      )}
      </div>
      <footer data-chat-composer-placement={draftHero ? 'centered' : 'docked'} className={`${draftHero ? 'absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2' : 'mx-auto shrink-0'} w-full max-w-[808px] px-4 pb-3 pt-1 sm:px-6`} style={{ zoom: chatZoom }}>
        {draftHero && <div className="relative mb-7 px-1"><div className="pointer-events-none absolute -left-20 -top-20 size-64 rounded-full bg-primary/[0.055] blur-3xl" aria-hidden="true" /><h3 className="relative max-w-[680px] text-[clamp(27px,3vw,38px)] font-semibold leading-[1.16] tracking-[-0.035em] text-foreground">What would you like to build?</h3><p className="relative mt-3 max-w-[550px] text-[14px] leading-6 text-muted-foreground">Describe a goal, ask a question, or make a change. Start wherever you are.</p></div>}
        <div aria-label="Agent decisions" className="mb-2 max-h-[40vh] space-y-2 overflow-auto">{snapshot?.requests?.filter(request => request.status === 'pending').map(request => <RuntimeRequestCard key={`${sessionId}:${request.id}`} request={request} disabled={pending || !working || !!observationError || !!blockedRequests[request.id]} onReply={answer => reply(request, answer)} />)}</div>
        {legacyGeminiSession && <p role="status" className="mb-2 text-xs text-muted-foreground">Gemini conversation history is preserved and read-only. Choose a current harness to start a new conversation.</p>}
        {uncertainSession === sessionId && sessionId && <p role="status" className="mb-2 text-xs text-destructive">Delivery is uncertain. Your draft is retained; inspect the conversation before starting a new turn.</p>}
        {creating.current && creating.current.sessionId !== sessionId && <p role="status" className="mb-2 text-xs text-muted-foreground">Recover the pending chat from Conversations before sending another message.</p>}{submitted.current && submitted.current.sessionId !== sessionId && <p role="status" className="mb-2 text-xs text-muted-foreground">Resolve the pending message in its conversation before sending another message.</p>}{storageWarning && <p role="status" className="mb-2 text-xs text-muted-foreground">{storageWarning}</p>}{snapshot?.session.error && <p role="status" className="mb-2 text-xs text-destructive">{snapshot.session.error}</p>}
        <div className="relative">
        <AgentMentionMenu candidates={mentionOptions} active={mention?.active ?? 0} onActiveChange={index => setMention(previous => previous ? { ...previous, active: index } : previous)} onPick={agent => pickMention(agent.name)} />
        <div
          onDragOver={e => {
            if (e.dataTransfer?.types?.includes('Files')) {
              e.preventDefault()
              setIsDragging(true)
            }
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setIsDragging(false)
            if (e.dataTransfer?.files?.length) {
              addFiles(e.dataTransfer.files)
            }
          }}
          className={`overflow-hidden rounded-[20px] border ${isDragging ? 'border-primary ring-2 ring-primary/20 bg-primary/[0.02]' : 'border-border/75 bg-card/95'} shadow-[0_18px_55px_-28px_rgba(0,0,0,0.8),0_2px_12px_-6px_rgba(0,0,0,0.3)] transition-[border-color,box-shadow,background-color] focus-within:border-primary/45 focus-within:shadow-[0_22px_65px_-28px_rgba(0,0,0,0.85),0_0_0_3px_hsl(var(--primary)/0.06)] ${draftHero ? 'ring-1 ring-white/[0.035]' : ''}`}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border/30 px-3 pb-2.5 pt-3 sm:px-4">
              {attachments.map((att, idx) => (
                <div
                  key={att.id}
                  className="group relative flex items-center gap-2 rounded-xl border border-border/70 bg-muted/40 p-1.5 pr-2 shadow-xs transition-all hover:border-primary/40 hover:bg-muted/60"
                >
                  <img
                    src={att.url}
                    alt={att.name}
                    className="size-10 rounded-lg border border-border/50 object-cover"
                  />
                  <div className="min-w-0 max-w-[130px]">
                    <p className="truncate text-xs font-medium text-foreground">{att.name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatFileSize(att.size)}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${att.name}`}
                    title="Remove attachment"
                    onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                    className="rounded-full p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea ref={textareaRef} aria-label="Message agent" aria-autocomplete="list" aria-expanded={mentionOptions.length > 0} value={draft} onChange={e => { setDraft(e.target.value); drafts.current[sessionId] = e.target.value; persist(); updateMention(e.target) }} onSelect={e => { if (mention) updateMention(e.currentTarget) }} onBlur={() => setMention(null)} onPaste={handlePaste} rows={3} disabled={pending || legacyGeminiSession} placeholder={legacyGeminiSession ? 'Legacy conversation history is read-only' : working ? 'Draft your next message while the agent works…' : 'Ask anything, or describe a change…'} onKeyDown={e => {
            if (e.nativeEvent.isComposing) return
            if (mention && mentionOptions.length) {
              const count = mentionOptions.length
              const current = Math.min(mention.active, count - 1)
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMention({ ...mention, active: (current + (e.key === 'ArrowDown' ? 1 : -1) + count) % count }); return }
              if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); pickMention(mentionOptions[current].name); return }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }} className="block max-h-60 min-h-[96px] w-full resize-none bg-transparent px-4 pt-4 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/55 disabled:opacity-50 sm:px-5" />
          <div aria-label="Main agent controls" className="flex min-w-0 flex-wrap items-center gap-2 px-3 pb-3 pt-1 sm:px-4">
            <AppTooltip content="Attach images (or paste Ctrl+V)">
              <button
                type="button"
                aria-label="Attach images"
                title="Attach images"
                disabled={pending || working || legacyGeminiSession}
                onClick={() => fileInputRef.current?.click()}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/65 hover:bg-muted/60 hover:text-foreground disabled:opacity-40 transition-colors"
              >
                <Paperclip className="size-4" />
              </button>
            </AppTooltip>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => {
                if (e.target.files) {
                  addFiles(e.target.files)
                  e.target.value = ''
                }
              }}
            />
            <HarnessPicker providers={providers} provider={snapshot?.session.provider || creating.current?.provider || provider} disabled={loading || pending || working} locked={!!creating.current || !!submitted.current || !!submittedReply.current || working || pending}
              catalog={catalog} model={selectedModel} effort={selectedEffort} effortOptions={effortOptions} effortDisabled={pending || working} onEffort={value => { setEffortSelection({ key: catalogKey, model: effortModel?.model ?? '', effort: value }); rememberAgentModel(effortModel?.model ?? '', value) }} onModel={value => { setModelSelection({ key: catalogKey, model: value }); rememberAgentModel(value, '') }} onProvider={id => {
                if (id.toLowerCase() === (snapshot?.session.provider || provider).toLowerCase()) return
                if (creating.current || submitted.current || submittedReply.current || working || pending) return
                // Keep the conversation: the backend rebinds it and replays history into the new harness.
                if (sessionId) { void switchHarness(id); return }
                setProvider(id)
              }} />
            <AgentPicker config={config} projectId={projectId} harness={agentHarness} selection={selectedAgent} disabled={loading || pending || working || legacyGeminiSession || !!creating.current || !!submitted.current || !!submittedReply.current || !!uncertainSession} onChange={chooseAgent} />
            <span className="flex-1" />
            {working ? <button aria-label="Stop current turn" title="Interrupt current turn (Escape)" disabled={pending || snapshot?.session.status === 'stopping'} onClick={interrupt} className="shrink-0 rounded-full border border-border bg-background p-2 disabled:opacity-40"><Square className="size-3.5" /></button>
              : <button aria-label="Send message" title="Send message" disabled={!storageReady || legacyGeminiSession || !!creating.current || !!submitted.current || (!draft.trim() && attachments.length === 0) || pending || !!observationError || (sessionId ? !snapshot || uncertainSession === sessionId : loading || !selectedProvider?.enabled)} onClick={() => send()} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-primary/90 disabled:translate-y-0 disabled:bg-foreground disabled:text-background disabled:opacity-25"><ArrowUp className="size-4" /></button>}
          </div>
        </div>
        </div>
        {nativeComposer &&(!catalog || modelCatalog.error) && <p className="mt-2 text-[10px] text-muted-foreground">{modelCatalog.key === catalogKey && modelCatalog.error ? `Model catalog unavailable: ${modelCatalog.error}. Provider default remains available.` : 'Loading provider model catalog…'}</p>}
        {!loading && !sessionId && !selectedProvider?.enabled && <p className="mt-2 text-xs text-muted-foreground">{providers.map(p => `${p.label}: ${p.reason || 'unavailable'}`).join(' · ') || 'Workspace chat is unavailable on this backend. Refresh after updating the backend.'}</p>}
        <p className="mt-2.5 px-1 text-[10px] tracking-wide text-muted-foreground/65">{working ? 'Drafts stay unsent until the current turn finishes · Esc to interrupt' : 'Enter to send · Shift+Enter for a new line'}</p>
      </footer>
      </div>
    </section>
  )
}
