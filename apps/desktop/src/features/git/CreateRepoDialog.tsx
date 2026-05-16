import { useId, useState } from 'react'
import { Github, Lock, Globe } from 'lucide-react'

export interface CreateRepoDialogProps {
  projectName: string
  onCancel: () => void
  onCreate: (opts: { name: string; description: string; private: boolean }) => Promise<void>
}

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

export function CreateRepoDialog({ projectName, onCancel, onCreate }: CreateRepoDialogProps) {
  const [name, setName] = useState(() => toKebabCase(projectName))
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const nameId = useId()
  const descriptionId = useId()
  const visibilityId = useId()

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await onCreate({ name: name.trim(), description, private: isPrivate })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Repository creation failed'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-popover rounded-xl shadow-xl max-w-md w-full mx-4 border border-border/60 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-2 mb-1">
            <Github size={14} className="text-muted-foreground/60" strokeWidth={2.25} />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">GitHub</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">New repository</h2>
          <p className="text-[12px] text-muted-foreground/70 mt-1.5">Push this project to GitHub.</p>
        </div>

        <div className="h-px bg-border/40" />

        {/* Form */}
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">Repository name</label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              placeholder="my-repo"
              className="w-full h-9 px-3 rounded-md bg-muted/30 font-mono text-[12.5px] placeholder:text-muted-foreground/40 outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={descriptionId} className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">Description</label>
            <textarea
              id={descriptionId}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
              placeholder="Optional"
              className="w-full px-3 py-2 rounded-md bg-muted/30 text-[12.5px] tracking-tight placeholder:text-muted-foreground/40 resize-none outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <span id={visibilityId} className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">Visibility</span>
            <div aria-labelledby={visibilityId} className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsPrivate(true)}
                disabled={loading}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-left transition-colors ${
                  isPrivate
                    ? 'bg-foreground/[0.06] ring-1 ring-primary/40'
                    : 'bg-muted/20 hover:bg-foreground/[0.03]'
                } disabled:opacity-50`}
              >
                <Lock size={13} className={isPrivate ? 'text-primary' : 'text-muted-foreground/60'} strokeWidth={2.25} />
                <div className="flex flex-col">
                  <span className={`text-[12px] font-semibold tracking-tight ${isPrivate ? 'text-foreground' : 'text-foreground/80'}`}>Private</span>
                  <span className="text-[10.5px] text-muted-foreground/60">Only you</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setIsPrivate(false)}
                disabled={loading}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-left transition-colors ${
                  !isPrivate
                    ? 'bg-foreground/[0.06] ring-1 ring-primary/40'
                    : 'bg-muted/20 hover:bg-foreground/[0.03]'
                } disabled:opacity-50`}
              >
                <Globe size={13} className={!isPrivate ? 'text-primary' : 'text-muted-foreground/60'} strokeWidth={2.25} />
                <div className="flex flex-col">
                  <span className={`text-[12px] font-semibold tracking-tight ${!isPrivate ? 'text-foreground' : 'text-foreground/80'}`}>Public</span>
                  <span className="text-[10.5px] text-muted-foreground/60">Anyone</span>
                </div>
              </button>
            </div>
          </div>

          {error && (
            <p className="text-[11.5px] text-destructive">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-3 flex justify-end gap-2 border-t border-border/40 bg-foreground/[0.02]">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex items-center h-8 px-3 rounded-md text-[12px] font-medium text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="inline-flex items-center h-8 px-3.5 rounded-md text-[12px] font-medium tracking-tight bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {loading ? 'Creating…' : 'Create repository'}
          </button>
        </div>
      </div>
    </div>
  )
}
