import { useMemo, useRef, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import type { SidebarItem } from '@/components/app-shell/types'
import { getNextSidebarIndex } from '@/lib/navigation'
import { AppTooltip } from '../ui/tooltip-wrapper'

export function SidebarNav({
  items,
  activeSection,
  onSectionChange,
  sidebarCollapsed,
  onToggleCollapsed,
  sidebarWidth,
}: {
  items: SidebarItem[]
  activeSection: string
  onSectionChange: (section: string) => void
  sidebarCollapsed: boolean
  onToggleCollapsed: () => void
  sidebarWidth: number
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const osOptions = useMemo(() => ({
    scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
    overflow: { x: 'hidden' as const, y: 'scroll' as const }
  }), [])

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
    <aside
      className="relative h-full border-r border-border bg-card shadow-[10px_0_40px_rgba(0,0,0,0.04)] transition-all duration-300 dark:border-border dark:bg-background dark:shadow-[10px_0_40px_rgba(0,0,0,0.2)]"
      style={{ width: `${sidebarWidth}px` }}
    >
      <AppTooltip 
        side="right" 
        content={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="absolute left-full top-6 z-20 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full border border-border bg-card text-foreground shadow-lg transition hover:bg-muted dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
        >
          {sidebarCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>
      </AppTooltip>

      <div className="flex h-full flex-col py-3">
        <div className="mb-2 px-2">
          <div className={`flex items-center gap-2 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-background text-foreground shadow-sm">
              <AppMonogramIcon className="h-4 w-4" />
            </span>
            {!sidebarCollapsed ? (
              <div className="min-w-0">
                <p className="truncate text-[9px] font-bold uppercase tracking-[0.15em] text-black dark:text-muted-foreground leading-none">Orchestra</p>
                <p className="truncate text-[8px] text-black/40 dark:text-muted-foreground mt-0.5">Control Plane</p>
              </div>
            ) : null}
          </div>
        </div>

        <OverlayScrollbarsComponent
          element="div"
          options={osOptions}
          className="flex-1 px-2 pt-1 min-h-0"
        >
          <nav className="space-y-0.5" aria-label="Primary navigation">
            {items.map((item, index) => {
              const ItemIcon = item.icon
              const active = activeSection === item.id
              return (
                <AppTooltip 
                  key={item.id}
                  side="right"
                  content={
                    <div className="flex flex-col gap-0.5">
                      <span className="text-foreground">{item.label}</span>
                      <span className="text-[8px] font-bold text-muted-foreground/70 normal-case tracking-normal">{item.description}</span>
                    </div>
                  }
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
                    className={`group relative flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-all duration-300 ${sidebarCollapsed ? 'justify-center' : ''
                      } ${active
                        ? 'border-primary/30 bg-primary/10 text-primary shadow-[0_0_15px_rgba(var(--primary),0.1)]'
                        : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                  >
                    {active ? <span className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.6)]" /> : null}
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-all duration-300 ${
                      active ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'bg-muted/50 text-muted-foreground group-hover:bg-muted group-hover:text-foreground'
                    }`}>
                      <ItemIcon className="h-3.5 w-3.5" />
                    </span>
                    {!sidebarCollapsed ? (
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[11px] font-bold tracking-tight ${active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>{item.label}</span>
                        <span className="block truncate text-[9px] text-muted-foreground/60 leading-tight font-medium">{item.description}</span>
                      </span>
                    ) : null}
                  </button>
                </AppTooltip>
              )
            })}
          </nav>
        </OverlayScrollbarsComponent>
      </div>
    </aside>
  )
}

function AppMonogramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" role="img">
      <defs>
        <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="hsl(var(--primary) / 0.6)" />
        </linearGradient>
      </defs>
      {/* Outer ring segments */}
      <circle
        cx="32"
        cy="32"
        r="24"
        fill="none"
        stroke="url(#logo-gradient)"
        strokeWidth="6"
        strokeDasharray="110 40"
        strokeLinecap="round"
        transform="rotate(-10 32 32)"
      />
      {/* Inner geometric diamond */}
      <rect
        x="24"
        y="24"
        width="16"
        height="16"
        rx="3"
        fill="url(#logo-gradient)"
        transform="rotate(45 32 32)"
      />
      {/* Center point */}
      <circle cx="32" cy="32" r="3" fill="white" fillOpacity="0.9" />
    </svg>
  )
}
