import { TOKENS } from '../tokens'

interface PanelHeaderProps {
  /** @deprecated eyebrow is no longer rendered; left for backward compatibility with existing callers. */
  eyebrow?: string
  title: string
  sub?: string
  dirty?: boolean
  rightSlot?: React.ReactNode
}

export function PanelHeader({ title, sub, dirty, rightSlot }: PanelHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 pb-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <h2 className={`${TOKENS.textTitle} truncate`}>{title}</h2>
          {dirty && (
            <span className={`${TOKENS.pillBase} ${TOKENS.pillUnsaved}`}>Unsaved</span>
          )}
        </div>
        {sub && (
          <p data-testid="panel-header-sub" className={TOKENS.textSub}>{sub}</p>
        )}
      </div>
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </header>
  )
}
