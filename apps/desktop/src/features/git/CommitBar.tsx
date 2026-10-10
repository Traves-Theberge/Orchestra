import { useState, useCallback, type KeyboardEvent } from 'react'
import { ArrowUp, ChevronDown, ChevronRight } from 'lucide-react'

export interface CommitBarProps {
  stagedCount: number
  aheadCount?: number
  onCommit: (message: string) => void
  onPush: () => void
}

export function CommitBar({
  stagedCount,
  aheadCount = 0,
  onCommit,
  onPush,
}: CommitBarProps) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [showBody, setShowBody] = useState(false)

  const canCommit = stagedCount > 0 && subject.trim().length > 0

  const handleCommit = useCallback(() => {
    if (!canCommit) return
    const message = showBody && body.trim()
      ? `${subject}\n\n${body.trim()}`
      : subject
    onCommit(message)
    setSubject('')
    setBody('')
    setShowBody(false)
  }, [canCommit, subject, body, showBody, onCommit])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleCommit()
      }
    },
    [handleCommit],
  )

  const charCount = subject.length
  const charWarn = charCount > 72

  return (
    <div className="border-b border-border/30 px-4 py-3 shrink-0 space-y-2.5 bg-background">
      {/* Overline */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">
          Commit
          <span className="ml-1.5 font-normal tabular-nums text-muted-foreground/40 normal-case tracking-normal">
            {stagedCount} staged
          </span>
        </span>
        <span className={`text-[10px] font-medium tabular-nums ${charWarn ? 'text-amber-500' : 'text-muted-foreground/40'}`}>
          {charCount}/72
        </span>
      </div>

      {/* Subject */}
      <input
        spellCheck={true}
        type="text"
        placeholder="Summary"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full h-8 px-3 rounded-md bg-muted/30 text-[12.5px] font-medium tracking-tight placeholder:text-muted-foreground/45 outline-none focus:ring-1 focus:ring-primary/40 transition-all"
      />

      {/* Body */}
      {showBody && (
        <textarea
          spellCheck={true}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Extended description"
          rows={3}
          className="w-full px-3 py-2 rounded-md bg-muted/30 text-[12px] tracking-tight placeholder:text-muted-foreground/45 outline-none focus:ring-1 focus:ring-primary/40 resize-none transition-all"
        />
      )}

      {/* Action row */}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => setShowBody(!showBody)}
          className="inline-flex items-center gap-1 h-7 px-2 -ml-1 rounded text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
        >
          {showBody ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Description
        </button>

        <div className="flex-1" />

        {aheadCount > 0 && (
          <button
            type="button"
            onClick={onPush}
            aria-label="Push"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium tracking-tight text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
          >
            <ArrowUp size={12} strokeWidth={2.5} />
            Push
            <span className="tabular-nums text-emerald-500">{aheadCount}</span>
          </button>
        )}
        <button
          type="button"
          disabled={!canCommit}
          onClick={handleCommit}
          className="inline-flex items-center h-8 px-3.5 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[11.5px] font-medium tracking-tight transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Commit
        </button>
      </div>
    </div>
  )
}
