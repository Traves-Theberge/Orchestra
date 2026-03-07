import { useRef, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { SidebarItem } from '@/components/app-shell/types'
import { getNextSidebarIndex } from '@/lib/navigation'

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
  onSectionChange: (id: string) => void
  sidebarCollapsed: boolean
  onToggleCollapsed: () => void
  sidebarWidth: number
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])

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
      <button
        type="button"
        onClick={onToggleCollapsed}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute left-full top-6 z-20 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full border border-border bg-card text-foreground shadow-lg transition hover:bg-muted dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
      >
        {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>

      <div className="flex h-full flex-col py-4">
        <div className="mb-3 px-2">
          <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-foreground shadow-sm">
              <AppMonogramIcon className="h-6 w-6" />
            </span>
            {!sidebarCollapsed ? (
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-[0.2em] text-black dark:text-muted-foreground">Orchestra</p>
                <p className="truncate text-[11px] text-black/60 dark:text-muted-foreground">Control Plane</p>
              </div>
            ) : null}
          </div>
        </div>

        <nav className="space-y-1 px-2 pt-1" aria-label="Primary navigation">
          {items.map((item, index) => {
            const ItemIcon = item.icon
            const active = activeSection === item.id
            return (
              <button
                key={item.id}
                type="button"
                ref={(node) => {
                  buttonRefs.current[index] = node
                }}
                onClick={() => onSectionChange(item.id)}
                onKeyDown={handleNavKeyDown(index)}
                aria-current={active ? 'page' : undefined}
                aria-label={sidebarCollapsed ? item.label : undefined}
                className={`group relative flex w-full items-center gap-3 rounded-xl border px-2 py-2.5 text-left transition-all ${
                  sidebarCollapsed ? 'justify-center' : ''
                } ${
                  active
                    ? 'border-primary/20 bg-primary/10 text-primary shadow-sm dark:border-primary/30 dark:bg-primary/20'
                    : 'border-transparent text-foreground hover:border-border hover:bg-muted/50 dark:text-muted-foreground dark:hover:border-border dark:hover:bg-muted/70'
                }`}
              >
                {active ? <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-primary" /> : null}
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-background text-foreground group-hover:text-foreground shadow-sm">
                  <ItemIcon className="h-4 w-4" />
                </span>
                {!sidebarCollapsed ? (
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-black dark:text-foreground">{item.label}</span>
                    <span className="block truncate text-xs text-black/50 dark:text-muted-foreground">{item.description}</span>
                  </span>
                ) : null}
              </button>
            )
          })}
        </nav>
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
