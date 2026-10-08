import { X } from 'lucide-react'

const DEFAULT_MESSAGE = 'Files were restored to before that message.'
const UNDO_HINT = 'Undo puts back the files from just before the restore and replaces later changes.'

/** One quiet line after a files restore, offering to put the files back. */
export function UndoRestoreBanner({ message, busy, error, onUndo, onDismiss }: {
  message?: string
  busy: boolean
  error: string | null
  onUndo: () => void
  onDismiss: () => void
}) {
  return (
    <div role="status" className="mb-2 px-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">{message || DEFAULT_MESSAGE}</span>
        <button type="button" disabled={busy} onClick={onUndo} className="shrink-0 font-medium text-foreground/80 transition-colors hover:text-foreground disabled:opacity-40">Undo restore</button>
        <button type="button" aria-label="Dismiss" title="Dismiss" onClick={onDismiss} className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground">
          <X className="size-3" />
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground/70">{UNDO_HINT}</p>
      {error && <p className="mt-1 text-destructive">{error}</p>}
    </div>
  )
}
