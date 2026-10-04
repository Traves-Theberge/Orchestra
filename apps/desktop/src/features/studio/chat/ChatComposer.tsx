import { useState, useCallback, useRef, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'

export function ChatComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const submit = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, disabled, onSend])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }, [submit])

  return (
    <div className="px-4 pt-2.5 pb-4">
      <div className="flex items-center gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const el = e.target
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`
          }}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want to task out…"
          disabled={disabled}
          className="flex-1 resize-none rounded-md bg-muted/30 px-3 py-2 text-[13px] outline-none transition-all placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/40 disabled:opacity-40"
          style={{ maxHeight: 120 }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim()}
          aria-label="Send"
          className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-primary/30 disabled:opacity-30 disabled:shadow-none disabled:cursor-not-allowed"
        >
          <Send className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
