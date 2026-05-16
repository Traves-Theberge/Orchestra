import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import type { GitCommit } from '@core/api/client'
import { useNow } from '@/hooks'

function relativeTime(dateStr: string, now: number): string {
  if (!now) return ''
  // Handle Unix timestamp (seconds) or ISO date string
  const parsed = /^\d+$/.test(dateStr) ? Number(dateStr) * 1000 : new Date(dateStr).getTime()
  if (Number.isNaN(parsed)) return dateStr
  const diff = now - parsed
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export function CommitTimeline({
  commits,
  selectedHash,
  onSelectCommit,
}: {
  commits: GitCommit[]
  selectedHash: string | null
  onSelectCommit: (hash: string) => void
}) {
  const [search, setSearch] = useState('')
  const now = useNow()

  const filtered = useMemo(() => {
    if (!search.trim()) return commits
    const q = search.toLowerCase()
    return commits.filter((c) => c.message.toLowerCase().includes(q))
  }, [commits, search])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commits…"
            className="w-full h-8 pl-8 pr-3 rounded-md bg-muted/30 text-[12px] font-medium placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 transition-all"
          />
        </div>
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((commit) => {
          const hash = commit.hash ?? ''
          const selected = hash === selectedHash
          return (
            <button
              key={hash}
              onClick={() => onSelectCommit(hash)}
              data-selected={selected}
              className={`group relative w-full text-left flex items-stretch gap-0 px-3 py-2 transition-colors ${
                selected ? 'bg-foreground/[0.06] text-foreground' : 'hover:bg-foreground/[0.03]'
              }`}
            >
              {selected && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-primary" />}

              {/* Timeline column */}
              <div className="relative flex flex-col items-center w-4 shrink-0 mr-2.5">
                <div className="absolute inset-0 left-1/2 -translate-x-1/2 w-px bg-border/50" />
                <div
                  data-testid="timeline-dot"
                  className={`relative mt-1.5 w-1.5 h-1.5 rounded-full ${
                    selected ? 'bg-primary ring-2 ring-primary/30' : 'bg-muted-foreground/40'
                  }`}
                />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium tracking-tight text-foreground/90 truncate group-hover:text-foreground">
                  {commit.message}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {hash.slice(0, 7)}
                  </span>
                  {commit.author && (
                    <span className="text-[10.5px] text-muted-foreground/60 truncate">{commit.author}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground/50 ml-auto shrink-0">
                    {relativeTime(commit.date, now)}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="px-3 py-8 text-[11px] text-muted-foreground/50 text-center">
            {search ? 'No matching commits' : 'No commits'}
          </div>
        )}
      </div>
    </div>
  )
}
