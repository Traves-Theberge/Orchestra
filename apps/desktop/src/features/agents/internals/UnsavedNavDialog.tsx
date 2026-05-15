import { Button } from '@ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@ui/dialog'

interface UnsavedNavDialogProps {
  pendingNav: (() => void) | null
  setPendingNav: (nav: (() => void) | null) => void
  setDirty: (dirty: boolean) => void
}

export function UnsavedNavDialog({ pendingNav, setPendingNav, setDirty }: UnsavedNavDialogProps) {
  return (
    <Dialog
      open={!!pendingNav}
      onOpenChange={(o) => { if (!o) setPendingNav(null) }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>
            You have unsaved edits in this panel. Switching will discard them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setPendingNav(null)}>
            Keep editing
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const apply = pendingNav
              setPendingNav(null)
              setDirty(false)
              apply?.()
            }}
          >
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
