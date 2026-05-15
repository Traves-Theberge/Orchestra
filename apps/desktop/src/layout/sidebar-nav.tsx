import { memo, useRef, type KeyboardEvent } from 'react'
import type { SidebarItem } from '@layout/types'
import { getNextSidebarIndex } from '@core/utils/navigation'
import { AppTooltip } from '@ui/tooltip-wrapper'

export function SidebarNav({
  items,
  activeSection,
  onSectionChange,
}: {
  items: SidebarItem[]
  activeSection: string
  onSectionChange: (section: string) => void
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const handleNavKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextIndex = getNextSidebarIndex(event.key, index, items.length)
    if (nextIndex == null) {
      return
    }

    event.preventDefault()
    const target = items[nextIndex]
    if (!target) {
      return
    }
    onSectionChange(target.id)
    buttonRefs.current[nextIndex]?.focus()
  }

  return (
    <aside className="h-full w-12 shrink-0 bg-background border-r border-border/40 flex flex-col">
      <div className="flex flex-col items-center pt-3 pb-2">
        <span className="grid shrink-0 place-items-center text-foreground">
          <AppMonogramIcon className="size-8" />
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-2 px-1.5">
        <nav className="flex flex-col gap-1" aria-label="Primary navigation">
          {items.map((item, index) => {
            const ItemIcon = item.icon
            const active = activeSection === item.id
            return (
              <AppTooltip
                key={item.id}
                side="right"
                content={<NavTooltipContent label={item.label} description={item.description} />}
              >
                <button
                  type="button"
                  ref={(node) => {
                    buttonRefs.current[index] = node
                  }}
                  onClick={() => onSectionChange(item.id)}
                  onKeyDown={handleNavKeyDown(index)}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`sidebar-nav-${item.id}`}
                  className={`group relative flex justify-center items-center size-11 mx-auto rounded-xl transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    active
                      ? 'bg-gradient-to-r from-primary/[0.22] via-primary/[0.12] to-primary/[0.04] text-foreground shadow-[inset_0_0_0_1px] shadow-primary/20 ring-1 ring-primary/10'
                      : 'text-muted-foreground/85 hover:text-foreground hover:bg-foreground/[0.05] hover:shadow-[inset_0_0_0_1px] hover:shadow-foreground/[0.06]'
                  }`}
                >
                  <span
                    className={`relative grid place-items-center shrink-0 transition-all duration-200 size-9 rounded-lg ${
                      active
                        ? 'bg-primary/20 text-primary ring-1 ring-primary/25 shadow-[0_0_12px_-2px] shadow-primary/40'
                        : 'text-muted-foreground/75 bg-foreground/[0.02] group-hover:bg-foreground/[0.06] group-hover:text-foreground ring-1 ring-transparent group-hover:ring-foreground/[0.06]'
                    }`}
                  >
                    <ItemIcon
                      className="size-[17px]"
                      strokeWidth={active ? 2.4 : 1.9}
                    />
                  </span>
                </button>
              </AppTooltip>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}

const NavTooltipContent = memo(function NavTooltipContent({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-foreground">{label}</span>
      <span className="text-[8px] font-bold text-muted-foreground/70 normal-case tracking-normal">{description}</span>
    </div>
  )
})

function AppMonogramIcon({ className }: { className?: string }) {
  return (
    <img
      src="/Orchesta.png"
      alt="Orchestra"
      className={`${className ?? ''} dark:invert`}
      aria-hidden="true"
    />
  )
}
