import { useState } from 'react'
import { Check, Copy, Sparkles } from 'lucide-react'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'
import type { WorkspaceChatMessage } from '@core/api/client'

export function ChatMessage({ message, provider, projectId }: {
  message: WorkspaceChatMessage; provider: string; projectId: string
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const user = message.role === 'user'
  const copy = async () => {
    try { await navigator.clipboard.writeText(message.text); setCopyState('copied') }
    catch { setCopyState('failed') }
  }
  return <article data-chat-message={message.role} className={`group/message min-w-0 ${user ? 'ml-auto max-w-[92%] rounded-2xl border border-border/30 bg-muted/40 px-4 py-3' : 'py-2'}`}>
    <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
      {!user && message.role !== 'system' && <Sparkles className="size-3.5 text-primary/80" />}
      <span className={!user ? 'capitalize text-foreground/80' : ''}>{user ? 'You' : message.role === 'system' ? 'Session' : provider}</span>
      {message.status !== 'completed' && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{message.status}</span>}
    </div>
    {user ? <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{message.text}</p> : <MarkdownRenderer content={message.text} linkProjectId={projectId} enableMermaid={false} className="break-words text-[15px] leading-7 [&_p]:my-3 [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border/50 [&_pre]:bg-muted/30 [&_pre]:px-4 [&_pre]:py-5 [&_table]:block [&_table]:overflow-auto" />}
    {!user && <div className="mt-2 flex items-center gap-2"><button aria-label="Copy response" onClick={() => void copy()} title={copyState === 'copied' ? 'Copied' : 'Copy response'} className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{copyState === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</button>{copyState === 'failed' && <span role="status" className="text-[10px] text-muted-foreground">Could not copy response.</span>}</div>}
  </article>
}
