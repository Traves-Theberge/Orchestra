import { Trash2 } from 'lucide-react'

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
  open: boolean
  target: { identifier: string; title?: string } | null
  pending: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteTaskDialog({ open, target, pending, error, onOpenChange, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-500">
            <Trash2 className="size-5" />
            Delete Task
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this task? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {target && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-mono text-primary">{target.identifier}</p>
              {target.title && (
                <p className="mt-1 text-sm text-muted-foreground">{target.title}</p>
              )}
            </div>
          )}
          {error ? (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            <Trash2 className="size-4 mr-2" />
            {pending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
