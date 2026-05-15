import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CaseSensitive, WholeWord, Regex, Loader2, File } from 'lucide-react'
import { useAppStore } from '@core/store'
import type { SearchResultGroup } from '@core/store/types'

type FlatRow =
  | { type: 'file-header'; file: string; relativePath: string; matchCount: number }
  | { type: 'match'; file: string; relativePath: string; line: number; text: string }

function flattenResults(groups: SearchResultGroup[]): FlatRow[] {
  const rows: FlatRow[] = []
  for (const group of groups) {
    rows.push({
      type: 'file-header',
      file: group.file,
      relativePath: group.relativePath,
      matchCount: group.matches.length,
    })
    for (const match of group.matches) {
      rows.push({
        type: 'match',
        file: group.file,
        relativePath: group.relativePath,
        line: match.line,
        text: match.text,
      })
    }
  }
  return rows
}

export function WorkspaceSearch() {
  const explorerRoot = useAppStore((s) => s.explorerRoot)
  const activeLeftPanel = useAppStore((s) => s.activeLeftPanel)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const searchResults = useAppStore((s) => s.searchResults)
  const searchLoading = useAppStore((s) => s.searchLoading)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const setSearchResults = useAppStore((s) => s.setSearchResults)
  const setSearchLoading = useAppStore((s) => s.setSearchLoading)
  const openFile = useAppStore((s) => s.openFile)

  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  // Auto-focus input when search panel becomes active
  useEffect(() => {
    if (activeLeftPanel === 'search') {
      // Small delay to ensure the panel is rendered
      const timer = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [activeLeftPanel])

  // Debounced search execution
  useEffect(() => {
    if (!searchQuery.trim() || !explorerRoot) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const raw = await window.orchestraDesktop.fs.search(explorerRoot, searchQuery, {
          caseSensitive,
          wholeWord,
          regex: useRegex,
        })
        setSearchResults(raw)
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, caseSensitive, wholeWord, useRegex, explorerRoot])

  const flatRows = useMemo(() => flattenResults(searchResults), [searchResults])

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (flatRows[index]?.type === 'file-header' ? 28 : 22),
    overscan: 20,
  })

  const totalMatches = useMemo(
    () => searchResults.reduce((sum, g) => sum + g.matches.length, 0),
    [searchResults],
  )

  const rootBasename = explorerRoot ? explorerRoot.split('/').pop() || explorerRoot : null

  return (
    <div className="flex flex-col h-full">
      {/* Scope indicator */}
      {rootBasename && (
        <div className="px-3 pt-2 pb-1 text-[10px] text-muted-foreground truncate">
          Searching in {rootBasename}
        </div>
      )}

      {/* Search input + toggles */}
      <div className="px-2 pb-2 flex flex-col gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files..."
          className="w-full px-2 py-1 text-xs bg-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex items-center gap-1">
          <button
            className={`p-1 rounded text-[10px] font-mono transition-colors ${
              caseSensitive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
            onClick={() => setCaseSensitive(!caseSensitive)}
            title="Match Case"
            aria-label="Match Case"
          >
            <CaseSensitive className="size-3.5" />
          </button>
          <button
            className={`p-1 rounded text-[10px] font-mono transition-colors ${
              wholeWord
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
            onClick={() => setWholeWord(!wholeWord)}
            title="Match Whole Word"
            aria-label="Match Whole Word"
          >
            <WholeWord className="size-3.5" />
          </button>
          <button
            className={`p-1 rounded text-[10px] font-mono transition-colors ${
              useRegex
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
            onClick={() => setUseRegex(!useRegex)}
            title="Use Regular Expression"
            aria-label="Use Regular Expression"
          >
            <Regex className="size-3.5" />
          </button>

          {/* Results summary */}
          {searchQuery.trim() && !searchLoading && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {totalMatches} result{totalMatches !== 1 ? 's' : ''} in {searchResults.length} file
              {searchResults.length !== 1 ? 's' : ''}
            </span>
          )}
          {searchLoading && (
            <Loader2 className="ml-auto size-3 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Results area */}
      <div ref={parentRef} className="flex-1 min-h-0 overflow-auto">
        {!searchQuery.trim() ? (
          <p className="text-xs text-muted-foreground px-3 py-2">Type to search</p>
        ) : !searchLoading && flatRows.length === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-2">No results</p>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index]
              if (row.type === 'file-header') {
                return (
                  <div
                    key={`header-${row.file}`}
                    className="flex items-center gap-1.5 px-3 text-xs font-semibold text-foreground truncate"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <File className="size-3 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate">{row.relativePath}</span>
                    <span className="ml-auto flex-shrink-0 text-[10px] font-normal text-muted-foreground bg-accent rounded px-1">
                      {row.matchCount}
                    </span>
                  </div>
                )
              }

              return (
                <button
                  key={`match-${row.file}-${row.line}`}
                  className="flex items-center gap-2 px-3 pl-7 text-xs w-full text-left hover:bg-accent/50 cursor-pointer truncate"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => openFile(row.file, row.relativePath, row.line)}
                >
                  <span className="text-muted-foreground w-8 flex-shrink-0 text-right tabular-nums">
                    {row.line}
                  </span>
                  <span className="truncate text-foreground">{row.text}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
