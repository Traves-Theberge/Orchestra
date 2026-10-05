import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Check, AlertTriangle, ChevronDown, GitMerge } from 'lucide-react'
import type { BackendConfig, GitHubPR } from '@core/api/client'
import { fetchPRSnapshot, fetchPRReviews, fetchPRReviewComments, submitPRReview, mergePR, type PRReviewComment } from '@core/api/client'
import { PullRequestCodeView } from './PullRequestCodeView'
import { PRConversations } from './PRConversations'
import { PRTimeline } from './PRTimeline'
import { WorkspaceToolsControls } from '../workspace/WorkspaceToolsControls'
import { useAppStore } from '@core/store'

type ReviewTab = 'summary' | 'timeline' | 'code'
type MergeMethod = 'merge' | 'squash' | 'rebase'

type Review = {
  id?: number
  user?: { login: string }
  body: string
  state: string
  submitted_at?: string
}

function prStatus(pr: GitHubPR): { dot: string; label: string; text: string } {
  if (pr.merged_at) return { dot: 'bg-purple-500', label: 'merged', text: 'text-purple-500' }
  if (pr.state === 'closed') return { dot: 'bg-destructive', label: 'closed', text: 'text-destructive' }
  return { dot: 'bg-emerald-500', label: 'open', text: 'text-emerald-500' }
}

type PRReviewProps = { projectId: string; config: BackendConfig; pr: GitHubPR; onClose: () => void; onInspectTask?: (identifier: string) => void }

export function PRReviewView(props: PRReviewProps) {
  return <PRReviewPanel key={`${props.config.baseUrl}:${props.projectId}:${props.pr.number}`} {...props} />
}

function PRReviewPanel({
  projectId,
  config,
  pr,
  onClose,
  onInspectTask,
}: PRReviewProps) {
  const [tab, setTab] = useState<ReviewTab>('code')
  const [diffText, setDiffText] = useState('')
  const [diffMode, setDiffMode] = useState<'split' | 'unified'>('unified')
  const [reviews, setReviews] = useState<Review[]>([])
  const [comments, setComments] = useState<PRReviewComment[]>([])
  const issues = useAppStore(state => state.allBoardIssues)
  const [reviewBody, setReviewBody] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [snapshotPR, setSnapshotPR] = useState<GitHubPR | null>(null)
  const generation = useRef(0)
  const mounted = useRef(false)

  const loadData = useCallback(async () => {
    const current = ++generation.current
    await Promise.resolve()
    if (!mounted.current) return
    setDataLoading(true)
    setError(null)
    try {
      const [snapshot, revs, reviewComments] = await Promise.all([
        fetchPRSnapshot(config, projectId, pr.number),
        fetchPRReviews(config, projectId, pr.number) as Promise<Review[]>,
        fetchPRReviewComments(config, projectId, pr.number),
      ])
      if (!mounted.current || current !== generation.current) return
      if (snapshot.pr.number !== pr.number || !/^[a-f0-9]{40}$/i.test(snapshot.pr.head.sha ?? '')) throw new Error('Review snapshot is missing the PR identity or head commit. Refresh before merging.')
      setSnapshotPR(snapshot.pr)
      setDiffText(snapshot.diff)
      setReviews(revs)
      setComments(reviewComments)
    } catch (err) {
      if (mounted.current && current === generation.current) setError(err instanceof Error ? err.message : 'PR review data load failed')
    } finally {
      if (mounted.current && current === generation.current) setDataLoading(false)
    }
  }, [config, projectId, pr.number])

  useEffect(() => {
    mounted.current = true
    void loadData()
    return () => { mounted.current = false }
  }, [loadData])

  const currentPR = snapshotPR ?? pr
  const canAct = !loading && !dataLoading && !error && snapshotPR?.state === 'open' && !snapshotPR.merged_at && !snapshotPR.draft

  async function handleReview(event: string) {
    if (!canAct || !snapshotPR?.head.sha) return
    setLoading(true)
    try {
      await submitPRReview(config, projectId, pr.number, reviewBody, event, snapshotPR.head.sha)
      if (!mounted.current) return
      setReviewBody('')
      await loadData()
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Review submission failed')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  async function handleMerge(method: MergeMethod) {
    if (!canAct || !snapshotPR?.head.sha) return
    setMergeOpen(false)
    setLoading(true)
    try {
      await mergePR(config, projectId, pr.number, method, snapshotPR.head.sha)
      if (mounted.current) setSnapshotPR({ ...snapshotPR, state: 'closed', merged_at: new Date().toISOString() })
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Merge failed. Refresh and review again.')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  const status = prStatus(currentPR)
  const tabClass = (active: boolean) =>
    `relative h-7 rounded-md px-3 text-[12px] font-medium tracking-tight transition-colors ${
      active ? 'bg-muted text-foreground' : 'text-muted-foreground/60 hover:text-foreground/80'
    }`

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-3 pt-3 pb-2 space-y-2">
        <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onClose}
          aria-label="Back to pull requests"
          className="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
        >
          <X size={14} />
        </button>
          <a href={currentPR.html_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{currentPR.base.label.split(':')[0]}/{currentPR.html_url.split('/').at(-3)} <span className="text-primary">#{pr.number}</span></a>
            <span className="inline-flex items-center gap-1.5 shrink-0 rounded-md border border-border/40 px-2 py-1">
              <span className={`size-1.5 rounded-full ${status.dot}`} />
              <span className={`text-[10.5px] font-medium tracking-tight ${status.text}`}>{status.label}</span>
            </span>
          <WorkspaceToolsControls />
        </div>
        <h2 title={currentPR.title} className="truncate text-sm font-semibold">{currentPR.title}</h2>
        <div className="text-xs text-muted-foreground">{currentPR.user.login} · opened {new Date(currentPR.created_at).toLocaleDateString()}</div>
          <div className="font-mono text-[10.5px] text-muted-foreground/50 mt-0.5 truncate">
            {currentPR.head.ref} → {currentPR.base.ref}
          </div>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Pull request" className="mx-3 mb-2 flex w-fit items-center gap-0 rounded-lg border border-border/30 bg-muted/20 p-0.5 shrink-0">
        {(['summary', 'timeline', 'code'] as const).map(item => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={tabClass(tab === item)}>{item === 'summary' ? 'Summary' : item === 'timeline' ? 'Timeline' : 'Code'}</button>)}
      </div>

      <div className="px-4 py-2 text-xs border-b border-border/30">
        {error ? <span role="alert">{error}</span> : dataLoading ? <span role="status">Loading review snapshot…</span> : <span>Reviewing commit {snapshotPR?.head.sha?.slice(0, 12)}</span>}
        <button onClick={() => void loadData()} disabled={loading || dataLoading} className="ml-3 underline disabled:opacity-40">Refresh review</button>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {dataLoading && !snapshotPR ? null : error && !snapshotPR ? null : tab === 'code' ? (
          <PullRequestCodeView key={`${snapshotPR?.base.sha}:${snapshotPR?.head.sha}`} storageKey={`orchestra:pr-viewed:v1:${encodeURIComponent(config.baseUrl)}:${projectId}:${encodeURIComponent(currentPR.html_url)}:${pr.number}:${snapshotPR?.base.sha}:${snapshotPR?.head.sha}`} diff={diffText} comments={comments} mode={diffMode} onModeChange={setDiffMode} />
        ) : tab === 'summary' ? (
          <div className="h-full overflow-auto p-5 text-sm">
            <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground"><span>{currentPR.user.login}</span><span>Opened {new Date(currentPR.created_at).toLocaleDateString()}</span><a href={currentPR.html_url} target="_blank" rel="noreferrer" className="text-primary">Open on GitHub</a></div>
            <p className="whitespace-pre-wrap leading-6">{currentPR.body || 'No description provided.'}</p>
            <h3 className="mt-6 mb-2 font-semibold">Linked tasks</h3>
            {issues.filter(issue => issue.project_id === projectId && issue.branch_name === currentPR.head.ref).map(issue => <button key={issue.id ?? issue.identifier} disabled={!onInspectTask} onClick={() => onInspectTask?.(issue.identifier ?? issue.issue_identifier ?? issue.id ?? '')} className="block py-1 text-xs text-primary disabled:text-muted-foreground">{issue.identifier ?? issue.issue_identifier} · {issue.title} · {issue.state}</button>)}
            {!issues.some(issue => issue.project_id === projectId && issue.branch_name === currentPR.head.ref) && <p className="text-xs text-muted-foreground">No task linked to this project and branch.</p>}
            <h3 className="mt-6 mb-2 font-semibold">Review conversations</h3>
            <PRConversations comments={comments} />
            {comments.length === 0 && <p className="text-xs text-muted-foreground">No code review comments.</p>}
          </div>
        ) : (
          <PRTimeline pr={currentPR} reviews={reviews} comments={comments} />
        )}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-border/30 shrink-0 bg-background">
        <textarea
          value={reviewBody}
          onChange={(e) => setReviewBody(e.target.value)}
          placeholder="Leave a review comment…"
          rows={1}
          className="min-w-0 basis-full w-full h-8 bg-muted/30 rounded-md px-3 py-1.5 text-[12px] font-medium tracking-tight placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 resize-none transition-all"
        />
        <button
          onClick={() => handleReview('APPROVE')}
          disabled={!canAct}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium tracking-tight text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
        >
          <Check size={12} strokeWidth={2.5} />
          Approve
        </button>
        <button
          onClick={() => handleReview('REQUEST_CHANGES')}
          disabled={!canAct}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium tracking-tight text-amber-500 hover:bg-amber-500/10 disabled:opacity-40 transition-colors"
        >
          <AlertTriangle size={12} strokeWidth={2.5} />
          Request changes
        </button>
        <div className="relative">
          <button
            onClick={() => setMergeOpen((v) => !v)}
            disabled={!canAct}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium tracking-tight bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            <GitMerge size={12} strokeWidth={2.5} />
            Merge
            <ChevronDown size={11} className="opacity-70" />
          </button>
          {mergeOpen && (
            <div className="absolute bottom-full right-0 mb-1.5 bg-popover border border-border/60 rounded-lg shadow-xl z-20 py-1 min-w-[140px]">
              {(['merge', 'squash', 'rebase'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => handleMerge(m)}
                  className="w-full text-left px-3 py-1.5 text-[12px] font-medium tracking-tight text-foreground/85 hover:bg-foreground/[0.04] transition-colors capitalize"
                >
                  {m === 'merge' ? 'Create merge commit' : m === 'squash' ? 'Squash and merge' : 'Rebase and merge'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
