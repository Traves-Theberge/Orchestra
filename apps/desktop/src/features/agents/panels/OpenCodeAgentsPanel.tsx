// apps/desktop/src/features/agents/panels/OpenCodeAgentsPanel.tsx
import { useEffect, useMemo, useState } from 'react'
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

interface OpenCodeAgentsPanelProps {
  items: FileResourceItem[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
  onCreate: (name: string) => Promise<void>
}

export function OpenCodeAgentsPanel({ items, scope, projectName, saving, onSave, onDelete, onCreate }: OpenCodeAgentsPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createPending, setCreatePending] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FileResourceItem | null>(null)
  const [error, setError] = useState('')

  const effectiveSelectedKey = selectedKey && items.some(item => item.key === selectedKey)
    ? selectedKey
    : (items[0]?.key ?? null)
  const selected = items.find(item => item.key === effectiveSelectedKey) ?? null

  const parsed = useMemo(() => parseOpenCodeMarkdown(selected?.content ?? ''), [selected?.content])
  const [description, setDescription] = useState(parsed.frontmatter.description ?? '')
  const [mode, setMode] = useState(parsed.frontmatter.mode ?? '')
  const [model, setModel] = useState(parsed.frontmatter.model ?? '')
  const [body, setBody] = useState(parsed.body)

  useEffect(() => {
    setDescription(parsed.frontmatter.description ?? '')
    setMode(parsed.frontmatter.mode ?? '')
    setModel(parsed.frontmatter.model ?? '')
    setBody(parsed.body)
    setError('')
  }, [parsed.body, parsed.frontmatter.description, parsed.frontmatter.mode, parsed.frontmatter.model])

  const isDirty = selected
    ? buildOpenCodeMarkdown({ description, mode, model }, body) !== selected.content
    : false

  const eyebrow = scope === 'GLOBAL' ? 'Global / Agents' : `${projectName ?? 'Project'} / Agents`

  const handleCreate = async () => {
    const next = createName.trim()
    if (!next) return
    setCreatePending(true)
    try {
      await onCreate(next)
      setCreateOpen(false)
      setCreateName('')
    } finally {
      setCreatePending(false)
    }
  }

  const handleSave = async () => {
    if (!selected) return
    setError('')
    try {
      await onSave(selected.path, buildOpenCodeMarkdown({ description, mode, model }, body))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleDiscard = () => {
    setDescription(parsed.frontmatter.description ?? '')
    setMode(parsed.frontmatter.mode ?? '')
    setModel(parsed.frontmatter.model ?? '')
    setBody(parsed.body)
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Agents"
          sub="OpenCode agent definitions"
        />
        <EmptyStateCard
          title="No agents at this scope"
          description="OpenCode agents are Markdown files with frontmatter. Use description, mode, and optional model to define routing and behavior."
          ctaLabel="New agent"
          onCreate={() => setCreateOpen(true)}
        />
        <CreateDialog
          open={createOpen}
          name={createName}
          setName={setCreateName}
          pending={createPending}
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
        title="Agents"
        sub={`${items.length} agent${items.length === 1 ? '' : 's'}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New agent
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
                  <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Planner agent for repo-wide work" className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>

                <Field label="Mode">
                  <select value={mode} onChange={(event) => setMode(event.target.value)} className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">Default</option>
                    <option value="subagent">subagent</option>
                    <option value="agent">agent</option>
                  </select>
                </Field>

                <Field label="Model">
                  <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="anthropic/claude-sonnet-4-5" className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>

                <Field label="Instructions">
                  <textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-[260px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" spellCheck={false} />
                </Field>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-foreground/30">
              Select an agent or create one
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
        open={createOpen}
        name={createName}
        setName={setCreateName}
        pending={createPending}
        onCancel={() => { setCreateOpen(false); setCreateName('') }}
        onCreate={handleCreate}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete agent</DialogTitle>
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
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Agent</DialogTitle>
          <DialogDescription>Create a new OpenCode agent Markdown file with frontmatter.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9._/-]/g, '-'))}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate()}
            placeholder="e.g. planner"
            className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onCreate} disabled={!name.trim() || pending}>
            <Plus className="h-4 w-4 mr-2" />
            {pending ? 'Creating...' : 'Add Agent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string, children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">{label}</h4>
      {children}
    </section>
  )
}
