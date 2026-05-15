import { type ReactNode } from 'react'
import { Loader2, Moon, Settings2, Sun, Download, AlertTriangle, RefreshCcw } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { periodFilters } from '@layout/types'

export function TopBar({
  sectionLabel: _sectionLabel,
  sectionTitle: _sectionTitle,
  theme,
  setTheme,
  activePeriod: _activePeriod,
  setActivePeriod: _setActivePeriod,
  refreshPending,
  configReady: _configReady,
  onOpenSettings,
  onRefresh,
  onSearch: _onSearch,
  onResultClick: _onResultClick,
  statusMessage: _statusMessage,
  errorMessage,
  generatedAt: _generatedAt,
  usePolling: _usePolling,
  onDownloadDiagnostics,
  onTogglePolling: _onTogglePolling,
  flush,
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
  onSearch?: (query: string) => Promise<unknown[]>
  onResultClick?: (issueIdentifier: string) => void
  statusMessage?: string
  errorMessage?: string
  generatedAt?: string
  usePolling?: boolean
  onDownloadDiagnostics?: () => void
  onTogglePolling?: () => void
  flush?: boolean
}) {

  return (
    <div className={flush ? 'space-y-2' : 'mb-4 space-y-2'}>
      <header className="flex h-10 w-full items-center justify-between bg-background/80 px-4 backdrop-blur-xl transition-all duration-300">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="flex-1 flex items-center overflow-hidden min-w-0">
            {errorMessage && (
              <div className="flex items-center gap-2.5 bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-1.5 text-[10px] font-bold text-red-500 animate-in fade-in slide-in-from-left-2 duration-500 shadow-sm truncate" role="alert" aria-live="assertive">
                <AlertTriangle className="size-3 shrink-0" />
                <span className="truncate tracking-tight">{errorMessage}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center gap-1 border-l border-border/50 pl-2 shrink-0">
            {onDownloadDiagnostics && (
              <IconButton icon={<Download className="size-3.5" />} title="System Diagnostics" onClick={onDownloadDiagnostics} />
            )}
            <IconButton icon={<Settings2 className="size-3.5" />} title="Control Plane Settings" onClick={onOpenSettings} />
            <IconButton
              icon={theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            />
            <IconButton
              icon={refreshPending
                ? <Loader2 className="size-3.5 animate-spin-smooth" />
                : <RefreshCcw className="size-3.5" />}
              title={refreshPending ? 'Syncing…' : 'Refresh'}
              onClick={onRefresh}
            />
          </div>
        </div>
      </header>
    </div>
  )
}

function IconButton({ icon, title, onClick }: { icon: ReactNode; title: string; onClick?: () => void }) {
  return (
    <AppTooltip content={title}>
      <button
        type="button"
        aria-label={title}
        onClick={onClick}
        className="grid size-7 place-items-center rounded-md bg-transparent text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        {icon}
      </button>
    </AppTooltip>
  )
}
