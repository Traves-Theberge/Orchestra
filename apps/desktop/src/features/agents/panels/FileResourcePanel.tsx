import { useState } from 'react'
import { Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@ui/dialog'

export interface FileResourceItem {
  key: string
  name: string
  path: string
  content: string
  badge?: string
  priority?: number
  origin?: string
  depth?: number
}

interface FileResourcePanelProps {
  title: string
  subtitle: string
  emptyTitle: string
  emptyDescription: string
  infoTitle?: string
  infoDescription?: string
  items: FileResourceItem[]
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onDelete?: (path: string) => Promise<void>
  onCreate?: (name: string) => Promise<void>
  createLabel?: string
  createDescription?: string
}

export function FileResourcePanel({
  title,
  subtitle,
  emptyTitle,
  emptyDescription,
  infoTitle,
  infoDescription,
  items,
  saving,
  onSave,
  onDelete,
  onCreate,
  createLabel = 'Add',
  createDescription = 'Create a new resource.',
}: FileResourcePanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createPending, setCreatePending] = useState(false)

  const effectiveSelectedKey = selectedKey && items.some(item => item.key === selectedKey)
    ? selectedKey
    : (items[0]?.key ?? null)
  const selected = items.find(item => item.key === effectiveSelectedKey) ?? null
  const content = selected ? (drafts[selected.key] ?? selected.content) : ''
  const isDirty = selected ? content !== selected.content : false

  const handleCreate = async () => {
    if (!onCreate || !createName.trim()) return
    setCreatePending(true)
    try {
      await onCreate(createName.trim())
      setCreateOpen(false)
      setCreateName('')
    } finally {
      setCreatePending(false)
    }
  }

  return (
    <div className="flex h-full">
      <div className="w-[220px] flex flex-col border-r border-border/30 shrink-0">
        <div className="px-3 pt-3 pb-2 shrink-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">{title}</h3>
          <p className="text-[10px] text-muted-foreground/40 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {items.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSelectedKey(item.key)}
              className={`w-full text-left px-2.5 py-2 rounded-md transition-colors border ${
                item.key === effectiveSelectedKey
                  ? 'bg-primary/8 text-primary border-primary/20'
                  : 'text-muted-foreground hover:bg-muted/10 border-transparent'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold truncate flex-1">{item.name}</span>
                {item.badge ? (
                  <span className="text-[8px] font-bold uppercase tracking-wider rounded-full border border-border/40 px-1.5 py-0.5 text-muted-foreground/60">
                    {item.badge}
                  </span>
                ) : null}
              </div>
              {(item.origin || typeof item.depth === 'number') ? (
                <p className="text-[8px] mt-1 uppercase tracking-wider text-muted-foreground/35">
                  {buildStackMeta(item.origin, item.depth)}
                </p>
              ) : null}
              <p className="text-[9px] mt-1 font-mono text-muted-foreground/40 truncate">{item.path}</p>
            </button>
          ))}
        </div>
        {onCreate ? (
          <div className="p-2 shrink-0">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="w-full h-7 text-[10px] text-muted-foreground/50 hover:text-foreground">
              <Plus size={10} className="mr-1" /> {createLabel}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-w-0 flex flex-col p-4 gap-3">
        {selected ? (
          <>
            {infoTitle && infoDescription ? (
              <div className="rounded-lg border border-border/30 bg-muted/10 px-3 py-2 shrink-0">
                <p className="text-[11px] font-semibold">{infoTitle}</p>
                <p className="text-[10px] text-muted-foreground/50 mt-1">{infoDescription}</p>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate">{selected.name}</h3>
                {(selected.origin || typeof selected.depth === 'number') ? (
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground/35 mt-0.5">
                    {buildStackMeta(selected.origin, selected.depth)}
                  </p>
                ) : null}
                <p className="text-[10px] text-muted-foreground/50 mt-0.5 font-mono truncate">{selected.path}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isDirty ? <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest animate-pulse">Unsaved</span> : null}
                {onDelete ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(selected.path)}
                    className="h-7 text-[10px] text-muted-foreground/50 hover:text-red-400"
                  >
                    <Trash2 size={10} />
                  </Button>
                ) : null}
                {isDirty ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDrafts(prev => ({ ...prev, [selected.key]: selected.content }))}
                      className="h-7 text-[10px]"
                    >
                      <RotateCcw size={10} className="mr-1" /> Discard
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => onSave(selected.path, content)}
                      disabled={saving === selected.path}
                      className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg"
                    >
                      {saving === selected.path ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
                      Save
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            <textarea
              value={content}
              onChange={(event) => {
                if (!selected) return
                setDrafts(prev => ({ ...prev, [selected.key]: event.target.value }))
              }}
              className="flex-1 min-h-0 bg-muted/10 rounded-lg border border-border/30 px-4 py-3 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:border-primary/30 resize-none transition-colors"
              spellCheck={false}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground/20">
            <div className="text-center space-y-2">
              <p className="text-sm font-bold uppercase tracking-widest">{emptyTitle}</p>
              <p className="text-[10px]">{emptyDescription}</p>
            </div>
          </div>
        )}
      </div>

      {onCreate ? (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{createLabel}</DialogTitle>
              <DialogDescription>{createDescription}</DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Name</label>
              <input
                autoFocus
                value={createName}
                onChange={(event) => setCreateName(event.target.value.replace(/[^a-zA-Z0-9._/-]/g, '-'))}
                onKeyDown={(event) => event.key === 'Enter' && createName.trim() && handleCreate()}
                placeholder="e.g. code-review"
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setCreateOpen(false); setCreateName('') }}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!createName.trim() || createPending}>
                <Plus className="size-4 mr-2" />
                {createPending ? 'Creating…' : createLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

function buildStackMeta(origin?: string, depth?: number): string {
  const parts: string[] = []

  if (origin) {
    parts.push(origin)
  }

  if (typeof depth === 'number') {
    parts.push(`depth ${depth}`)
  }

  return parts.join(' · ')
}
