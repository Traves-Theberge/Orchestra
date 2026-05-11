import type { Scope } from '../types'

interface ScopeToggleProps {
  scope: Scope
  projectName: string | null
  onChange: (next: Scope) => void
}

export function ScopeToggle({ scope, projectName, onChange }: ScopeToggleProps) {
  if (!projectName) {
    return (
      <div className="text-[10px] font-mono uppercase tracking-wider text-foreground/40 px-2">
        Global only
      </div>
    )
  }
  return (
    <div role="group" className="inline-flex h-7 rounded-md border border-border/40 overflow-hidden text-[10.5px]">
      <button
        type="button"
        aria-pressed={scope === 'GLOBAL'}
        onClick={() => onChange('GLOBAL')}
        className={`px-3 ${scope === 'GLOBAL'
          ? 'bg-foreground/10 text-foreground font-medium'
          : 'text-foreground/50 hover:text-foreground/80'}`}
      >
        Global
      </button>
      <button
        type="button"
        aria-pressed={scope === 'PROJECT'}
        onClick={() => onChange('PROJECT')}
        className={`px-3 border-l border-border/40 ${scope === 'PROJECT'
          ? 'bg-accent/15 text-accent font-medium'
          : 'text-foreground/50 hover:text-foreground/80'}`}
      >
        {projectName}
      </button>
    </div>
  )
}
