import { TOKENS } from '../tokens'

interface PanelHeaderProps {
  eyebrow: string
  title: string
  sub?: string
  dirty?: boolean
  rightSlot?: React.ReactNode
}

export function PanelHeader({ eyebrow, title, sub, dirty, rightSlot }: PanelHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 pb-3 mb-3 border-b border-dashed border-border/30">
      <div className="min-w-0 flex-1">
        <div className={TOKENS.textEyebrow}>{eyebrow}</div>
        <div className="flex items-center gap-2 mt-1">
          <h2 className={`${TOKENS.textTitle} truncate`}>{title}</h2>
          {dirty && (
            <span className={`${TOKENS.pillBase} ${TOKENS.pillUnsaved} animate-pulse`}>Unsaved</span>
          )}
        </div>
        {sub && (
          <p data-testid="panel-header-sub" className={`${TOKENS.textSub} mt-1`}>{sub}</p>
        )}
      </div>
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </header>
  )
}
