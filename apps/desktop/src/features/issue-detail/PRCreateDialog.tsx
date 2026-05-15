import { useEffect, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'

import type { BackendConfig } from '@core/api/client'
import { fetchDefaultBranch } from '@core/api/client'

interface PRCreateDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (pr: { title: string; body: string; base: string; head: string; draft: boolean }) => Promise<void>
  issueTitle: string
  issueDescription: string
  branchName: string
  config: BackendConfig
  projectId: string
}

export function PRCreateDialog({
  open,
  onClose,
  onSubmit,
  issueTitle,
  issueDescription,
  branchName,
  config,
  projectId,
}: PRCreateDialogProps) {
  const [title, setTitle] = useState(issueTitle)
  // Format PR body: use original description (before appended plan) + plan as checklist
  const [body, setBody] = useState(() => {
    const planSplit = issueDescription.split('\n\n## Agent Plan\n\n')
    const originalDesc = planSplit[0] || issueDescription
    const plan = planSplit[1] || ''
    let prBody = `## Summary\n\n${originalDesc}`
    if (plan) {
      prBody += `\n\n## Implementation Plan\n\n${plan}`
    }
    return prBody
  })
  const [base, setBase] = useState('main')
  const [draft, setDraft] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const bodyId = useId()
  const baseId = useId()
  const headId = useId()
  const draftId = useId()

  // Fetch default branch on mount
  useEffect(() => {
    if (!open) return
    setTitle(issueTitle)
    const planSplit = issueDescription.split('\n\n## Agent Plan\n\n')
    const originalDesc = planSplit[0] || issueDescription
    const plan = planSplit[1] || ''
    let prBody = `## Summary\n\n${originalDesc}`
    if (plan) {
      prBody += `\n\n## Implementation Plan\n\n${plan}`
    }
    setBody(prBody)
    setError(null)
    setSubmitting(false)
    fetchDefaultBranch(config, projectId)
      .then(setBase)
      .catch(() => setBase('main'))
  }, [open, config, projectId, issueTitle, issueDescription])

  if (!open) return null

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({ title, body, base, head: branchName, draft })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pull request')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border/40 rounded-xl shadow-lg p-6 max-w-2xl w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Create Pull Request</h3>

        <div className="space-y-3">
          <div>
            <label htmlFor={titleId} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1 block">Title</label>
            <input
              id={titleId}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-muted/10 border border-border/40 rounded-lg px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/60"
              placeholder="PR title..."
            />
          </div>

          <div>
            <label htmlFor={bodyId} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1 block">Description</label>
            <textarea
              id={bodyId}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="w-full bg-muted/10 border border-border/40 rounded-lg px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/40 resize-none outline-none focus:border-primary/60"
              placeholder="Describe the changes..."
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor={baseId} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1 block">Base branch</label>
              <input
                id={baseId}
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className="w-full bg-muted/10 border border-border/40 rounded-lg px-3 py-2 text-[11px] text-foreground font-mono outline-none focus:border-primary/60"
              />
            </div>
            <div className="flex-1">
              <label htmlFor={headId} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1 block">Head branch</label>
              <div id={headId} className="px-3 py-2 text-[11px] font-mono text-muted-foreground/60 bg-muted/5 border border-border/20 rounded-lg">
                {branchName || 'N/A'}
              </div>
            </div>
          </div>

          <label htmlFor={draftId} className="flex items-center gap-2 cursor-pointer">
            <input
              id={draftId}
              type="checkbox"
              checked={draft}
              onChange={(e) => setDraft(e.target.checked)}
              className="rounded border-border/40"
            />
            <span className="text-[11px] text-muted-foreground">Create as draft PR</span>
          </label>
        </div>

        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-400">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg text-muted-foreground hover:text-foreground transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !branchName}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            {submitting ? 'Creating...' : 'Create Pull Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
