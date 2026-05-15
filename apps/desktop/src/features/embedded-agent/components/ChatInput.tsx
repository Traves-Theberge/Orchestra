import { useState, useCallback, useRef, type KeyboardEvent } from 'react'
import { Send, Square } from 'lucide-react'
import { VoiceInput } from './VoiceInput'

interface ChatInputProps {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  disabled?: boolean
}

export function ChatInput({ onSend, onStop, isStreaming, disabled }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleTranscription = useCallback((text: string) => {
    setValue(prev => prev ? `${prev} ${text}` : text)
  }, [])

  return (
    <div className="px-4 pt-2.5 pb-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`
            }}
            onKeyDown={handleKeyDown}
            placeholder="Message Orchestra Agent..."
            disabled={disabled || isStreaming}
            className="w-full resize-none rounded-md bg-muted/30 pl-3 pr-9 py-2 text-[13px] outline-none transition-all placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/40 disabled:opacity-40"
            style={{ maxHeight: 120 }}
          />
          <div className="absolute right-1.5 inset-y-0 flex items-center">
            <VoiceInput onTranscription={handleTranscription} disabled={disabled || isStreaming} />
          </div>
        </div>

        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="grid size-9 shrink-0 place-items-center rounded-md bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
            aria-label="Stop"
          >
            <Square className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || !value.trim()}
            className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-primary/30 disabled:opacity-30 disabled:shadow-none disabled:cursor-not-allowed"
            aria-label="Send"
          >
            <Send className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
