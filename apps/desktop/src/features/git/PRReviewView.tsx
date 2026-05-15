import { useState, useEffect, useCallback } from 'react'
import { X, Check, AlertTriangle, ChevronDown, GitMerge } from 'lucide-react'
import type { BackendConfig, GitHubPR } from '@core/api/client'
import { fetchProjectGitHubPullDiff, fetchPRReviews, submitPRReview, mergePR } from '@core/api/client'
import { DiffViewer } from './DiffViewer'

type ReviewTab = 'files' | 'reviews'
type MergeMethod = 'merge' | 'squash' | 'rebase'

type Review = {
  id?: number
  user?: { login: string }
  body: string
  state: string
  submitted_at?: string
}

function reviewStateStyle(state: string): { dot: string; label: string } {
  switch (state.toLowerCase()) {
    case 'approved': return { dot: 'bg-emerald-500', label: 'text-emerald-500' }
    case 'changes_requested': return { dot: 'bg-amber-500', label: 'text-amber-500' }
    case 'commented': return { dot: 'bg-blue-500', label: 'text-blue-500' }
    default: return { dot: 'bg-muted-foreground/40', label: 'text-muted-foreground' }
  }
}

function prStatus(pr: GitHubPR): { dot: string; label: string; text: string } {
  if (pr.merged_at) return { dot: 'bg-purple-500', label: 'merged', text: 'text-purple-500' }
  if (pr.state === 'closed') return { dot: 'bg-destructive', label: 'closed', text: 'text-destructive' }
  return { dot: 'bg-emerald-500', label: 'open', text: 'text-emerald-500' }
}

export function PRReviewView({
  projectId,
  config,
  pr,
  onClose,
}: {
  projectId: string
  config: BackendConfig
  pr: GitHubPR
  onClose: () => void
}) {
  const [tab, setTab] = useState<ReviewTab>('files')
  const [diffText, setDiffText] = useState('')
  const [diffMode, setDiffMode] = useState<'split' | 'unified'>('unified')
  const [reviews, setReviews] = useState<Review[]>([])
  const [reviewBody, setReviewBody] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [diff, revs] = await Promise.all([
        fetchProjectGitHubPullDiff(config, projectId, pr.number),
        fetchPRReviews(config, projectId, pr.number) as Promise<Review[]>,
      ])
      setDiffText(diff)
      setReviews(revs)
    } catch (err) {
      console.error('PR review data load failed', err)
    }
  }, [config, projectId, pr.number])

  useEffect(() => { loadData() }, [loadData])

  async function handleReview(event: string) {
    if (loading) return
    setLoading(true)
    try {
      await submitPRReview(config, projectId, pr.number, reviewBody, event)
      setReviewBody('')
      await loadData()
    } catch (err) {
      console.error('submit review failed', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleMerge(method: MergeMethod) {
    setMergeOpen(false)
    setLoading(true)
    try {
      await mergePR(config, projectId, pr.number, method)
      await loadData()
    } catch (err) {
      console.error('merge failed', err)
    } finally {
      setLoading(false)
    }
  }

  const status = prStatus(pr)
  const tabClass = (active: boolean) =>
    `relative h-9 px-3 text-[12px] font-medium tracking-tight transition-colors ${
      active ? 'text-foreground' : 'text-muted-foreground/60 hover:text-foreground/80'
    }`

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border/30 shrink-0">
        <button
          onClick={onClose}
          className="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
        >
          <X size={14} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[11px] text-muted-foreground/60">#{pr.number}</span>
            <span className="text-[13px] font-medium tracking-tight text-foreground/90 truncate">{pr.title}</span>
            <span className="inline-flex items-center gap-1.5 shrink-0">
              <span className={`size-1.5 rounded-full ${status.dot}`} />
              <span className={`text-[10.5px] font-medium tracking-tight ${status.text}`}>{status.label}</span>
            </span>
          </div>
          <div className="font-mono text-[10.5px] text-muted-foreground/50 mt-0.5 truncate">
            {pr.head.ref} → {pr.base.ref}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 px-3 border-b border-border/30 shrink-0">
        <button onClick={() => setTab('files')} className={tabClass(tab === 'files')}>
          Files Changed
          {tab === 'files' && <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full bg-primary" />}
        </button>
        <button onClick={() => setTab('reviews')} className={tabClass(tab === 'reviews')}>
          Reviews
          <span className="ml-1.5 tabular-nums text-muted-foreground/50">{reviews.length}</span>
          {tab === 'reviews' && <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full bg-primary" />}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'files' ? (
          <DiffViewer filePath={`PR #${pr.number}: ${pr.title}`} diff={diffText || null} mode={diffMode} onModeChange={setDiffMode} />
        ) : (
          <div className="overflow-y-auto h-full p-4 space-y-3">
            {reviews.map((review, i) => {
              const style = reviewStateStyle(review.state)
              return (
                <div key={review.id ?? i} className="bg-foreground/[0.02] border border-border/30 rounded-lg px-3.5 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[12px] font-medium text-foreground/90">{review.user?.login ?? 'unknown'}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`size-1.5 rounded-full ${style.dot}`} />
                      <span className={`text-[10.5px] font-medium tracking-tight ${style.label}`}>{review.state.replace('_', ' ').toLowerCase()}</span>
                    </span>
                  </div>
                  {review.body && (
                    <p className="text-[12px] text-foreground/75 leading-relaxed whitespace-pre-wrap">{review.body}</p>
                  )}
                </div>
              )
            })}
            {reviews.length === 0 && (
              <div className="text-[11.5px] text-muted-foreground/50 text-center py-8">No reviews yet</div>
            )}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border/30 shrink-0 bg-background">
        <textarea
          value={reviewBody}
          onChange={(e) => setReviewBody(e.target.value)}
          placeholder="Leave a review comment…"
          rows={1}
          className="flex-1 h-8 bg-muted/30 rounded-md px-3 py-1.5 text-[12px] font-medium tracking-tight placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 resize-none transition-all"
        />
        <button
          onClick={() => handleReview('APPROVE')}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium tracking-tight text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
        >
          <Check size={12} strokeWidth={2.5} />
          Approve
        </button>
        <button
          onClick={() => handleReview('REQUEST_CHANGES')}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium tracking-tight text-amber-500 hover:bg-amber-500/10 disabled:opacity-40 transition-colors"
        >
          <AlertTriangle size={12} strokeWidth={2.5} />
          Request changes
        </button>
        <div className="relative">
          <button
            onClick={() => setMergeOpen((v) => !v)}
            disabled={loading}
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
