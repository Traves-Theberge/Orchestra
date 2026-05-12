import { ChevronRight } from 'lucide-react'
import { TOKENS } from '../tokens'

type Status = 'set' | 'inherited' | 'override' | 'empty'

interface OverviewRowProps {
  name: string
  value: string
  status: Status
  pillText?: string
  hint?: string
  onClick: () => void
}

export function OverviewRow({ name, value, status, pillText, hint, onClick }: OverviewRowProps) {
  const valueClass =
    status === 'override' ? TOKENS.textOverride
    : status === 'inherited' ? TOKENS.textInherit
    : status === 'empty' ? 'text-sm italic text-muted-foreground/40'
    : TOKENS.textValue

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/40 transition-colors"
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className={TOKENS.textLabel}>{name}</span>
          {pillText && (
            <span className={`${TOKENS.pillBase} ${status === 'override' ? TOKENS.pillOverride : TOKENS.pillInherit}`}>
              {pillText}
            </span>
          )}
        </div>
        <div className={`${valueClass} truncate`}>{value}</div>
        {hint && <div className={TOKENS.textMeta}>{hint}</div>}
      </div>
      <ChevronRight size={14} className="text-muted-foreground/40 group-hover:text-foreground shrink-0" />
    </button>
  )
}
