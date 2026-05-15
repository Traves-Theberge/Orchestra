import { X, Sparkles } from 'lucide-react'
import type { ContextSuggestion } from '../hooks/use-context-suggestions'

interface ContextSuggestionsProps {
  suggestions: ContextSuggestion[]
  onDismiss: (id: string) => void
  onAction: (action: string, params: Record<string, unknown>) => void
}

/**
 * Displays dismissible suggestion chips at the top of the chat panel.
 * Suggestions are context-aware based on the current UI section.
 */
export function ContextSuggestions({ suggestions, onDismiss, onAction }: ContextSuggestionsProps) {
  if (suggestions.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 px-3 pt-2">
      <Sparkles className="size-3 text-primary/40 shrink-0 mt-0.5" />
      {suggestions.map((s) => (
        <button
          key={s.id}
          onClick={() => onAction(s.action, s.params || {})}
          className="group inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[10px] text-foreground/70 transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-foreground"
        >
          <span>{s.text}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onDismiss(s.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
                onDismiss(s.id)
              }
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="size-2.5" />
          </span>
        </button>
      ))}
    </div>
  )
}
