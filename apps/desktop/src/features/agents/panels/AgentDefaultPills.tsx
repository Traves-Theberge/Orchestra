import { Check } from 'lucide-react'
import { HarnessIcon } from '@ui/HarnessIcon'
import { KNOWN_HARNESSES, isHarnessRegistered } from './harness-setup'

export function AgentDefaultPills({
  registered,
  activeDefaultId,
  savingDefault,
  disabled,
  onSelectDefault,
}: {
  registered: string[]
  activeDefaultId: string
  savingDefault: boolean
  disabled: boolean
  onSelectDefault: (id: string) => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-foreground">Default Agent</h3>
        <p className="text-xs text-muted-foreground">
          Default agent, command overrides, CLI arguments, and launch environment are client preferences. SSH and remote server launches still validate host availability at run time.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {KNOWN_HARNESSES.map((harness) => {
          const isDefault = activeDefaultId === harness.id
          const isReg = isHarnessRegistered(registered, harness.id)
          return (
            <button
              key={harness.id}
              type="button"
              onClick={() => {
                if (isReg && !isDefault) {
                  onSelectDefault(harness.id)
                }
              }}
              disabled={!isReg || disabled || savingDefault}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                isDefault
                  ? 'border-primary/50 bg-primary/15 text-primary shadow-xs'
                  : isReg
                    ? 'border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                    : 'border-border/30 bg-muted/20 text-muted-foreground/50 opacity-60 cursor-not-allowed'
              }`}
            >
              <HarnessIcon id={harness.id} size={14} />
              <span>{harness.label}</span>
              {isDefault && <Check className="size-3.5 stroke-[2.5]" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
