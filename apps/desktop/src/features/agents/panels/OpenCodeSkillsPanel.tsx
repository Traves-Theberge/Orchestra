// apps/desktop/src/features/agents/panels/OpenCodeSkillsPanel.tsx
import { useId, useMemo, useReducer, useState } from 'react'
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
import { buildOpenCodeSkill, parseOpenCodeSkill } from './open-code-skill-frontmatter'

interface OpenCodeSkillsPanelProps {
  items: FileResourceItem[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
  onCreate: (name: string) => Promise<void>
}

interface CreateState {
  open: boolean
  name: string
  pending: boolean
}

type CreateAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'setName', value: string }
  | { type: 'setPending', value: boolean }

function createReducer(state: CreateState, action: CreateAction): CreateState {
  switch (action.type) {
    case 'open':
      return { ...state, open: true }
    case 'close':
      return { open: false, name: '', pending: false }
    case 'setName':
      return { ...state, name: action.value }
    case 'setPending':
      return { ...state, pending: action.value }
    default:
      return state
  }
}

export function OpenCodeSkillsPanel({ items, scope, projectName, saving, onSave, onDelete, onCreate }: OpenCodeSkillsPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [create, dispatchCreate] = useReducer(createReducer, { open: false, name: '', pending: false })
  const [deleteTarget, setDeleteTarget] = useState<FileResourceItem | null>(null)

  const effectiveSelectedKey = selectedKey && items.some(item => item.key === selectedKey)
    ? selectedKey
    : (items[0]?.key ?? null)
  const selected = items.find(item => item.key === effectiveSelectedKey) ?? null

  const eyebrow = scope === 'GLOBAL' ? 'Global / Skills' : `${projectName ?? 'Project'} / Skills`

  const handleCreate = async () => {
    const next = create.name.trim()
    if (!next) return
    dispatchCreate({ type: 'setPending', value: true })
    try {
      await onCreate(next)
      dispatchCreate({ type: 'close' })
    } finally {
      dispatchCreate({ type: 'setPending', value: false })
    }
  }

  const createDialog = (
    <CreateDialog
      open={create.open}
      name={create.name}
      setName={(value) => dispatchCreate({ type: 'setName', value })}
      pending={create.pending}
      onCancel={() => dispatchCreate({ type: 'close' })}
      onCreate={handleCreate}
    />
  )

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Skills"
          sub="OpenCode skill definitions"
        />
        <EmptyStateCard
          title="No skills at this scope"
          description="OpenCode skills use YAML frontmatter in SKILL.md. The recognized fields are name, description, license, and compatibility."
          ctaLabel="New skill"
          onCreate={() => dispatchCreate({ type: 'open' })}
        />
        {createDialog}
      </div>
    )
  }

  return (
    <SkillsShell
      key={selected ? `${selected.key}::${selected.content}` : 'none'}
      items={items}
      selected={selected}
      effectiveSelectedKey={effectiveSelectedKey}
      eyebrow={eyebrow}
      saving={saving}
      onSelect={setSelectedKey}
      onOpenCreate={() => dispatchCreate({ type: 'open' })}
      onRequestDelete={setDeleteTarget}
      onSave={onSave}
    >
      {createDialog}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete skill</DialogTitle>
            <DialogDescription>This removes the skill directory from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{deleteTarget?.name}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              if (!deleteTarget) return
              const skillName = deleteTarget.path.split('/').slice(-2)[0] ?? deleteTarget.path
              await onDelete(skillName)
              setDeleteTarget(null)
              setSelectedKey(null)
            }}>
              <Trash2 size={14} className="mr-2" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SkillsShell>
  )
}

interface SkillsShellProps {
  items: FileResourceItem[]
  selected: FileResourceItem | null
  effectiveSelectedKey: string | null
  eyebrow: string
  saving: string | null
  onSelect: (key: string) => void
  onOpenCreate: () => void
  onRequestDelete: (item: FileResourceItem) => void
  onSave: (path: string, content: string) => Promise<void>
  children?: ReactNode
}

function SkillsShell({ items, selected, effectiveSelectedKey, eyebrow, saving, onSelect, onOpenCreate, onRequestDelete, onSave, children }: SkillsShellProps) {
  const parsed = useMemo(() => parseOpenCodeSkill(selected?.content ?? ''), [selected?.content])
  const [name, setName] = useState(parsed.frontmatter.name)
  const [description, setDescription] = useState(parsed.frontmatter.description)
  const [license, setLicense] = useState(parsed.frontmatter.license ?? '')
  const [compatibility, setCompatibility] = useState(parsed.frontmatter.compatibility ?? '')
  const [body, setBody] = useState(parsed.body)
  const [error, setError] = useState('')

  const isDirty = selected
    ? buildOpenCodeSkill({ name, description, license, compatibility }, body) !== selected.content
    : false

  const handleSave = async () => {
    if (!selected) return
    setError('')
    try {
      await onSave(selected.path, buildOpenCodeSkill({ name, description, license, compatibility }, body))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleDiscard = () => {
    setName(parsed.frontmatter.name)
    setDescription(parsed.frontmatter.description)
    setLicense(parsed.frontmatter.license ?? '')
    setCompatibility(parsed.frontmatter.compatibility ?? '')
    setBody(parsed.body)
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Skills"
        sub={`${items.length} skill${items.length === 1 ? '' : 's'}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={onOpenCreate} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New skill
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
              </button>
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {selected ? (
            <>
              <div className="text-[10px] text-foreground/45 font-mono truncate">{selected.path}</div>
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
                <Field label="Name">
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="git-release" className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>

                <Field label="Description">
                  <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Create consistent releases and changelogs" className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>

                <Field label="License">
                  <input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="MIT" className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>

                <Field label="Compatibility">
                  <input value={compatibility} onChange={(event) => setCompatibility(event.target.value)} placeholder="opencode" className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>

                <Field label="Body">
                  <textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-[260px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" spellCheck={false} />
                </Field>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-foreground/30">
              Select a skill or create one
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
              onClick={() => onRequestDelete(selected)}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />

      {children}
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
          <DialogTitle>Add Skill</DialogTitle>
          <DialogDescription>Create a new OpenCode skill directory with SKILL.md.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label htmlFor={nameId} className="text-xs font-semibold text-muted-foreground mb-1.5 block">Name</label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-z0-9-]/g, '-'))}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate()}
            placeholder="e.g. git-release"
            className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onCreate} disabled={!name.trim() || pending}>
            <Plus className="size-4 mr-2" />
            {pending ? 'Creating…' : 'Add Skill'}
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
