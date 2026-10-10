import { useRef, useState, type KeyboardEvent } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter } from '@ui/dialog'
import type { WorkspaceChatFileChange, WorkspaceChatRewindPreview } from '@core/api/client'

export type RewindMode = 'edit' | 'regenerate' | 'switch'

export const REWIND_STANDING_NOTE = 'Does not undo commits, pushes, installs, network actions or ignored files.'

const COPY: Record<RewindMode, { title: string; description: string; confirm: string }> = {
  edit: { title: 'Edit and re-run from here', description: 'The conversation continues from your edited message. What came after stays available as the other version.', confirm: 'Edit and re-run' },
  regenerate: { title: 'Regenerate this response', description: 'The prompt runs again for a new response. The current one stays available as the other version.', confirm: 'Regenerate' },
  switch: { title: 'Switch version', description: 'The conversation shows the other version of this message and continues from there.', confirm: 'Switch' },
}

const CHANGE_WORDS: Record<WorkspaceChatFileChange['kind'], string> = { create: 'restored', modify: 'changed back', delete: 'removed', keep: 'left as is (not in any checkpoint)' }

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

type RewindDialogProps = {
  open: boolean
  mode: RewindMode
  /** What a files restore would change; null while loading, after a failure, or for switch (no preview). */
  preview: WorkspaceChatRewindPreview | null
  previewLoading: boolean
  previewError: string | null
  busy: boolean
  error: string | null
  /** Conversations without a working folder (Maestro): no files choice at all. */
  filesHidden?: boolean
  onConfirm: (restoreFiles: boolean) => void
  onCancel: () => void
}

/** Confirms an edit, regenerate or version switch, and whether the files go back too. */
export function RewindDialog({ open, mode, preview, previewLoading, previewError, busy, error, filesHidden = false, onConfirm, onCancel }: RewindDialogProps) {
  const [restoreFiles, setRestoreFiles] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  // Every opening starts again at the safe choice.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) { setRestoreFiles(false); setShowFiles(false) }
  }
  const copy = COPY[mode]
  const filesReason = filesHidden ? '' : mode === 'switch' ? undefined
    : previewLoading ? 'Checking the files…'
    : !preview ? 'The files could not be checked'
    : !preview.has_checkpoint || !preview.files_available ? 'No file checkpoint was saved for this message'
    : preview.busy_reason || undefined
  const filesEnabled = !filesHidden && filesReason === undefined
  const chosenFiles = restoreFiles && filesEnabled
  const usablePreview = mode !== 'switch' && filesEnabled && preview ? preview : null
  const since = new Set(usablePreview?.changed_since_turn ?? [])
  // Kept files (ignored or over the cap now, so no snapshot holds them) are
  // listed but never touched.
  const listed = usablePreview?.changes.length ?? 0
  const keptCount = usablePreview?.changes.filter(change => change.kind === 'keep').length ?? 0
  const changeCount = listed - keptCount

  const radios = useRef<Record<'conversation' | 'files', HTMLButtonElement | null>>({ conversation: null, files: null })
  // Arrow keys move between the enabled choices, like native radios.
  const moveChoice = (event: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key) || !filesEnabled) return
    event.preventDefault()
    const next = !chosenFiles
    setRestoreFiles(next)
    radios.current[next ? 'files' : 'conversation']?.focus()
  }
  const choice = (value: boolean, label: string, detail: string, disabledReason?: string) => {
    const selected = chosenFiles === value
    return (
      <button ref={element => { radios.current[value ? 'files' : 'conversation'] = element }} type="button" role="radio" aria-checked={selected}
        tabIndex={selected ? 0 : -1} disabled={!!disabledReason} onClick={() => setRestoreFiles(value)}
        className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed ${selected ? 'bg-foreground/[0.07]' : 'hover:bg-foreground/[0.04]'}`}>
        <span className="flex items-center gap-2 text-sm">
          <span aria-hidden="true" data-radio-indicator className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${selected ? 'border-foreground' : disabledReason ? 'border-muted-foreground/50' : 'border-muted-foreground'}`}>
            {selected && <span className="size-1.5 rounded-full bg-foreground" />}
          </span>
          <span className={disabledReason ? 'text-muted-foreground' : 'text-foreground'}>{label}</span>
        </span>
        <span className="pl-5.5 text-xs text-muted-foreground">{disabledReason || detail}</span>
      </button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={value => { if (!value && !busy) onCancel() }}>
      <DialogContent srTitle={copy.title} showCloseButton={!busy} className="max-w-lg"
        onEscapeKeyDown={event => { if (busy) event.preventDefault() }}
        onPointerDownOutside={event => { if (busy) event.preventDefault() }}
        onInteractOutside={event => { if (busy) event.preventDefault() }}
        // Escape belongs to the dialog; it must not reach the chat (where it interrupts a turn).
        onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}>
        <div className="space-y-2">
          {/* DialogContent already names the dialog with an sr-only title; this one is visual only. */}
          <p aria-hidden="true" className="text-lg font-semibold">{copy.title}</p>
          <DialogDescription>{copy.description}</DialogDescription>
        </div>
        <div role="radiogroup" aria-label="What goes back" onKeyDown={moveChoice} className="space-y-0.5">
          {choice(false, 'Conversation only', 'Files in the folder stay as they are now.')}
          {!filesHidden && choice(true, 'Conversation and files', mode === 'switch' ? 'Files go back to the state at the end of that version.' : 'Files in the folder go back to how they were before that message.', filesReason)}
        </div>
        {!filesHidden && previewError && <p className="text-xs text-muted-foreground">Could not check the files: {previewError}</p>}
        {usablePreview && (
          <div className="text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>{changeCount ? `${plural(changeCount, 'file', 'files')} will change` : 'No files will change'}</span>
              {listed > 0 && (
                <button type="button" aria-expanded={showFiles} onClick={() => setShowFiles(value => !value)} className="text-foreground/70 transition-colors hover:text-foreground">
                  {showFiles ? 'Hide files' : 'Show files'}
                </button>
              )}
            </div>
            {showFiles && (
              <ul className="mt-1.5 max-h-48 space-y-0.5 overflow-auto">
                {usablePreview.changes.map(change => (
                  <li key={change.path} className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate font-mono text-[11px] text-foreground/80" title={change.path}>{change.path}</span>
                    <span className="shrink-0">{CHANGE_WORDS[change.kind]}</span>
                    {since.has(change.path) && <span className="shrink-0 text-amber-600 dark:text-amber-400">edited since this turn</span>}
                  </li>
                ))}
              </ul>
            )}
            {keptCount > 0 && <p className="mt-1">{keptCount === 1 ? '1 file is left as is' : `${keptCount} files are left as is`}</p>}
            {usablePreview.skipped > 0 && <p className="mt-1">{usablePreview.skipped === 1 ? '1 large file is not included' : `${usablePreview.skipped} large files are not included`}</p>}
          </div>
        )}
        <p className="text-xs text-muted-foreground/80">{REWIND_STANDING_NOTE}</p>
        {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">Cancel</button>
          <button type="button" disabled={busy || (chosenFiles && previewLoading)} onClick={() => onConfirm(chosenFiles)} className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50">{copy.confirm}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
