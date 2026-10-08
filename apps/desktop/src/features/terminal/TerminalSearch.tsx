import { useState, useRef, useEffect } from 'react'
import { X, ChevronUp, ChevronDown, CaseSensitive, Regex } from 'lucide-react'
import type { ISearchOptions, SearchAddon } from '@xterm/addon-search'

// xterm requires #RRGGBB decoration colors.
const DECORATIONS: ISearchOptions['decorations'] = {
  matchBackground: '#3f3f46',
  matchOverviewRuler: '#a1a1aa',
  activeMatchBackground: '#10b981',
  activeMatchColorOverviewRuler: '#10b981',
}

interface TerminalSearchProps {
  searchAddon: SearchAddon | null
  onClose: () => void
}

export function TerminalSearch({ searchAddon, onClose }: TerminalSearchProps) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<{ index: number; count: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const options: ISearchOptions = { caseSensitive, regex, decorations: DECORATIONS }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!searchAddon) return
    const sub = searchAddon.onDidChangeResults(r => setResults({ index: r.resultIndex, count: r.resultCount }))
    return () => {
      sub.dispose()
      searchAddon.clearDecorations()
    }
  }, [searchAddon])

  useEffect(() => {
    if (!searchAddon) return
    if (!query) {
      searchAddon.clearDecorations()
      return
    }
    // Debounce typing so searching a large terminal buffer does not block each keystroke.
    const timer = window.setTimeout(() => {
      searchAddon.findNext(query, { caseSensitive, regex, decorations: DECORATIONS, incremental: true })
    }, 50)
    return () => window.clearTimeout(timer)
  }, [query, caseSensitive, regex, searchAddon])

  const findNext = () => searchAddon?.findNext(query, options)
  const findPrevious = () => searchAddon?.findPrevious(query, options)
  const status = !query ? '' : !results || results.count === 0 ? 'No matches' : results.index >= 0 ? `${results.index + 1} of ${results.count}` : `${results.count}+ matches`

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter') {
      if (e.shiftKey) findPrevious()
      else findNext()
    }
  }

  return (
    <div className="absolute top-2 right-2 z-50 flex items-center gap-1 bg-background border border-border rounded-md shadow-lg px-2 py-1">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        className="bg-transparent text-sm text-foreground outline-none w-48 placeholder:text-muted-foreground"
      />
      <span className="text-[10px] text-muted-foreground min-w-[70px] text-right">
        {status}
      </span>
      <button
        onClick={() => setCaseSensitive(!caseSensitive)}
        className={`p-1 rounded ${caseSensitive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        title="Case Sensitive"
      >
        <CaseSensitive size={14} />
      </button>
      <button
        onClick={() => setRegex(!regex)}
        className={`p-1 rounded ${regex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        title="Regex"
      >
        <Regex size={14} />
      </button>
      <button onClick={findPrevious} className="p-1 text-muted-foreground hover:text-foreground" title="Previous (Shift+Enter)">
        <ChevronUp size={14} />
      </button>
      <button onClick={findNext} className="p-1 text-muted-foreground hover:text-foreground" title="Next (Enter)">
        <ChevronDown size={14} />
      </button>
      <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground" title="Close (Escape)">
        <X size={14} />
      </button>
    </div>
  )
}
