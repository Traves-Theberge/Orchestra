// apps/desktop/src/widgets/agents/panels/InstructionsPanel.tsx
import { useState, useEffect } from 'react'
import { Save, Loader2, RotateCcw, FilePlus, Trash2 } from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@ui/dialog'

interface InstructionsPanelProps {
  content: string
  path: string
  exists: boolean
  saving: string | null
  onSave: (content: string) => Promise<void>
  onDelete?: () => Promise<void>
}

export function InstructionsPanel({ content: propsContent, path, exists, saving, onSave, onDelete }: InstructionsPanelProps) {
  const [content, setContent] = useState(propsContent)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const isDirty = content !== propsContent

  useEffect(() => {
    setContent(propsContent)
  }, [propsContent])

  const handleDelete = async () => {
    if (!onDelete) return
    setDeletePending(true)
    try {
      await onDelete()
      setDeleteOpen(false)
    } finally {
      setDeletePending(false)
    }
  }

  if (!exists) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <p className="text-sm font-medium">No CLAUDE.md found</p>
        <p className="text-[10px] font-mono text-muted-foreground/50">{path}</p>
        <Button
          size="sm"
          onClick={() => onSave('')}
          disabled={!!saving}
          className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg"
        >
          {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <FilePlus size={12} className="mr-1.5" />}
          Create
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex flex-col flex-1 min-h-0 gap-3">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-bold">CLAUDE.md</h3>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5 font-mono">{path}</p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest animate-pulse">Unsaved</span>}
          {onDelete && (
            <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)} className="h-7 text-[10px] text-muted-foreground/50 hover:text-red-400">
              <Trash2 size={10} />
            </Button>
          )}
          {isDirty && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setContent(propsContent)} className="h-7 text-[10px]">
                <RotateCcw size={10} className="mr-1" /> Discard
              </Button>
              <Button
                size="sm"
                onClick={() => onSave(content)}
                disabled={!!saving}
                className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg"
              >
                {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
                Save
              </Button>
            </>
          )}
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="# CLAUDE.md&#10;&#10;Describe how Claude should work on your codebase..."
        className="flex-1 min-h-0 bg-muted/10 rounded-lg border border-border/30 px-4 py-3 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:border-primary/30 resize-none transition-colors"
        spellCheck={false}
      />
      </div>

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="h-5 w-5" />
              Delete CLAUDE.md
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this instructions file? This will remove it from disk and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-mono text-primary">{path}</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deletePending}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deletePending}>
              <Trash2 className="h-4 w-4 mr-2" />
              {deletePending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
