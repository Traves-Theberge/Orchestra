// apps/desktop/src/widgets/agents/panels/SubAgentsPanel.tsx
import { useState, useEffect } from 'react'
import { Save, Loader2, RotateCcw, Trash2, Plus } from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@ui/dialog'
import type { ClaudeFileEntry } from '@core/api/client'

interface FileListPanelProps {
  items: ClaudeFileEntry[]
  saving: string | null
  onSave: (name: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
}

const AGENT_TEMPLATE = `---
name: {{NAME}}
description: Describe what this agent does
model: sonnet
tools: Read, Grep, Glob, Bash
permissionMode: default
maxTurns: 50
---

You are a specialized agent. Describe your role and instructions here.
`

export function SubAgentsPanel({ items, saving, onSave, onDelete }: FileListPanelProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createPending, setCreatePending] = useState(false)

  useEffect(() => {
    if (!selectedName && items.length > 0) setSelectedName(items[0].name)
  }, [selectedName, items])

  useEffect(() => {
    if (selectedName && !items.find(i => i.name === selectedName))
      setSelectedName(items.length > 0 ? items[0].name : null)
  }, [selectedName, items])

  const selected = items.find(i => i.name === selectedName) ?? null

  useEffect(() => { setContent(selected?.content ?? '') }, [selected])

  const isDirty = selected ? content !== selected.content : false

  const handleCreate = async () => {
    const name = createName.trim()
    if (!name) return
    setCreatePending(true)
    try {
      const template = AGENT_TEMPLATE.replace('{{NAME}}', name)
      await onSave(name, template)
      setSelectedName(name)
      setCreateOpen(false)
      setCreateName('')
    } finally {
      setCreatePending(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setDeletePending(true)
    try {
      await onDelete(deleteTarget)
      setDeleteTarget(null)
    } finally {
      setDeletePending(false)
    }
  }

  return (
    <div className="flex h-full">
      {/* Left side: file list */}
      <div className="w-[200px] flex flex-col border-r border-border/30 shrink-0">
        <div className="px-3 pt-3 pb-2 shrink-0">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">Sub-agents</h3>
          <p className="text-[10px] text-muted-foreground/40 mt-0.5">.claude/agents/</p>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {items.map(item => (
            <button
              key={item.name}
              onClick={() => setSelectedName(item.name)}
              className={`w-full text-left px-2.5 py-1.5 rounded-md text-[11px] truncate transition-colors ${
                item.name === selectedName
                  ? 'bg-primary/8 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:bg-muted/10 border border-transparent'
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="p-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="w-full h-7 text-[10px] text-muted-foreground/50 hover:text-foreground">
            <Plus size={10} className="mr-1" /> Add Agent
          </Button>
        </div>
      </div>

      {/* Right side: editor */}
      <div className="flex-1 min-w-0 flex flex-col p-4 gap-3">
        {selected ? (
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-sm font-bold truncate">{selected.name}</h3>
              <div className="flex items-center gap-2">
                {isDirty && <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest animate-pulse">Unsaved</span>}
                <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(selected.name)} className="h-7 text-[10px] text-muted-foreground/50 hover:text-red-400">
                  <Trash2 size={10} />
                </Button>
                {isDirty && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setContent(selected.content)} className="h-7 text-[10px]">
                      <RotateCcw size={10} className="mr-1" /> Discard
                    </Button>
                    <Button size="sm" onClick={() => onSave(selected.name, content)} disabled={!!saving} className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg">
                      {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />} Save
                    </Button>
                  </>
                )}
              </div>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={AGENT_TEMPLATE.replace('{{NAME}}', 'my-agent')}
              className="flex-1 min-h-0 bg-muted/10 rounded-lg border border-border/30 px-4 py-3 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:border-primary/30 resize-none transition-colors"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground/20">
            <div className="text-center space-y-2">
              <p className="text-sm font-bold uppercase tracking-widest">No sub-agent selected</p>
              <p className="text-[10px]">Sub-agents run in isolated contexts with their own tools and model</p>
            </div>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Sub-agent</DialogTitle>
            <DialogDescription>
              Creates a new agent directory in .claude/agents/ with an AGENT.md template including frontmatter for model, tools, and permissions.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Agent Name</label>
            <input
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && createName.trim() && handleCreate()}
              placeholder="e.g. code-reviewer"
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-[10px] text-muted-foreground/50 mt-1.5">Lowercase letters, numbers, hyphens, underscores only</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCreateOpen(false); setCreateName('') }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!createName.trim() || createPending}>
              <Plus className="h-4 w-4 mr-2" />
              {createPending ? 'Creating...' : 'Create Agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="h-5 w-5" />
              Delete Sub-agent
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this sub-agent? This will remove the file from disk and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="py-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-mono text-primary">{deleteTarget}</p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deletePending}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deletePending}>
              <Trash2 className="h-4 w-4 mr-2" />
              {deletePending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
