// apps/desktop/src/features/agents/panels/CodexRulesPanel.tsx
import { useEffect, useId, useReducer, useState } from 'react'
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

type DialogState = {
  createOpen: boolean
  createName: string
  deleteTarget: string | null
}

type DialogAction =
  | { type: 'openCreate' }
  | { type: 'closeCreate' }
  | { type: 'setCreateName'; value: string }
  | { type: 'openDelete'; name: string }
  | { type: 'closeDelete' }

const initialDialogState: DialogState = { createOpen: false, createName: '', deleteTarget: null }

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'openCreate': return { ...state, createOpen: true }
    case 'closeCreate': return { ...state, createOpen: false, createName: '' }
    case 'setCreateName': return { ...state, createName: action.value }
    case 'openDelete': return { ...state, deleteTarget: action.name }
    case 'closeDelete': return { ...state, deleteTarget: null }
    default: return state
  }
}

export function CodexRulesPanel({ items, scope, projectName, saving, onSave, onDelete }: CodexRulesPanelProps) {
  const [selectedName, setSelectedName] = useState<string | null>(() => items[0]?.name ?? null)
  const [dialog, dispatchDialog] = useReducer(dialogReducer, initialDialogState)
  const [error, setError] = useState('')

  useEffect(() => {
    if (selectedName && items.find(item => item.name === selectedName)) return
    setSelectedName(items[0]?.name ?? null)
  }, [items, selectedName])

  const selected = items.find(item => item.name === selectedName) ?? null
  const eyebrow = scope === 'GLOBAL' ? 'Global / Rules' : `${projectName ?? 'Project'} / Rules`

  const handleCreate = async () => {
    const name = dialog.createName.trim()
    if (!name) return
    try { await onSave(name, RULE_TEMPLATE) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
      return
    }
    setSelectedName(name.endsWith('.rules') ? name : `${name}.rules`)
    dispatchDialog({ type: 'closeCreate' })
  }

  const handleDelete = async () => {
    if (!dialog.deleteTarget) return
    try { await onDelete(dialog.deleteTarget) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
    dispatchDialog({ type: 'closeDelete' })
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Rules"
          sub=".codex/rules/ · 0 rules"
        />
        <EmptyStateCard
          title="No rules at this scope"
          description="Codex rules live in .rules files and are loaded by the Codex client to shape tool and command permissions."
          ctaLabel="New rule"
          onCreate={() => dispatchDialog({ type: 'openCreate' })}
        />
        <CreateDialog
          open={dialog.createOpen}
          name={dialog.createName}
          setName={(value) => dispatchDialog({ type: 'setCreateName', value })}
          onCancel={() => dispatchDialog({ type: 'closeCreate' })}
          onCreate={handleCreate}
        />
      </div>
    )
  }

  return (
    <RuleEditor
      key={selected?.name ?? 'none'}
      items={items}
      selected={selected}
      eyebrow={eyebrow}
      saving={!!saving}
      error={error}
      createOpen={dialog.createOpen}
      createName={dialog.createName}
      deleteTarget={dialog.deleteTarget}
      onSelect={setSelectedName}
      onError={setError}
      onSave={onSave}
      onDelete={handleDelete}
      onOpenCreate={() => dispatchDialog({ type: 'openCreate' })}
      onSetCreateName={(value) => dispatchDialog({ type: 'setCreateName', value })}
      onCancelCreate={() => dispatchDialog({ type: 'closeCreate' })}
      onCreate={handleCreate}
      onRequestDelete={(name) => name ? dispatchDialog({ type: 'openDelete', name }) : dispatchDialog({ type: 'closeDelete' })}
      onCloseDelete={() => dispatchDialog({ type: 'closeDelete' })}
    />
  )
}

interface RuleEditorProps {
  items: ProviderFileEntry[]
  selected: ProviderFileEntry | null
  eyebrow: string
  saving: boolean
  error: string
  createOpen: boolean
  createName: string
  deleteTarget: string | null
  onSelect: (name: string) => void
  onError: (message: string) => void
  onSave: (name: string, content: string) => Promise<void>
  onDelete: () => Promise<void>
  onOpenCreate: () => void
  onSetCreateName: (name: string) => void
  onCancelCreate: () => void
  onCreate: () => Promise<void>
  onRequestDelete: (name: string | null) => void
  onCloseDelete: () => void
}

function RuleEditor({
  items,
  selected,
  eyebrow,
  saving,
  error,
  createOpen,
  createName,
  deleteTarget,
  onSelect,
  onError,
  onSave,
  onDelete,
  onOpenCreate,
  onSetCreateName,
  onCancelCreate,
  onCreate,
  onRequestDelete,
  onCloseDelete,
}: RuleEditorProps) {
  const [content, setContent] = useState(selected?.content ?? '')
  const isDirty = selected ? content !== selected.content : false

  const handleSave = async () => {
    if (!selected) return
    onError('')
    try { await onSave(selected.name, content) } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Rules"
        sub={`.codex/rules/ · ${items.length} rule${items.length === 1 ? '' : 's'}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[200px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={onOpenCreate} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New rule
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {items.map(item => (
              <button
                key={item.path}
                onClick={() => onSelect(item.name)}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] truncate ${
                  item.name === selected?.name ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
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

      <ErrorStrip message={error} onDismiss={() => onError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={saving}
        onSave={handleSave}
        onDiscard={() => setContent(selected?.content ?? '')}
        extraLeft={
          selected ? (
            <button
              type="button"
              onClick={() => onRequestDelete(selected.name)}
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
        setName={onSetCreateName}
        onCancel={onCancelCreate}
        onCreate={onCreate}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && onCloseDelete()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete rule</DialogTitle>
            <DialogDescription>This removes the selected rule from disk.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{deleteTarget}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onCloseDelete}>Cancel</Button>
            <Button variant="destructive" onClick={onDelete}>
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
  const nameId = useId()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New rule</DialogTitle>
          <DialogDescription>Creates a new .rules file in .codex/rules.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label htmlFor={nameId} className="text-xs font-semibold text-foreground/60 mb-1.5 block">Rule name</label>
          <input
            id={nameId}
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
