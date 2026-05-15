import { useId } from 'react'

import { Button } from '@ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog'

type Props = {
  target: { identifier: string; targetState: string } | null
  text: string
  pending: boolean
  onTextChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}

export function FeedbackDialog({ target, text, pending, onTextChange, onClose, onSubmit }: Props) {
  const feedbackId = useId()

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Provide Feedback</DialogTitle>
          <DialogDescription>
            Moving from Review back to {target?.targetState === 'Todo' ? 'To Do' : 'In Progress'} requires feedback explaining what needs to change.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label htmlFor={feedbackId} className="text-xs font-semibold text-muted-foreground mb-1.5 block">Feedback</label>
          <textarea
            id={feedbackId}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="Describe what needs to be fixed or changed…"
            rows={4}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button
            disabled={!text.trim() || pending}
            onClick={onSubmit}
          >
            {pending ? 'Moving…' : `Move to ${target?.targetState === 'Todo' ? 'To Do' : 'In Progress'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
