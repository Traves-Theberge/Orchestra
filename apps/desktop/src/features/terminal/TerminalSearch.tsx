import { useState, useRef, useEffect } from 'react'
import { X, ChevronUp, ChevronDown, CaseSensitive, Regex } from 'lucide-react'
import type { SearchAddon } from '@xterm/addon-search'

interface TerminalSearchProps {
  searchAddon: SearchAddon | null
  onClose: () => void
}

export function TerminalSearch({ searchAddon, onClose }: TerminalSearchProps) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [matchCount, setMatchCount] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!searchAddon || !query) {
      setMatchCount('')
      return
    }
    // xterm search addon findNext returns boolean
    const found = searchAddon.findNext(query, { caseSensitive, regex })
    setMatchCount(found ? 'Match found' : 'No matches')
  }, [query, caseSensitive, regex, searchAddon])

  const findNext = () => searchAddon?.findNext(query, { caseSensitive, regex })
  const findPrevious = () => searchAddon?.findPrevious(query, { caseSensitive, regex })

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      searchAddon?.clearDecorations()
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
        {matchCount}
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
