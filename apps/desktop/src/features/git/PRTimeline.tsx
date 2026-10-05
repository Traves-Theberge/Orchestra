import type { GitHubPR, PRReviewComment } from '@core/api/client'

export type PRReview = { id?: number; user?: { login: string }; body: string; state: string; submitted_at?: string }

export function PRTimeline({ pr, reviews, comments }: { pr: GitHubPR; reviews: PRReview[]; comments: PRReviewComment[] }) {
  const events = [
    { key: 'opened', date: pr.created_at, actor: pr.user.login, label: 'opened this pull request', body: '' },
    ...reviews.map((review, i) => ({ key: `review-${review.id ?? i}`, date: review.submitted_at ?? '', actor: review.user?.login ?? 'unknown', label: review.state.replaceAll('_', ' ').toLowerCase(), body: review.body })),
    ...comments.map(comment => ({ key: `comment-${comment.id}`, date: comment.created_at, actor: comment.user?.login ?? 'unknown', label: `commented on ${comment.path}:${comment.line ?? comment.original_line ?? 'outdated'}`, body: comment.body })),
    ...(pr.merged_at ? [{ key: 'merged', date: pr.merged_at, actor: '', label: 'pull request merged', body: '' }] : []),
  ].toSorted((a, b) => a.date.localeCompare(b.date))
  return <div className="h-full overflow-y-auto p-4 space-y-3">
    <p className="text-xs text-muted-foreground">PR opening, submitted reviews, code comments and confirmed merge. Other GitHub events are available on GitHub.</p>
    {events.map(event => <article key={event.key} className="rounded-lg border border-border/30 px-3.5 py-3">
      <div className="text-xs"><span className="font-medium">{event.actor}</span> {event.label}</div>
      {event.date && <time dateTime={event.date} className="text-[10px] text-muted-foreground">{new Date(event.date).toLocaleString()}</time>}
      {event.body && <p className="mt-2 whitespace-pre-wrap text-xs leading-5">{event.body}</p>}
    </article>)}
  </div>
}
