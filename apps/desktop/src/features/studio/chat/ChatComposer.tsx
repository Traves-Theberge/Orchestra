import { useState } from 'react'
import { Button } from '@ui/button'

export function ChatComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void
  disabled?: boolean
}) {
  const [text, setText] = useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div className="border-t border-border p-3 flex gap-2 items-end">
      <textarea
        rows={2}
        className="flex-1 bg-transparent border border-border rounded-md p-2 outline-none focus:border-ring resize-none text-sm placeholder:text-muted-foreground"
        placeholder="Describe what you want to task out… (Ctrl+Enter to send)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }}
      />
      <Button
        type="button"
        onClick={submit}
        disabled={disabled || !text.trim()}
        size="sm"
      >
        Send
      </Button>
    </div>
  )
}
