import type { PRReviewComment } from '@core/api/client'
import { LinkDropdown } from '@ui/LinkDropdown'

export function groupReviewComments(comments: PRReviewComment[]): PRReviewComment[][] {
  const byId = new Map(comments.map(comment => [comment.id, comment]))
  const groups = new Map<number, PRReviewComment[]>()
  for (const comment of comments) {
    let root = comment
    const seen = new Set<number>([root.id])
    while (root.in_reply_to_id && byId.has(root.in_reply_to_id) && !seen.has(root.in_reply_to_id)) {
      root = byId.get(root.in_reply_to_id)!
      seen.add(root.id)
    }
    const group = groups.get(root.id) ?? []
    group.push(comment)
    groups.set(root.id, group)
  }
  return [...groups.entries()].map(([rootId, group]) => group.toSorted((a, b) => a.id === rootId ? -1 : b.id === rootId ? 1 : a.created_at.localeCompare(b.created_at)))
}

export function PRConversations({ comments }: { comments: PRReviewComment[] }) {
  return <div className="space-y-3">
    {groupReviewComments(comments).map(group => <section key={group[0].id} className="rounded-lg border border-border/40 p-3" aria-label={`Review conversation on ${group[0].path}`}>
      <div className="mb-2 font-mono text-xs text-muted-foreground">{group[0].path}:{group[0].line ?? `outdated${group[0].original_line ? ` (original line ${group[0].original_line})` : ''}`}</div>
      {group.map(comment => <article key={comment.id} className="mb-3 last:mb-0">
        <LinkDropdown href={comment.html_url} className="text-xs text-primary">{comment.user?.login ?? 'unknown'} · {new Date(comment.created_at).toLocaleString()}</LinkDropdown>
        <p className="mt-1 whitespace-pre-wrap text-xs leading-5">{comment.body}</p>
      </article>)}
    </section>)}
  </div>
}
