import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, Moon, Search, Settings2, Sun, Activity, Download, AlertTriangle, RefreshCcw } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Button } from '@/components/ui/button'
import { AppTooltip } from '@/components/ui/tooltip-wrapper'
import { Badge } from '@/components/ui/badge'
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
  onSearch,
  onResultClick,
  statusMessage,
  errorMessage,
  generatedAt,
  usePolling,
  onDownloadDiagnostics,
  onTogglePolling,
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
  onSearch?: (query: string) => Promise<any[]>
  onResultClick?: (issueIdentifier: string) => void
  statusMessage?: string
  errorMessage?: string
  generatedAt?: string
  usePolling?: boolean
  onDownloadDiagnostics?: () => void
  onTogglePolling?: () => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searchPending, setSearchPending] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.trim().length >= 2 && onSearch) {
        setSearchPending(true)
        try {
          const results = await onSearch(searchQuery)
          setSearchResults(results)
          setShowResults(true)
        } catch {
          setSearchResults([])
        } finally {
          setSearchPending(false)
        }
      } else {
        setSearchResults([])
        setShowResults(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, onSearch])

  return (
    <div className="mb-2 space-y-1">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="min-w-[180px]">
            <h1 className="text-lg font-black tracking-tight text-foreground dark:text-foreground leading-none">{sectionTitle}</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">{sectionLabel}</p>
              {generatedAt && (
                <>
                  <span className="text-muted-foreground/30">•</span>
                  <AppTooltip content="Last snapshot timestamp">
                    <span className="text-[10px] font-medium text-muted-foreground/70">
                      {generatedAt}
                    </span>
                  </AppTooltip>
                </>
              )}
            </div>
          </div>

          {onTogglePolling !== undefined && usePolling !== undefined && (
            <Tooltip.Provider delayDuration={300}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={onTogglePolling}
                    className="flex items-center gap-1.5 rounded-full border border-border/50 bg-card px-2 py-0.5 shadow-sm transition hover:bg-muted/50"
                  >
                    <div className={`h-1.5 w-1.5 rounded-full ${usePolling ? 'bg-amber-500' : 'bg-primary animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]'}`} />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      {usePolling ? 'Polling' : 'Live'}
                    </span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="z-[110] select-none rounded-md bg-zinc-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest leading-none text-zinc-50 shadow-[0_10px_38px_-10px_rgba(22,_23,_24,_0.35),_0_10px_20px_-15px_rgba(22,_23,_24,_0.2)] animate-in fade-in zoom-in-95 dark:bg-zinc-100 dark:text-zinc-900"
                    sideOffset={5}
                  >
                    {usePolling ? 'Switch to live stream (SSE)' : 'Switch to manual polling'}
                    <Tooltip.Arrow className="fill-zinc-900 dark:fill-zinc-100" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          )}

          <div className="flex-1 flex items-center px-2 overflow-hidden min-w-0">
            {statusMessage && (
              <div className="flex items-center gap-2 text-[11px] font-medium text-primary animate-in fade-in slide-in-from-left-2 duration-300 truncate" role="status" aria-live="polite">
                <Activity className="h-3 w-3 shrink-0" />
                <span className="truncate">{statusMessage}</span>
              </div>
            )}
            {errorMessage && !statusMessage && (
              <div className="flex items-center gap-2 text-[11px] font-medium text-red-500 animate-in fade-in slide-in-from-left-2 duration-300 truncate" role="alert" aria-live="assertive">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="truncate">{errorMessage}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap shrink-0">
          <div className="relative" ref={searchRef}>
            <div
              className="flex h-9 min-w-[200px] items-center gap-2 rounded-full bg-muted/50 px-3 text-muted-foreground border border-transparent shadow-inner transition-colors focus-within:bg-muted/80 focus-within:border-primary/20"
              role="search"
            >
              {searchPending ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Search className="h-4 w-4" />}
              <input
                type="text"
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                placeholder="Search issues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery.trim().length >= 2 && setShowResults(true)}
              />
              <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded bg-card px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100 shadow-sm border border-border/50 uppercase">
                <span className="text-[11px]">⌘</span>K
              </kbd>
            </div>

            {showResults && searchResults.length > 0 && (
              <div className="absolute top-full right-0 z-50 mt-2 w-[300px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-100">
                <div className="max-h-[300px] overflow-auto py-1">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => {
                        onResultClick?.(result.identifier)
                        setShowResults(false)
                        setSearchQuery('')
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold text-primary">{result.identifier}</span>
                        <span className="truncate text-xs font-medium text-foreground">{result.title}</span>
                      </div>
                      <span className="truncate text-[10px] text-muted-foreground/60">{result.state}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-l border-border/50 pl-3 ml-1">
            {onDownloadDiagnostics && (
              <IconButton icon={<Download className="h-4 w-4" />} title="Download Diagnostics" onClick={onDownloadDiagnostics} />
            )}
            <IconButton icon={<Settings2 className="h-4 w-4" />} title="Settings" onClick={onOpenSettings} />
            <IconButton
              icon={theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              title="Toggle theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            />
            <Button
              onClick={onRefresh}
              disabled={refreshPending}
              className="h-9 rounded-full bg-primary px-4 font-bold uppercase tracking-widest text-[10px] text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0"
            >
              {refreshPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5" />
              ) : (
                <Activity className="mr-2 h-3.5 w-3.5" />
              )}
              {refreshPending ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        </div>
      </header>
    </div>
  )
}

function IconButton({ icon, title, onClick }: { icon: ReactNode; title: string; onClick?: () => void }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={title}
            onClick={onClick}
            className="grid h-7 w-7 place-items-center rounded-md bg-transparent text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {icon}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="z-[110] select-none rounded-md bg-zinc-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest leading-none text-zinc-50 shadow-[0_10px_38px_-10px_rgba(22,_23,_24,_0.35),_0_10px_20px_-15px_rgba(22,_23,_24,_0.2)] animate-in fade-in zoom-in-95 dark:bg-zinc-100 dark:text-zinc-900"
            sideOffset={5}
          >
            {title}
            <Tooltip.Arrow className="fill-zinc-900 dark:fill-zinc-100" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
