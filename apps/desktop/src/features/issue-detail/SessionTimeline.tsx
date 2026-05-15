import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Terminal } from 'lucide-react'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'

interface SessionTimelineProps {
  logs: string
  loading: boolean
}

interface ParsedEntry {
  idx: number
  kind: 'agent' | 'thinking' | 'tool' | 'result' | 'error'
  ts: string
  label: string
  content: string
  status?: string
}

function parseLogs(raw: string): ParsedEntry[] {
  const parsed: ParsedEntry[] = []

  raw.split('\n').forEach((line, idx) => {
    const trimmed = line.trim()
    if (!trimmed) return

    if (!trimmed.startsWith('{')) {
      if (/error|fail|429|refused|SIGTERM|panic/i.test(trimmed)) {
        parsed.push({ idx, kind: 'error', ts: '', label: '', content: trimmed })
      }
      return
    }

    let obj: Record<string, unknown>
    try { obj = JSON.parse(trimmed) } catch { return }

    const type = (obj.type as string) || ''
    const ts = obj.timestamp
      ? new Date(obj.timestamp as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : ''

    // Skip system/init entries
    if (type === 'system' || type === 'init') return

    // ── assistant (Claude Code stream-json) ──
    if (type === 'assistant') {
      const msg = obj.message as Record<string, unknown> | undefined
      const content = msg?.content as Array<Record<string, unknown>> | string | undefined
      if (typeof content === 'string' && content.trim()) {
        parsed.push({ idx, kind: 'agent', ts, label: '', content })
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            parsed.push({ idx, kind: 'agent', ts, label: '', content: block.text as string })
          } else if (block.type === 'tool_use') {
            const input = block.input as Record<string, unknown> | undefined
            parsed.push({
              idx, kind: 'tool', ts,
              label: (block.name as string) || 'tool',
              content: String(input?.command || input?.file_path || '').slice(0, 150),
            })
          } else if (block.type === 'thinking') {
            const thinking = (block.thinking as string) || ''
            if (thinking.trim()) parsed.push({ idx, kind: 'thinking', ts, label: '', content: thinking })
          }
        }
      }
      return
    }

    // ── message (Gemini/OpenCode NDJSON) ──
    if (type === 'message') {
      if (obj.role === 'assistant') {
        const c = typeof obj.content === 'string' ? obj.content : ''
        if (c.trim()) parsed.push({ idx, kind: 'agent', ts, label: '', content: c })
      }
      // user messages with tool_result blocks
      if (obj.role === 'user') {
        const msg = obj.message as Record<string, unknown> | undefined
        const content = msg?.content as Array<Record<string, unknown>> | undefined
        if (content) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              const raw = block.content
              const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? (raw as Array<Record<string, unknown>>).map(b => typeof b.text === 'string' ? b.text : '').join('') : ''
              parsed.push({ idx, kind: 'result', ts, label: '', content: text.length > 200 ? text.slice(0, 200) + '...' : text, status: block.is_error ? 'error' : 'success' })
            }
          }
        }
      }
      return
    }

    // ── tool_use ──
    if (type === 'tool_use') {
      const tool = (obj.tool_name as string) || (obj.name as string) || 'tool'
      const p = (obj.parameters as Record<string, unknown>) || (obj.input as Record<string, unknown>) || {}
      parsed.push({
        idx, kind: 'tool', ts, label: tool,
        content: String(p.command || p.file_path || p.dir_path || p.pattern || p.description || ''),
      })
      return
    }

    // ── tool_result ──
    if (type === 'tool_result') {
      const o = (obj.output as string) || ''
      parsed.push({ idx, kind: 'result', ts, label: '', content: o.length > 200 ? o.slice(0, 200) + '...' : o, status: (obj.status as string) || 'success' })
      return
    }

    // ── user (Claude Code — contains tool_result blocks) ──
    if (type === 'user') {
      const msg = obj.message as Record<string, unknown> | undefined
      const content = msg?.content as Array<Record<string, unknown>> | undefined
      if (content) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            const raw = block.content
            const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? (raw as Array<Record<string, unknown>>).map(b => typeof b.text === 'string' ? b.text : '').join('') : ''
            parsed.push({ idx, kind: 'result', ts, label: '', content: text.length > 200 ? text.slice(0, 200) + '...' : text, status: block.is_error ? 'error' : 'success' })
          }
        }
      }
      return
    }

    // ── content_block_delta (streaming) ──
    if (type === 'content_block_delta') {
      const delta = obj.delta as Record<string, unknown> | undefined
      const text = (delta?.text as string) || ''
      if (text.trim()) parsed.push({ idx, kind: 'agent', ts, label: '', content: text })
      return
    }

    // ── result (final result) ──
    if (type === 'result') {
      const resultText = (obj.result as string) || ''
      if (resultText.trim()) parsed.push({ idx, kind: 'agent', ts, label: '', content: resultText })
      return
    }

    // ── error ──
    if (type === 'error') {
      const msg = (obj.message as string) || (obj.error as string) || JSON.stringify(obj)
      parsed.push({ idx, kind: 'error', ts, label: '', content: msg })
      return
    }

    // ── Codex item.completed ──
    if (type === 'item.completed') {
      const item = obj.item as Record<string, unknown> | undefined
      if (!item) return
      const iType = (item.type as string) || ''
      const text = (item.text as string) || (item.aggregated_output as string) || ''
      if (iType === 'agent_message') parsed.push({ idx, kind: 'agent', ts, label: '', content: text })
      else if (iType === 'reasoning') parsed.push({ idx, kind: 'thinking', ts, label: '', content: text })
      else if (iType === 'command_execution') parsed.push({ idx, kind: 'tool', ts, label: 'shell', content: (item.command as string) || text.slice(0, 150) })
      else if (iType === 'file_edit' || iType === 'file_create') parsed.push({ idx, kind: 'tool', ts, label: iType === 'file_edit' ? 'edit' : 'create', content: (item.file_path as string) || text.slice(0, 150) })
      else if (text.trim()) parsed.push({ idx, kind: 'agent', ts, label: '', content: text })
    }
  })

  return parsed
}

function deduplicateAndMergeEntries(entries: ParsedEntry[]): ParsedEntry[] {
  const result: ParsedEntry[] = []
  for (const entry of entries) {
    // Skip empty content
    if (!entry.content.trim()) continue
    // Skip PTY noise — shell prompts, ANSI artifacts, short garbage
    if (entry.kind === 'agent' && entry.content.length < 5 && !/[a-zA-Z]/.test(entry.content)) continue

    const prev = result[result.length - 1]

    // Exact duplicate — skip
    if (prev && prev.kind === entry.kind && prev.content === entry.content) continue

    // Merge consecutive agent messages (streaming deltas) into one
    if (prev && prev.kind === 'agent' && entry.kind === 'agent' && !prev.label && !entry.label) {
      // Only merge if both are short (streaming fragments) or same timestamp
      if (prev.content.length < 100 || entry.content.length < 100 || prev.ts === entry.ts) {
        prev.content = prev.content + entry.content
        continue
      }
    }

    result.push(entry)
  }
  return result
}

const dotColor: Record<string, string> = {
  agent: 'bg-violet-500',
  thinking: 'bg-violet-500',
  tool: 'bg-amber-500',
  result: 'bg-emerald-500',
  error: 'bg-red-500',
}

export function SessionTimeline({ logs, loading }: SessionTimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set())

  const entries = deduplicateAndMergeEntries(parseLogs(logs || ''))

  // Auto-scroll to bottom when new entries appear
  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [entries.length])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" data-testid="timeline-loading">
        <Loader2 className="size-5 animate-spin-smooth text-primary/30" />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground/20 gap-3" data-testid="timeline-empty">
        <Terminal size={36} />
        <p className="text-[10px] font-bold uppercase tracking-[0.2em]">No session activity</p>
      </div>
    )
  }

  const toggleExpand = (idx: number) => {
    setExpandedEntries(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  return (
    <div className="h-full overflow-auto custom-scrollbar">
      <div className="relative p-4 pl-8" data-testid="session-timeline">
        {/* Vertical timeline line */}
        <div className="absolute left-5 top-4 bottom-4 w-0.5 bg-border/20" />

        <div className="space-y-3">
          {entries.map((entry) => {
            const isExpanded = expandedEntries.has(entry.idx)
            const dot = dotColor[entry.kind] || 'bg-muted-foreground'

            return (
              <div key={`${entry.idx}-${entry.kind}`} className="relative">
                {/* Timeline dot */}
                <div className={`absolute -left-[14px] top-2.5 size-2.5 rounded-full ${dot} ring-2 ring-background z-10`} />

                {/* Agent message */}
                {(entry.kind === 'agent' || entry.kind === 'thinking') && (
                  <div className={`rounded-lg border ${entry.kind === 'thinking' ? 'border-violet-500/20 bg-violet-500/5' : 'border-border/20 bg-card/80'} p-3`}>
                    {entry.kind === 'thinking' && (
                      <div className="text-[9px] font-bold uppercase tracking-widest text-violet-400/60 mb-1.5">Reasoning</div>
                    )}
                    <div className="prose prose-invert prose-sm max-w-none text-[12px] leading-relaxed prose-p:my-1 prose-p:text-foreground/90 prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[11px] prose-pre:bg-background prose-pre:border prose-pre:border-border/30 prose-pre:rounded-lg prose-li:text-foreground/80 prose-headings:text-foreground prose-headings:text-xs prose-strong:text-foreground">
                      <MarkdownRenderer content={entry.content} />
                    </div>
                    {entry.ts && <div className="text-[8px] font-mono text-muted-foreground/30 mt-2">{entry.ts}</div>}
                  </div>
                )}

                {/* Tool call — compact inline row */}
                {entry.kind === 'tool' && (
                  <div className="flex items-center gap-2 py-1.5" data-testid="tool-call">
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-400 shrink-0">[{entry.label}]</span>
                    <code className="text-[10px] font-mono text-foreground/60 truncate flex-1">{entry.content.replace(/"/g, '')}</code>
                    {entry.ts && <span className="text-[8px] font-mono text-muted-foreground/30 shrink-0">[{entry.ts}]</span>}
                  </div>
                )}

                {/* Tool result — collapsed by default */}
                {entry.kind === 'result' && (
                  <div className={`rounded-lg border overflow-hidden ${entry.status === 'error' ? 'border-red-500/20 bg-red-500/5' : 'border-border/15 bg-muted/5'}`}>
                    <button
                      onClick={() => toggleExpand(entry.idx)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
                      data-testid="result-toggle"
                    >
                      <span className={`text-[10px] font-mono truncate flex-1 ${entry.status === 'error' ? 'text-red-400/70' : 'text-foreground/40'}`}>
                        {entry.content.slice(0, 80)}{entry.content.length > 80 ? '...' : ''}
                      </span>
                      <ChevronDown size={10} className={`text-muted-foreground/40 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-2 pt-0" data-testid="result-expanded">
                        <pre className="text-[10px] text-foreground/60 leading-relaxed whitespace-pre-wrap max-h-40 overflow-auto custom-scrollbar font-mono rounded-lg bg-background/50 border border-border/20 p-2">{entry.content}</pre>
                      </div>
                    )}
                  </div>
                )}

                {/* Error */}
                {entry.kind === 'error' && (
                  <div className="flex items-center gap-2 py-1.5">
                    <span className="text-[10px] font-mono text-red-400/70">{entry.content}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
