import { useState } from 'react'
import { HtmlRenderFrame } from './HtmlRenderFrame'
import type { HtmlRenderReference } from './htmlRender'

interface HtmlRenderVariantsProps {
  readonly renders: readonly HtmlRenderReference[]
  readonly onRegenerate?: (index: number, render: HtmlRenderReference) => void
  readonly onImplement?: (index: number, render: HtmlRenderReference) => void
  readonly actionsDisabled?: boolean
}

/**
 * One reply's HTML renders as selectable variants, with Regenerate and
 * Implement acting on the selected one.
 */
export function HtmlRenderVariants({ renders, onRegenerate, onImplement, actionsDisabled = false }: HtmlRenderVariantsProps) {
  const [selected, setSelected] = useState(0)
  if (renders.length === 0) return null
  const index = Math.min(selected, renders.length - 1)
  const render = renders[index]!
  const showTabs = renders.length > 1
  const showActions = Boolean(onRegenerate || onImplement)

  return (
    <div data-testid="html-render-variants">
      {(showTabs || showActions) && (
        <div className="flex flex-wrap items-center gap-2">
          {showTabs && (
            <div role="tablist" aria-label="Visualization variants" className="flex flex-wrap items-center gap-1">
              {renders.map((variant, variantIndex) => {
                const active = variantIndex === index
                return (
                  <button
                    key={variantIndex}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-description={variant.title}
                    onClick={() => setSelected(variantIndex)}
                    className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                      active
                        ? 'border-border bg-muted text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    Variant #{variantIndex + 1}
                  </button>
                )
              })}
            </div>
          )}
          {showActions && (
            <div className="ml-auto flex items-center gap-2">
              {onRegenerate && (
                <button
                  type="button"
                  disabled={actionsDisabled}
                  onClick={() => onRegenerate(index, render)}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  Regenerate
                </button>
              )}
              {onImplement && (
                <button
                  type="button"
                  disabled={actionsDisabled}
                  onClick={() => onImplement(index, render)}
                  className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  Implement
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div key={index}>
        <HtmlRenderFrame htmlRender={render} />
      </div>
    </div>
  )
}
