import { useEffect, useId, useState } from 'react'
import { Folder, Loader2 } from 'lucide-react'
import { Button } from '@ui/button'
import { toDisplayError } from '@core/api/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog'

/**
 * Modal dialog for registering a new project by selecting or entering
 * its root filesystem path. Supports native folder picker via the desktop bridge.
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (path: string) => Promise<void>
}) {
  const [path, setPath] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pathId = useId()

  useEffect(() => {
    if (open) {
      setPath('')
      setError(null)
    }
  }, [open])

  const handleBrowse = async () => {
    setError(null)
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge || typeof desktopBridge.selectFolder !== 'function') {
      setError('Folder browsing is unavailable. Enter the absolute project folder path below.')
      return
    }
    setPending(true)
    try {
      const selected = await desktopBridge.selectFolder()
      if (selected) setPath(selected)
    } catch (error) {
      setError(`Could not choose a folder: ${toDisplayError(error)}. Enter the absolute path or try browsing again.`)
    } finally {
      setPending(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!path.trim()) return
    setError(null)
    setPending(true)
    try {
      await onSubmit(path.trim())
      onOpenChange(false)
    } catch (error) {
      setError(`Could not add project: ${toDisplayError(error)}. Check the folder path and backend project access, then try again.`)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border shadow-2xl">
        <DialogHeader className="border-b border-border/40 pb-4">
          <DialogTitle className="text-xl font-bold tracking-tight">Add Project</DialogTitle>
          <DialogDescription className="text-muted-foreground/70">
            Enter the absolute path to your local git repository.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-6">
          <div className="space-y-1.5">
            <label htmlFor={pathId} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1">Workspace Root Path</label>
            <div className="flex gap-2">
              <input
                id={pathId}
                className="h-11 flex-1 rounded-xl border border-border bg-background px-4 text-sm font-medium focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
                placeholder="/home/user/projects/my-app"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                required
                disabled={pending}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleBrowse}
                className="h-11 rounded-xl border-dashed px-3 text-muted-foreground hover:text-primary hover:border-primary/50"
                tooltip="Browse filesystem"
                aria-label="Browse filesystem"
                disabled={pending}
              >
                <Folder className="size-4" />
              </Button>
            </div>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !path.trim()}
              className="px-6 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
            >
              {pending ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin-smooth" />
                  <span>Adding…</span>
                </div>
              ) : 'Add Project'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
