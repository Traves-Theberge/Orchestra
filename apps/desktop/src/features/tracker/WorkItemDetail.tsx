import { ExternalLink, GitPullRequest } from 'lucide-react'
import { Badge } from '@ui/badge'
import type { WorkItem, WorkItemSource } from '@/entities/tracker/types'
import { useOpenUrl } from '@/hooks'

const SOURCE_BADGE_CLASS: Record<WorkItemSource, string> = {
  github: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  linear: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  jira: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  sqlite: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  memory: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
}

const PRIORITY_LABEL: Record<number, string> = {
  0: '',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

interface Props {
  item: WorkItem | null
}

/**
 * Tracker-agnostic detail view. Renders any WorkItem regardless of source.
 * Source-specific metadata appears as chips in the "Tracker metadata" section.
 */
export function WorkItemDetail({ item }: Props) {
  const openUrl = useOpenUrl()

  if (!item) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Select an item to view details
      </div>
    )
  }

  const sourceClass = SOURCE_BADGE_CLASS[item.source as WorkItemSource] ?? SOURCE_BADGE_CLASS.memory
  const priorityLabel = PRIORITY_LABEL[item.priority] ?? ''
  const extraEntries = Object.entries(item.extra ?? {})
  const hasExtra = extraEntries.length > 0

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-mono text-muted-foreground">{item.identifier}</span>
          <span className={`text-[10px] px-1.5 py-px rounded border ${sourceClass}`}>
            {item.source}
          </span>
          <Badge variant="secondary" className="text-xs">
            {item.state}
          </Badge>
          {priorityLabel && (
            <Badge variant="secondary" className="text-xs">
              {priorityLabel}
            </Badge>
          )}
        </div>
        <h2 className="text-base font-semibold leading-snug">{item.title}</h2>
        {item.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {item.labels.map((l) => (
              <Badge key={l} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                {l}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Description */}
      {item.description && (
        <div className="p-4 border-b border-border">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Description
          </h3>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{item.description}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Details
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">ID</dt>
          <dd className="font-mono text-xs truncate">{item.id}</dd>

          <dt className="text-muted-foreground">Source</dt>
          <dd>{item.source}</dd>

          {item.assignee_id && (
            <>
              <dt className="text-muted-foreground">Assignee</dt>
              <dd className="truncate">{item.assignee_id}</dd>
            </>
          )}

          {item.assignees.length > 0 && (
            <>
              <dt className="text-muted-foreground">Assignees</dt>
              <dd className="truncate">{item.assignees.join(', ')}</dd>
            </>
          )}

          {item.branch_name && (
            <>
              <dt className="text-muted-foreground">Branch</dt>
              <dd className="font-mono text-xs truncate">{item.branch_name}</dd>
            </>
          )}

          {item.created_at && (
            <>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="text-xs truncate">{item.created_at}</dd>
            </>
          )}

          {item.updated_at && (
            <>
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="text-xs truncate">{item.updated_at}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Links */}
      {(item.url || item.pr_url) && (
        <div className="p-4 border-b border-border">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Links
          </h3>
          <div className="flex flex-col gap-1.5">
            {item.url && (
              <button
                onClick={() => openUrl(item.url)}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" />
                <span className="truncate">View in {item.source}</span>
              </button>
            )}
            {item.pr_url && (
              <button
                onClick={() => openUrl(item.pr_url!)}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <GitPullRequest className="size-3.5" />
                <span className="truncate">{item.pr_url}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tracker-specific metadata */}
      {hasExtra && (
        <div className="p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Tracker Metadata
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {extraEntries.map(([k, v]) => (
              <Badge key={k} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                {k}: {formatExtraValue(v)}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatExtraValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
