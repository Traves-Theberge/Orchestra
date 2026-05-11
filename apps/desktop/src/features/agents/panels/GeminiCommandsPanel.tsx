// apps/desktop/src/features/agents/panels/GeminiCommandsPanel.tsx
import { useEffect, useMemo, useState } from 'react'
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

interface GeminiCommandsPanelProps {
  items: FileResourceItem[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
  onCreate: (name: string) => Promise<void>
}

export function GeminiCommandsPanel({ items, scope, projectName, saving, onSave, onDelete, onCreate }: GeminiCommandsPanelProps) {
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

  const parsed = useMemo(() => parseGeminiCommand(selected?.content ?? ''), [selected?.content])
  const [description, setDescription] = useState(parsed.description)
  const [prompt, setPrompt] = useState(parsed.prompt)
  const [raw, setRaw] = useState(selected?.content ?? '')

  useEffect(() => {
    setDescription(parsed.description)
    setPrompt(parsed.prompt)
    setRaw(selected?.content ?? '')
    setError('')
  }, [parsed.description, parsed.prompt, selected?.content])

  const isToml = selected ? isTomlGeminiCommand(selected.path) : false
  const isDirty = selected ? (
    isToml
      ? buildTomlCommand(description, prompt) !== selected.content
      : raw !== selected.content
  ) : false

  const eyebrow = scope === 'GLOBAL' ? 'Global / Commands' : `${projectName ?? 'Project'} / Commands`

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
      await onSave(selected.path, isToml ? buildTomlCommand(description, prompt) : raw)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleDiscard = () => {
    setDescription(parsed.description)
    setPrompt(parsed.prompt)
    setRaw(selected?.content ?? '')
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Commands"
          sub="Custom slash commands · 0"
        />
        <EmptyStateCard
          title="No commands found"
          description="Create a Gemini command for the selected scope. New commands are TOML files with description and prompt fields."
          ctaLabel="Add Command"
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
        title="Commands"
        sub={`Custom slash commands · ${items.length}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> Add Command
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
                <span className="text-[8.5px] font-mono uppercase text-foreground/30">
                  {item.path.toLowerCase().endsWith('.toml') ? 'TOML' : 'MD'}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {selected ? (
            <>
              <div className="text-[10px] text-foreground/45 font-mono truncate">{selected.path}</div>
              {isToml ? (
                <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
                  <section className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Description</h4>
                    <input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Summarize the current branch"
                      className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </section>

                  <section className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Prompt</h4>
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      className="min-h-[260px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                      spellCheck={false}
                    />
                  </section>
                </div>
              ) : (
                <textarea
                  value={raw}
                  onChange={(event) => setRaw(event.target.value)}
                  className="flex-1 min-h-0 bg-muted/10 rounded-lg border border-border/30 px-4 py-3 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:border-primary/30 resize-none transition-colors"
                  spellCheck={false}
                />
              )}
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
        saving={saving === (selected?.path ?? '')}
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
            <DialogTitle className="text-red-400">Delete command</DialogTitle>
            <DialogDescription>This removes the file from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{deleteTarget?.path}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              if (!deleteTarget) return
              await onDelete(deleteTarget.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? deleteTarget.path)
              setDeleteTarget(null)
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
          <DialogTitle>Add Command</DialogTitle>
          <DialogDescription>Create a new Gemini command TOML file in the selected scope.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label className="text-xs font-semibold text-foreground/60 mb-1.5 block">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value.replace(/[^a-zA-Z0-9._/-]/g, '-'))}
            onKeyDown={(event) => event.key === 'Enter' && name.trim() && onCreate()}
            placeholder="e.g. daily-summary"
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onCreate} disabled={!name.trim() || pending}>
            <Plus className="h-4 w-4 mr-2" />
            {pending ? 'Creating...' : 'Add Command'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function isTomlGeminiCommand(path: string): boolean {
  return path.toLowerCase().endsWith('.toml')
}

function parseGeminiCommand(content: string): { description: string, prompt: string } {
  return {
    description: readTomlScalar(content, 'description'),
    prompt: readTomlPrompt(content),
  }
}

function readTomlScalar(content: string, field: string): string {
  const pattern = new RegExp(`^${escapeRegExp(field)}\\s*=\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm')
  return content.match(pattern)?.[1]?.trim() ?? ''
}

function readTomlPrompt(content: string): string {
  const triple = content.match(/^prompt\s*=\s*"""\n([\s\S]*?)\n"""\s*$/m)
  if (triple) return triple[1]
  const single = content.match(/^prompt\s*=\s*["']([^"']*)["']\s*$/m)
  return single?.[1] ?? ''
}

function buildTomlCommand(description: string, prompt: string): string {
  const lines = []
  if (description.trim()) lines.push(`description = ${JSON.stringify(description.trim())}`)
  lines.push('prompt = """')
  lines.push(prompt.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
  lines.push('"""')
  return `${lines.join('\n')}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
