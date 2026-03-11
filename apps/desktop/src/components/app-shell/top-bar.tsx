import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, Moon, Search, Settings2, Sun, Activity, Download, AlertTriangle, RefreshCcw } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Button } from '@/components/ui/button'
import { AppTooltip } from '@/components/ui/tooltip-wrapper'
import { Badge } from '@/components/ui/badge'
import { periodFilters } from '@/components/app-shell/types'
import { usePlatform } from '@/hooks/use-platform'

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
  const { isMac } = usePlatform()
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
    <div className="mb-4 space-y-2">
      <header className="flex h-14 w-full items-center justify-between border-b border-border/40 bg-background/80 px-4 backdrop-blur-xl transition-all duration-300">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="shrink-0 flex flex-col justify-center">
            <h1 className="text-base font-black tracking-tight text-foreground leading-none">{sectionTitle}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[8px] h-3.5 px-1 font-black uppercase tracking-[0.1em] border-primary/20 text-primary/70 bg-primary/5">
                {sectionLabel}
              </Badge>
              {generatedAt && (
                <AppTooltip content="Snapshot timestamp">
                  <span className="text-[9px] font-mono text-muted-foreground/40 tabular-nums">
                    {generatedAt}
                  </span>
                </AppTooltip>
              )}
            </div>
          </div>

          <div className="h-6 w-[1px] bg-border/40 mx-1 shrink-0" />

          {onTogglePolling !== undefined && usePolling !== undefined && (
            <AppTooltip content={usePolling ? 'Switch to live stream (SSE)' : 'Switch to manual polling'}>
              <button
                onClick={onTogglePolling}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-all duration-300 ${
                  usePolling 
                    ? 'border-amber-500/20 bg-amber-500/5 text-amber-500' 
                    : 'border-primary/20 bg-primary/5 text-primary shadow-[0_0_10px_rgba(var(--primary),0.1)]'
                }`}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${usePolling ? 'bg-amber-500' : 'bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.6)]'}`} />
                <span className="text-[9px] font-black uppercase tracking-widest">
                  {usePolling ? 'Polling' : 'Live'}
                </span>
              </button>
            </AppTooltip>
          )}

          <div className="flex-1 flex items-center px-4 overflow-hidden min-w-0">
            {statusMessage && (
              <div className="flex items-center gap-2.5 bg-primary/5 border border-primary/10 rounded-lg px-3 py-1.5 text-[10px] font-bold text-primary animate-in fade-in slide-in-from-left-2 duration-500 shadow-sm" role="status" aria-live="polite">
                <Activity className="h-3 w-3 shrink-0" />
                <span className="truncate tracking-tight">{statusMessage}</span>
              </div>
            )}
            {errorMessage && !statusMessage && (
              <div className="flex items-center gap-2.5 bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-1.5 text-[10px] font-bold text-red-500 animate-in fade-in slide-in-from-left-2 duration-500 shadow-sm truncate" role="alert" aria-live="assertive">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="truncate tracking-tight">{errorMessage}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-4">
          <div className="relative group" ref={searchRef}>
            <div
              className="flex h-8 min-w-[220px] items-center gap-2 rounded-xl bg-muted/30 px-3 text-muted-foreground border border-border/50 shadow-inner transition-all duration-300 focus-within:bg-background focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10"
              role="search"
            >
              {searchPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <Search className="h-3.5 w-3.5 group-focus-within:text-primary transition-colors" />}
              <input
                type="text"
                className="w-full bg-transparent text-[11px] font-medium text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                placeholder="Universal Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery.trim().length >= 2 && setShowResults(true)}
              />
              <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded bg-muted border border-border/50 px-1.5 font-mono text-[9px] font-black text-muted-foreground/60 shadow-sm uppercase">
                <span className="text-[10px]">{isMac ? '⌘' : 'Ctrl'}</span>K
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

          <div className="flex items-center gap-1 border-l border-border/50 pl-2 ml-1">
            {onDownloadDiagnostics && (
              <IconButton icon={<Download className="h-3.5 w-3.5" />} title="System Diagnostics" onClick={onDownloadDiagnostics} />
            )}
            <IconButton icon={<Settings2 className="h-3.5 w-3.5" />} title="Control Plane Settings" onClick={onOpenSettings} />
            <IconButton
              icon={theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            />
            <Button
              onClick={onRefresh}
              disabled={refreshPending}
              className={`h-8 rounded-xl px-4 font-black uppercase tracking-[0.1em] text-[9px] shadow-lg transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 ${
                refreshPending 
                  ? 'bg-muted text-muted-foreground' 
                  : 'bg-primary text-primary-foreground shadow-primary/20 hover:shadow-primary/30 hover:bg-primary/90'
              }`}
            >
              {refreshPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-3.5 w-3.5" />
              )}
              {refreshPending ? 'Syncing...' : 'Sync Data'}
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
            className="z-[110] select-none rounded-lg bg-popover border border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest leading-none text-popover-foreground shadow-xl animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 !opacity-100 block"
            sideOffset={5}
            style={{ backgroundColor: 'hsl(var(--popover))' }}
          >
            {title}
            <Tooltip.Arrow className="fill-popover" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
