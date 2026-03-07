import type { ReactNode } from 'react'
import { Moon, Search, Settings2, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { periodFilters } from '@/components/app-shell/types'

export function TopBar({
  sectionLabel,
  sectionTitle,
  theme,
  setTheme,
  activePeriod,
  setActivePeriod,
  refreshPending,
  configReady,
  onOpenSettings,
  onRefresh,
}: {
  sectionLabel: string
  sectionTitle: string
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
  activePeriod: (typeof periodFilters)[number]
  setActivePeriod: (period: (typeof periodFilters)[number]) => void
  refreshPending: boolean
  configReady: boolean
  onOpenSettings: () => void
  onRefresh: () => Promise<void>
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-[220px]">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">{sectionLabel}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground dark:text-foreground">{sectionTitle}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 lg:flex-nowrap">
        <div className="flex h-9 items-center gap-1 rounded-full bg-muted p-1 dark:bg-muted" role="group" aria-label="Time range filter">
          {periodFilters.map((period) => (
            <button
              key={period}
              type="button"
              onClick={() => setActivePeriod(period)}
              aria-pressed={activePeriod === period}
              className={`rounded-full px-3 py-1 text-xs transition ${
                activePeriod === period
                  ? 'bg-card text-foreground shadow-sm dark:bg-card dark:text-foreground'
                  : 'text-muted-foreground hover:bg-card/50 hover:text-foreground dark:text-muted-foreground dark:hover:bg-card/30 dark:hover:text-foreground'
              }`}
            >
              {period}
            </button>
          ))}
        </div>

        <div
          className="flex h-9 min-w-56 items-center gap-2 rounded-full bg-muted px-3 text-muted-foreground shadow-inner shadow-black/5 dark:bg-muted dark:text-muted-foreground dark:shadow-black/20"
          role="search"
          aria-label="Issue search placeholder"
        >
          <Search className="h-4 w-4" />
          <span className="text-xs">Search issues...</span>
          <span className="ml-auto rounded bg-card/80 px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm dark:bg-muted/70 dark:text-muted-foreground">/</span>
        </div>

        <div className="flex items-center gap-2">
          <IconButton icon={<Settings2 className="h-4 w-4" />} title="Settings" onClick={onOpenSettings} />
        </div>

        <Button
          size="sm"
          className="h-9 rounded-full bg-muted px-4 text-foreground hover:bg-muted/80 dark:bg-muted dark:text-foreground dark:hover:bg-muted/80"
          onClick={() => void onRefresh()}
          disabled={refreshPending || !configReady}
        >
          {refreshPending ? 'Refreshing...' : 'Refresh'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-full border-transparent bg-muted px-3 text-foreground hover:bg-muted/80 dark:bg-muted dark:text-foreground dark:hover:bg-muted/80"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle light/dark mode"
          aria-label="Toggle light and dark mode"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  )
}

function IconButton({ icon, title, onClick }: { icon: ReactNode; title: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-full bg-muted text-foreground transition hover:bg-muted/80 dark:bg-muted dark:text-foreground dark:hover:bg-muted/80"
    >
      {icon}
    </button>
  )
}
