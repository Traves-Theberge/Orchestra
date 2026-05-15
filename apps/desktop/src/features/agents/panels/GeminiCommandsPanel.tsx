// apps/desktop/src/features/agents/panels/GeminiCommandsPanel.tsx
import { useId, useMemo, useReducer, useState } from 'react'
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

type DialogState = {
  selectedKey: string | null
  createOpen: boolean
  createName: string
  createPending: boolean
  deleteTarget: FileResourceItem | null
  error: string
}

type DialogAction =
  | { type: 'select'; key: string | null }
  | { type: 'openCreate' }
  | { type: 'setCreateName'; value: string }
  | { type: 'setCreatePending'; value: boolean }
  | { type: 'cancelCreate' }
  | { type: 'setDeleteTarget'; value: FileResourceItem | null }
  | { type: 'setError'; value: string }

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'select': return { ...state, selectedKey: action.key }
    case 'openCreate': return { ...state, createOpen: true }
    case 'setCreateName': return { ...state, createName: action.value }
    case 'setCreatePending': return { ...state, createPending: action.value }
    case 'cancelCreate': return { ...state, createOpen: false, createName: '' }
    case 'setDeleteTarget': return { ...state, deleteTarget: action.value }
    case 'setError': return { ...state, error: action.value }
  }
}

const INITIAL_DIALOG: DialogState = {
  selectedKey: null,
  createOpen: false,
  createName: '',
  createPending: false,
  deleteTarget: null,
  error: '',
}

export function GeminiCommandsPanel({ items, scope, projectName, saving, onSave, onDelete, onCreate }: GeminiCommandsPanelProps) {
  const [state, dispatch] = useReducer(dialogReducer, INITIAL_DIALOG)

  const effectiveSelectedKey = state.selectedKey && items.some(item => item.key === state.selectedKey)
    ? state.selectedKey
    : (items[0]?.key ?? null)
  const selected = items.find(item => item.key === effectiveSelectedKey) ?? null

  const eyebrow = scope === 'GLOBAL' ? 'Global / Commands' : `${projectName ?? 'Project'} / Commands`

  const handleCreate = async () => {
    const next = state.createName.trim()
    if (!next) return
    dispatch({ type: 'setCreatePending', value: true })
    try {
      await onCreate(next)
      dispatch({ type: 'cancelCreate' })
    } finally {
      dispatch({ type: 'setCreatePending', value: false })
    }
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
          onCreate={() => dispatch({ type: 'openCreate' })}
        />
        <CreateDialog
          open={state.createOpen}
          name={state.createName}
          setName={(v) => dispatch({ type: 'setCreateName', value: v })}
          pending={state.createPending}
          onCancel={() => dispatch({ type: 'cancelCreate' })}
          onCreate={handleCreate}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-[14px]">
      <CommandEditor
        key={selected?.path ?? '__none__'}
        items={items}
        selected={selected}
        effectiveSelectedKey={effectiveSelectedKey}
        eyebrow={eyebrow}
        saving={saving}
        error={state.error}
        onSelect={(key) => dispatch({ type: 'select', key })}
        onOpenCreate={() => dispatch({ type: 'openCreate' })}
        onOpenDelete={(item) => dispatch({ type: 'setDeleteTarget', value: item })}
        onSave={onSave}
        onError={(msg) => dispatch({ type: 'setError', value: msg })}
      />

      <CreateDialog
        open={state.createOpen}
        name={state.createName}
        setName={(v) => dispatch({ type: 'setCreateName', value: v })}
        pending={state.createPending}
        onCancel={() => dispatch({ type: 'cancelCreate' })}
        onCreate={handleCreate}
      />

      <Dialog open={!!state.deleteTarget} onOpenChange={(o) => !o && dispatch({ type: 'setDeleteTarget', value: null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete command</DialogTitle>
            <DialogDescription>This removes the file from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{state.deleteTarget?.path}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => dispatch({ type: 'setDeleteTarget', value: null })}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              const target = state.deleteTarget
              if (!target) return
              await onDelete(target.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? target.path)
              dispatch({ type: 'setDeleteTarget', value: null })
            }}>
              <Trash2 size={14} className="mr-2" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface CommandEditorProps {
  items: FileResourceItem[]
  selected: FileResourceItem | null
  effectiveSelectedKey: string | null
  eyebrow: string
  saving: string | null
  error: string
  onSelect: (key: string) => void
  onOpenCreate: () => void
  onOpenDelete: (item: FileResourceItem) => void
  onSave: (path: string, content: string) => Promise<void>
  onError: (message: string) => void
}

function CommandEditor({
  items, selected, effectiveSelectedKey, eyebrow, saving, error,
  onSelect, onOpenCreate, onOpenDelete, onSave, onError,
}: CommandEditorProps) {
  const parsed = useMemo(() => parseGeminiCommand(selected?.content ?? ''), [selected?.content])
  const [description, setDescription] = useState(parsed.description)
  const [prompt, setPrompt] = useState(parsed.prompt)
  const [raw, setRaw] = useState(selected?.content ?? '')

  const isToml = selected ? isTomlGeminiCommand(selected.path) : false
  const isDirty = selected ? (
    isToml
      ? buildTomlCommand(description, prompt) !== selected.content
      : raw !== selected.content
  ) : false

  const handleSave = async () => {
    if (!selected) return
    onError('')
    try {
      await onSave(selected.path, isToml ? buildTomlCommand(description, prompt) : raw)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleDiscard = () => {
    setDescription(parsed.description)
    setPrompt(parsed.prompt)
    setRaw(selected?.content ?? '')
  }

  return (
    <>
      <PanelHeader
        eyebrow={eyebrow}
        title="Commands"
        sub={`Custom slash commands · ${items.length}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={onOpenCreate} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> Add Command
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {items.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
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
                <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-5">
                  <section className="flex flex-col gap-2">
                    <h4 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">Description</h4>
                    <input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Summarize the current branch"
                      className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </section>

                  <section className="flex flex-col gap-2">
                    <h4 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">Prompt</h4>
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

      <ErrorStrip message={error} onDismiss={() => onError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === (selected?.path ?? '')}
        onSave={handleSave}
        onDiscard={handleDiscard}
        extraLeft={
          selected ? (
            <button
              type="button"
              onClick={() => onOpenDelete(selected)}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />
    </>
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
          <DialogDescription>Create a new Gemini command TOML file in the selected scope.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label htmlFor={nameId} className="text-xs font-semibold text-foreground/60 mb-1.5 block">Name</label>
          <input
            id={nameId}
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
            <Plus className="size-4 mr-2" />
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
