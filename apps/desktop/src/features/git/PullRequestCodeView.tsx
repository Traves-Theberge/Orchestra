import { useMemo, useState } from 'react'
import { DiffViewer } from './DiffViewer'
import { splitPRDiff } from './pr-diff-files'
import type { PRReviewComment } from '@core/api/client'
import { PRConversations } from './PRConversations'

export function PullRequestCodeView({ diff, storageKey, mode, onModeChange, comments = [] }: {
  diff: string; storageKey: string; mode: 'split' | 'unified'; onModeChange: (mode: 'split' | 'unified') => void
  comments?: PRReviewComment[]
}) {
  const files = useMemo(() => splitPRDiff(diff), [diff])
  const [query, setQuery] = useState('')
  const [initialMarks] = useState(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
      return { marks: value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, checked]) => checked === true)) as Record<string, boolean> : {}, error: false }
    } catch { return { marks: {}, error: true } }
  })
  const [viewed, setViewed] = useState<Record<string, boolean>>(initialMarks.marks)
  const [storageError, setStorageError] = useState(initialMarks.error)
  const isViewed = (path: string) => Object.hasOwn(viewed, path) && viewed[path] === true
  const filtered = files.filter(file => file.path.toLowerCase().includes(query.toLowerCase()))
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-3 px-4 py-2 text-xs">
      <input aria-label="Filter changed files" placeholder="Filter files…" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 rounded-md bg-muted px-3 py-1.5 outline-none" />
      <span className="text-muted-foreground">{files.length} files · {files.filter(file => isViewed(file.path)).length} viewed</span>
      <button aria-pressed={mode === 'unified'} onClick={() => onModeChange('unified')}>Unified</button>
      <button aria-pressed={mode === 'split'} onClick={() => onModeChange('split')}>Split</button>
    </div>
    {storageError && <p role="alert" className="px-4 pb-2 text-xs text-amber-500">Viewed marks could not be restored or saved on this device.</p>}
    <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
      {filtered.map(file => <details key={file.path} open={!isViewed(file.path)} className="mb-2 overflow-hidden rounded-lg border border-border/40">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 truncate font-mono">{file.oldPath ? `${file.oldPath} → ` : ''}{file.path}</span>
          <span className="text-emerald-500">+{file.additions}</span><span className="text-red-500">−{file.deletions}</span>
          <label onClick={event => event.stopPropagation()} className="flex items-center gap-1.5 text-muted-foreground"><input type="checkbox" checked={isViewed(file.path)} onChange={event => {
            const next = { ...viewed, [file.path]: event.target.checked }
            setViewed(next)
            try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false) } catch { setStorageError(true) }
          }} />Viewed</label>
        </summary>
        {file.binary ? <p className="p-4 text-xs text-muted-foreground">Binary file changed. Text diff unavailable.</p> : !/^@@ /m.test(file.diff) ? <p className="p-4 text-xs text-muted-foreground">File metadata changed. No text hunks.</p> : <DiffViewer compact showHeader={false} filePath={file.path} diff={file.diff} mode={mode} onModeChange={onModeChange} />}
        {comments.some(comment => comment.path === file.path) && <div className="p-3"><PRConversations comments={comments.filter(comment => comment.path === file.path)} /></div>}
      </details>)}
      {files.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No file changes in this snapshot.</p>}
      {files.length > 0 && filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No matching files.</p>}
    </div>
  </div>
}
