import { TOKENS } from '../tokens'

interface InheritedFieldProps {
  inherited: boolean
  inheritedValue: string | null
  onSetHere: () => void
  children: React.ReactNode
}

export function InheritedField({ inherited, inheritedValue, onSetHere, children }: InheritedFieldProps) {
  if (!inherited) return <>{children}</>
  return (
    <div className="group flex items-center gap-3 h-9 px-3 rounded-md border border-dashed border-border/30 bg-foreground/[0.015]">
      <span className={`${TOKENS.textInherit} not-italic text-[10px] uppercase tracking-wider text-foreground/30`}>
        inherits from global
      </span>
      <span className={`${TOKENS.textInherit} flex-1 truncate`}>
        {inheritedValue ?? '—'}
      </span>
      <button
        type="button"
        onClick={onSetHere}
        className="text-[10px] text-accent/80 hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
      >
        Set here
      </button>
    </div>
  )
}
