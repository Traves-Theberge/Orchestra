// apps/desktop/src/features/agents/panels/CodexRulesPanel.tsx
import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import { TOKENS } from '../tokens'
import type { Scope } from '../types'
import type { ProviderFileEntry } from '@core/api/client'

interface CodexRulesPanelProps {
  items: ProviderFileEntry[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (name: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
}

const RULE_TEMPLATE = `prefix_rule("git", "status")
Always check the repository state before modifying files.
`

export function CodexRulesPanel({ items, scope, projectName, saving, onSave, onDelete }: CodexRulesPanelProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!selectedName && items.length > 0) setSelectedName(items[0].name)
  }, [selectedName, items])

  useEffect(() => {
    if (selectedName && !items.find(item => item.name === selectedName)) {
      setSelectedName(items.length > 0 ? items[0].name : null)
    }
  }, [selectedName, items])

  const selected = items.find(item => item.name === selectedName) ?? null

  useEffect(() => {
    setContent(selected?.content ?? '')
  }, [selected])

  const isDirty = selected ? content !== selected.content : false
  const eyebrow = scope === 'GLOBAL' ? 'Global / Rules' : `${projectName ?? 'Project'} / Rules`

  const handleCreate = async () => {
    const name = createName.trim()
    if (!name) return
    try { await onSave(name, RULE_TEMPLATE) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
      return
    }
    setSelectedName(name.endsWith('.rules') ? name : `${name}.rules`)
    setCreateOpen(false)
    setCreateName('')
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try { await onDelete(deleteTarget) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
    setDeleteTarget(null)
  }

  const handleSave = async () => {
    if (!selected) return
    setError('')
    try { await onSave(selected.name, content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full p-[18px] space-y-[14px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Rules"
          sub=".codex/rules/ · 0 rules"
        />
        <EmptyStateCard
          title="No rules at this scope"
          description="Codex rules live in .rules files and are loaded by the Codex client to shape tool and command permissions."
          ctaLabel="New rule"
          onCreate={() => setCreateOpen(true)}
        />
        <CreateDialog
          open={createOpen}
          name={createName}
          setName={setCreateName}
          onCancel={() => { setCreateOpen(false); setCreateName('') }}
          onCreate={handleCreate}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Rules"
        sub={`.codex/rules/ · ${items.length} rule${items.length === 1 ? '' : 's'}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[200px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New rule
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {items.map(item => (
              <button
                key={item.path}
                onClick={() => setSelectedName(item.name)}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] truncate ${
                  item.name === selectedName ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {selected ? (
            <>
              <div className="text-[10px] text-foreground/45 font-mono">
                {selected.name}
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={RULE_TEMPLATE}
                className="flex-1 min-h-0 bg-muted/10 rounded-lg border border-border/30 px-4 py-3 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:border-primary/30 resize-none transition-colors"
                spellCheck={false}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-foreground/30">
              Select a rule or create one
            </div>
          )}
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={() => setContent(selected?.content ?? '')}
        extraLeft={
          selected ? (
            <button
              type="button"
              onClick={() => setDeleteTarget(selected.name)}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />

      <CreateDialog
        open={createOpen}
        name={createName}
        setName={setCreateName}
        onCancel={() => { setCreateOpen(false); setCreateName('') }}
        onCreate={handleCreate}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete rule</DialogTitle>
            <DialogDescription>This removes the selected rule from disk.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{deleteTarget}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 size={14} className="mr-2" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CreateDialog({
  open, name, setName, onCancel, onCreate,
}: {
  open: boolean
  name: string
  setName: (s: string) => void
  onCancel: () => void
  onCreate: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New rule</DialogTitle>
          <DialogDescription>Creates a new .rules file in .codex/rules.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label className="text-xs font-semibold text-foreground/60 mb-1.5 block">Rule name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate()}
            placeholder="e.g. git-safety"
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onCreate} disabled={!name.trim()}>
            <Plus size={12} className="mr-2" /> Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
