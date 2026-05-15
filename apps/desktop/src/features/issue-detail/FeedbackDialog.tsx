import { useState } from 'react'

interface FeedbackDialogProps {
  onSubmit: (feedback: string) => void
  onCancel: () => void
  hasPR?: boolean
}

export function FeedbackDialog({ onSubmit, onCancel, hasPR }: FeedbackDialogProps) {
  const [feedback, setFeedback] = useState('')

  const handleSubmit = () => {
    if (!feedback.trim()) return
    onSubmit(feedback.trim())
    setFeedback('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border/40 rounded-xl shadow-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Request Changes</h3>
        <p className="text-[11px] text-muted-foreground mb-3">
          {hasPR
            ? 'Describe what needs to change. The agent will make the changes directly and update the PR.'
            : 'Describe what needs to change. The agent will re-plan with your feedback and prior work context.'}
        </p>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What needs to change?"
          rows={4}
          className="w-full bg-muted/10 border border-border/40 rounded-lg px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/40 resize-none outline-none focus:border-primary/60"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg text-muted-foreground hover:text-foreground transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!feedback.trim()}
            className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {hasPR ? 'Update PR' : 'Send Feedback'}
          </button>
        </div>
      </div>
    </div>
  )
}
