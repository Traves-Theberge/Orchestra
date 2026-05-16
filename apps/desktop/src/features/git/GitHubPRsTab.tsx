import { GitPullRequest, Plus, X } from 'lucide-react'
import type { GitHubPR } from '@core/api/client'

function prStatusStyle(pr: GitHubPR): string {
  if (pr.merged_at) return 'text-purple-400'
  if (pr.state === 'closed') return 'text-destructive'
  return 'text-emerald-500'
}

function prStatusLabel(pr: GitHubPR): string {
  if (pr.merged_at) return 'merged'
  return pr.state
}

export function GitHubPRsTab({
  prs,
  branches,
  loadError,
  showCreatePR,
  onToggleShowCreate,
  newPRTitle,
  setNewPRTitle,
  newPRBody,
  setNewPRBody,
  newPRHead,
  setNewPRHead,
  newPRBase,
  setNewPRBase,
  onCreatePR,
  loading,
  onOpenPR,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  prs: GitHubPR[]
  branches: string[]
  loadError: boolean
  showCreatePR: boolean
  onToggleShowCreate: () => void
  newPRTitle: string
  setNewPRTitle: (v: string) => void
  newPRBody: string
  setNewPRBody: (v: string) => void
  newPRHead: string
  setNewPRHead: (v: string) => void
  newPRBase: string
  setNewPRBase: (v: string) => void
  onCreatePR: () => void
  loading: boolean
  onOpenPR: (pr: GitHubPR) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}) {
  return (
    <div>
      <div className="flex items-center mb-3">
        <button
          onClick={onToggleShowCreate}
          className="ml-auto size-7 grid place-items-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
          title={showCreatePR ? 'Cancel' : 'New PR'}
        >
          {showCreatePR ? <X size={13} /> : <Plus size={13} />}
        </button>
      </div>

      {showCreatePR && (
        <div className="mb-3 p-3 rounded-md bg-muted/20 space-y-2">
          <input
            value={newPRTitle}
            onChange={(e) => setNewPRTitle(e.target.value)}
            placeholder="PR title"
            className="w-full h-8 px-3 rounded-md bg-background text-[12px] font-medium placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 transition-all"
          />
          <textarea
            value={newPRBody}
            onChange={(e) => setNewPRBody(e.target.value)}
            placeholder="Description"
            rows={3}
            className="w-full px-3 py-2 rounded-md bg-background text-[12px] placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 resize-none transition-all"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={newPRHead}
              onChange={(e) => setNewPRHead(e.target.value)}
              className="h-8 px-2 rounded-md bg-background text-[11.5px] outline-none focus:ring-1 focus:ring-primary/40"
            >
              <option value="">Head branch</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              value={newPRBase}
              onChange={(e) => setNewPRBase(e.target.value)}
              className="h-8 px-2 rounded-md bg-background text-[11.5px] outline-none focus:ring-1 focus:ring-primary/40"
            >
              <option value="">Base branch</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <button
            onClick={onCreatePR}
            disabled={!newPRTitle.trim() || !newPRHead || !newPRBase || loading}
            className="inline-flex items-center h-8 px-3 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[11.5px] font-semibold tracking-tight disabled:opacity-40 transition-colors"
          >
            Create PR
          </button>
        </div>
      )}

      <div className="flex flex-col">
        {prs.map((pr) => (
          <button
            key={pr.number}
            onClick={() => onOpenPR(pr)}
            className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/[0.03] text-left transition-colors"
          >
            <GitPullRequest size={11} className={`shrink-0 ${prStatusStyle(pr)}`} />
            <span className={`text-[10px] font-semibold uppercase tracking-tight shrink-0 ${prStatusStyle(pr)}`}>
              {prStatusLabel(pr)}
            </span>
            <span className="text-[12px] text-foreground/90 truncate flex-1">
              <span className="font-mono text-muted-foreground/60 mr-1.5">#{pr.number}</span>
              {pr.title}
            </span>
            <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">
              {pr.base.ref} ← {pr.head.ref}
            </span>
          </button>
        ))}
        {prs.length === 0 && !loadError && (
          <div className="text-[11px] text-muted-foreground/50 text-center py-6">No pull requests</div>
        )}
      </div>
      {hasMore && (
        <button
          onClick={onLoadMore}
          disabled={loadingMore}
          className="w-full mt-2 h-8 text-[11px] font-medium text-primary hover:text-primary/80 disabled:opacity-40 transition-colors"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
