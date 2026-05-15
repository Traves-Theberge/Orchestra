// apps/desktop/src/features/agents/panels/OpenCodeCommandsPanel.tsx
import { useEffect, useId, useMemo, useReducer, useState } from 'react'
import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@ui/dialog'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import { TOKENS } from '../tokens'
import type { Scope } from '../types'
import type { FileResourceItem } from './FileResourcePanel'
import { buildOpenCodeMarkdown, parseOpenCodeMarkdown } from './open-code-frontmatter'

interface OpenCodeCommandsPanelProps {
  items: FileResourceItem[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
  onCreate: (name: string) => Promise<void>
}

interface CommandForm {
  description: string
  agent: string
  model: string
  body: string
}

type CommandFormAction =
  | { type: 'set'; field: keyof CommandForm; value: string }
  | { type: 'reset'; value: CommandForm }

function commandFormReducer(state: CommandForm, action: CommandFormAction): CommandForm {
  if (action.type === 'reset') return action.value
  return { ...state, [action.field]: action.value }
}

function deriveCommandForm(parsed: ReturnType<typeof parseOpenCodeMarkdown>): CommandForm {
  return {
    description: parsed.frontmatter.description ?? '',
    agent: parsed.frontmatter.agent ?? '',
    model: parsed.frontmatter.model ?? '',
    body: parsed.body,
  }
}

export function OpenCodeCommandsPanel({ items, scope, projectName, saving, onSave, onDelete, onCreate }: OpenCodeCommandsPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [createState, setCreateState] = useState<{ open: boolean; name: string; pending: boolean }>({ open: false, name: '', pending: false })
  const [deleteTarget, setDeleteTarget] = useState<FileResourceItem | null>(null)
  const [error, setError] = useState('')

  const effectiveSelectedKey = selectedKey && items.some(item => item.key === selectedKey)
    ? selectedKey
    : (items[0]?.key ?? null)
  const selected = items.find(item => item.key === effectiveSelectedKey) ?? null

  const parsed = useMemo(() => parseOpenCodeMarkdown(selected?.content ?? ''), [selected?.content])
  const [form, dispatchForm] = useReducer(commandFormReducer, parsed, deriveCommandForm)
  const { description, agent, model, body } = form

  useEffect(() => {
    dispatchForm({ type: 'reset', value: deriveCommandForm(parsed) })
    setError('')
  }, [parsed])

  const isDirty = selected
    ? buildOpenCodeMarkdown({ description, agent, model }, body) !== selected.content
    : false

  const eyebrow = scope === 'GLOBAL' ? 'Global / Commands' : `${projectName ?? 'Project'} / Commands`

  const handleCreate = async () => {
    const next = createState.name.trim()
    if (!next) return
    setCreateState((prev) => ({ ...prev, pending: true }))
    try {
      await onCreate(next)
      setCreateState({ open: false, name: '', pending: false })
    } finally {
      setCreateState((prev) => ({ ...prev, pending: false }))
    }
  }

  const handleSave = async () => {
    if (!selected) return
    setError('')
    try {
      await onSave(selected.path, buildOpenCodeMarkdown({ description, agent, model }, body))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleDiscard = () => {
    dispatchForm({ type: 'reset', value: deriveCommandForm(parsed) })
  }

  const setCreateOpen = (open: boolean) => setCreateState((prev) => ({ ...prev, open, name: open ? prev.name : '' }))
  const setCreateName = (name: string) => setCreateState((prev) => ({ ...prev, name }))

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Commands"
          sub="OpenCode custom commands"
        />
        <EmptyStateCard
          title="No commands at this scope"
          description="OpenCode commands are Markdown files with frontmatter. Use description, optional agent, and optional model to define execution context."
          ctaLabel="New command"
          onCreate={() => setCreateOpen(true)}
        />
        <CreateDialog
          open={createState.open}
          name={createState.name}
          setName={setCreateName}
          pending={createState.pending}
          onCancel={() => setCreateOpen(false)}
          onCreate={handleCreate}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Commands"
        sub={`${items.length} command${items.length === 1 ? '' : 's'}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New command
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {items.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedKey(item.key)}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 ${
                  item.key === effectiveSelectedKey ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
                }`}
              >
                <span className="truncate flex-1">{item.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {selected ? (
            <>
              <div className="text-[10px] text-foreground/45 font-mono truncate">{selected.path}</div>
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
                <Field label="Description">
                  <input value={description} onChange={(event) => dispatchForm({ type: 'set', field: 'description', value: event.target.value })} placeholder="Run tests with coverage" className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>

                <Field label="Agent">
                  <input value={agent} onChange={(event) => dispatchForm({ type: 'set', field: 'agent', value: event.target.value })} placeholder="build" className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>

                <Field label="Model">
                  <input value={model} onChange={(event) => dispatchForm({ type: 'set', field: 'model', value: event.target.value })} placeholder="anthropic/claude-sonnet-4-5" className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>

                <Field label="Prompt">
                  <textarea value={body} onChange={(event) => dispatchForm({ type: 'set', field: 'body', value: event.target.value })} className="min-h-[260px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" spellCheck={false} />
                </Field>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-foreground/30">
              Select a command or create one
            </div>
          )}
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === selected?.path}
        onSave={handleSave}
        onDiscard={handleDiscard}
        extraLeft={
          selected ? (
            <button
              type="button"
              onClick={() => setDeleteTarget(selected)}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />

      <CreateDialog
        open={createState.open}
        name={createState.name}
        setName={setCreateName}
        pending={createState.pending}
        onCancel={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete command</DialogTitle>
            <DialogDescription>This removes the file from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{deleteTarget?.name}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              if (!deleteTarget) return
              const name = deleteTarget.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? deleteTarget.path
              await onDelete(name)
              setDeleteTarget(null)
              setSelectedKey(null)
            }}>
              <Trash2 size={14} className="mr-2" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CreateDialog({
  open, name, setName, pending, onCancel, onCreate,
}: {
  open: boolean
  name: string
  setName: (s: string) => void
  pending: boolean
  onCancel: () => void
  onCreate: () => void
}) {
  const nameId = useId()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Command</DialogTitle>
          <DialogDescription>Create a new OpenCode command Markdown file with frontmatter.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label htmlFor={nameId} className="text-xs font-semibold text-muted-foreground mb-1.5 block">Name</label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9._/-]/g, '-'))}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate()}
            placeholder="e.g. test"
            className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onCreate} disabled={!name.trim() || pending}>
            <Plus className="size-4 mr-2" />
            {pending ? 'Creating...' : 'Add Command'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string, children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">{label}</h4>
      {children}
    </section>
  )
}
