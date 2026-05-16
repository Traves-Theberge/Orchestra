import { CircleDot, ExternalLink, Plus, X } from 'lucide-react'
import { useAppStore } from '@core/store'
import type { GitHubIssue } from '@core/api/client'

type IssueFilter = 'open' | 'closed' | 'all'

export function GitHubIssuesTab({
  issues,
  issueFilter,
  onSetIssueFilter,
  loadError,
  showCreateIssue,
  onToggleShowCreate,
  newIssueTitle,
  setNewIssueTitle,
  newIssueBody,
  setNewIssueBody,
  onCreateIssue,
  loading,
  expandedIssue,
  onToggleExpandedIssue,
  onToggleIssueState,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  issues: GitHubIssue[]
  issueFilter: IssueFilter
  onSetIssueFilter: (f: IssueFilter) => void
  loadError: boolean
  showCreateIssue: boolean
  onToggleShowCreate: () => void
  newIssueTitle: string
  setNewIssueTitle: (v: string) => void
  newIssueBody: string
  setNewIssueBody: (v: string) => void
  onCreateIssue: () => void
  loading: boolean
  expandedIssue: number | null
  onToggleExpandedIssue: (n: number) => void
  onToggleIssueState: (issue: GitHubIssue) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-3">
        <div className="flex items-center rounded-md bg-muted/30 p-0.5">
          {(['open', 'closed', 'all'] as IssueFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => onSetIssueFilter(f)}
              className={`px-2.5 h-6 rounded text-[10.5px] font-medium tracking-tight transition-colors capitalize ${
                issueFilter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/60 hover:text-foreground'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={onToggleShowCreate}
          className="ml-auto size-7 grid place-items-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
          title={showCreateIssue ? 'Cancel' : 'New issue'}
        >
          {showCreateIssue ? <X size={13} /> : <Plus size={13} />}
        </button>
      </div>

      {showCreateIssue && (
        <div className="mb-3 p-3 rounded-md bg-muted/20 space-y-2">
          <input
            value={newIssueTitle}
            onChange={(e) => setNewIssueTitle(e.target.value)}
            placeholder="Issue title"
            className="w-full h-8 px-3 rounded-md bg-background text-[12px] font-medium placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 transition-all"
          />
          <textarea
            value={newIssueBody}
            onChange={(e) => setNewIssueBody(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            className="w-full px-3 py-2 rounded-md bg-background text-[12px] placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 resize-none transition-all"
          />
          <button
            onClick={onCreateIssue}
            disabled={!newIssueTitle.trim() || loading}
            className="inline-flex items-center h-8 px-3 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[11.5px] font-semibold tracking-tight disabled:opacity-40 transition-colors"
          >
            Create issue
          </button>
        </div>
      )}

      <div className="flex flex-col">
        {issues.map((issue) => (
          <div key={issue.number}>
            <div
              role="button"
              tabIndex={0}
              className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/[0.03] cursor-pointer transition-colors"
              onClick={() => onToggleExpandedIssue(issue.number)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpandedIssue(issue.number) } }}
            >
              <CircleDot size={11} className={issue.state === 'open' ? 'text-emerald-500 shrink-0' : 'text-destructive shrink-0'} />
              <span className="text-[12px] text-foreground/90 truncate flex-1">
                <span className="font-mono text-muted-foreground/60 mr-1.5">#{issue.number}</span>
                {issue.title}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  useAppStore.getState().setActiveSection('CONSOLE')
                  useAppStore.getState().openBrowserTab(issue.html_url)
                }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-foreground transition-all p-0.5"
              >
                <ExternalLink size={11} />
              </button>
            </div>
            {expandedIssue === issue.number && (
              <div className="ml-6 px-2 py-1.5 text-[11.5px] text-muted-foreground/85">
                <p className="mb-2 whitespace-pre-wrap leading-relaxed">{issue.body || 'No description'}</p>
                <button
                  onClick={() => onToggleIssueState(issue)}
                  disabled={loading}
                  className="text-[10.5px] font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  {issue.state === 'open' ? 'Close issue' : 'Reopen issue'}
                </button>
              </div>
            )}
          </div>
        ))}
        {issues.length === 0 && !loadError && (
          <div className="text-[11px] text-muted-foreground/50 text-center py-6">No issues</div>
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
