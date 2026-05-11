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
    : status === 'empty' ? `${TOKENS.textInherit} text-foreground/30`
    : TOKENS.textValue

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left flex items-start gap-3 py-3 border-b border-border/[0.04] last:border-b-0 hover:bg-foreground/[0.015] -mx-3 px-3 rounded-md transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-foreground/60">{name}</span>
          {pillText && (
            <span className={`${TOKENS.pillBase} ${status === 'override' ? TOKENS.pillOverride : TOKENS.pillInherit}`}>
              {pillText}
            </span>
          )}
        </div>
        <div className={`${valueClass} mt-1 truncate`}>{value}</div>
        {hint && <div className={`${TOKENS.textMeta} mt-1`}>{hint}</div>}
      </div>
      <ChevronRight size={13} className="text-foreground/30 group-hover:text-foreground/60 shrink-0 mt-1" />
    </button>
  )
}
