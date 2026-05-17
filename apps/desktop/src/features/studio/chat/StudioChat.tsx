import { useEffect, useRef } from 'react'
import { ChatComposer } from './ChatComposer'
import type { ChatMessage } from './useStudioSession'

export function StudioChat({
  messages,
  onSend,
  sendDisabled,
  runner,
}: {
  messages: ChatMessage[]
  onSend: (text: string) => void
  sendDisabled?: boolean
  runner: string
}) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <h2 className="text-sm font-medium">Studio</h2>
        <span className="text-xs text-muted-foreground">via {runner} agent</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Tell the agent what task you want to author. It can read your repo while it helps.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            {m.tool ? (
              <div className="inline-block text-xs bg-muted border border-border rounded px-2 py-1">
                <span className="text-muted-foreground">tool:</span> {m.tool.name}
              </div>
            ) : (
              <div
                className={`inline-block max-w-[80%] rounded-md p-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-primary/10 text-foreground' : 'bg-muted text-foreground'
                }`}
              >
                {m.text}
              </div>
            )}
          </div>
        ))}
        {sendDisabled && (
          <div className="text-left">
            <div className="inline-flex items-center gap-1.5 bg-muted rounded-md px-3 py-2 text-sm text-muted-foreground">
              <span className="animate-pulse">●</span>
              <span className="animate-pulse" style={{ animationDelay: '150ms' }}>●</span>
              <span className="animate-pulse" style={{ animationDelay: '300ms' }}>●</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <ChatComposer onSend={onSend} disabled={sendDisabled} />
    </div>
  )
}
