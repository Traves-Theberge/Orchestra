// apps/desktop/src/features/agents/panels/CodexSkillsPanel.tsx
import { useEffect, useId, useMemo, useReducer, useState } from 'react'
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

interface CodexSkillsPanelProps {
  items: ProviderFileEntry[]
  configContent: string
  configPath: string
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
  onCreate: (name: string) => Promise<void>
  onSaveConfig: (path: string, content: string) => Promise<void>
}

type SkillOverride = {
  path: string
  enabled: boolean
}

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

export function CodexSkillsPanel({
  items,
  configContent,
  configPath,
  scope,
  projectName,
  saving,
  onSave,
  onDelete,
  onCreate,
  onSaveConfig,
}: CodexSkillsPanelProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(items[0]?.path ?? null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [dialog, dispatchDialog] = useReducer(dialogReducer, initialDialogState)
  const [error, setError] = useState('')
  const overrides = useMemo(() => parseSkillOverrides(configContent), [configContent])

  useEffect(() => {
    if (selectedPath && items.some(item => item.path === selectedPath)) return
    setSelectedPath(items[0]?.path ?? null)
  }, [items, selectedPath])

  const selected = items.find(item => item.path === selectedPath) ?? null
  const content = selected ? (drafts[selected.path] ?? selected.content) : ''
  const isDirty = selected ? content !== selected.content : false
  const skillFolder = selected ? skillFolderPath(selected.path) : ''
  const override = overrides.find(entry => entry.path === skillFolder) ?? null

  const eyebrow = scope === 'GLOBAL' ? 'Global / Skills' : `${projectName ?? 'Project'} / Skills`

  const handleCreate = async () => {
    if (!dialog.createName.trim()) return
    try { await onCreate(dialog.createName.trim()) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
      return
    }
    dispatchDialog({ type: 'closeCreate' })
  }

  const handleSave = async () => {
    if (!selected) return
    setError('')
    try { await onSave(selected.path, content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleSaveOverride = async (enabled: boolean) => {
    if (!configPath || !skillFolder) return
    setError('')
    try {
      await onSaveConfig(configPath, upsertSkillOverride(configContent, { path: skillFolder, enabled }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleRemoveOverride = async () => {
    if (!configPath || !skillFolder) return
    setError('')
    try {
      await onSaveConfig(configPath, removeSkillOverride(configContent, skillFolder))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
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
          title="Skills"
          sub=".codex/skills/ · 0 skills"
        />
        <EmptyStateCard
          title="No skills at this scope"
          description="Create a Codex skill to manage its SKILL.md and override state."
          ctaLabel="New skill"
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
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Skills"
        sub={`.codex/skills/ · ${items.length} skill${items.length === 1 ? '' : 's'}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => dispatchDialog({ type: 'openCreate' })} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New skill
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {items.map(item => {
              const folder = skillFolderPath(item.path)
              const itemOverride = overrides.find(entry => entry.path === folder) ?? null
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => setSelectedPath(item.path)}
                  className={`w-full text-left px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 ${
                    item.path === selectedPath ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
                  }`}
                >
                  <span className="truncate flex-1">{item.name}</span>
                  {itemOverride ? (
                    <span className={`text-[8.5px] font-mono uppercase ${itemOverride.enabled ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {itemOverride.enabled ? 'on' : 'off'}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-2 overflow-y-auto pr-1">
          {selected ? (
            <>
              <div className="text-[10px] text-foreground/45 font-mono">
                {selected.path}
              </div>

              <div className="rounded-lg border border-border/30 bg-background p-3 shrink-0 space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Enablement Override</p>
                  <p className="text-[10px] text-foreground/50 mt-1 font-mono break-all">{skillFolder}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant={override?.enabled === true ? 'default' : 'outline'} className="h-7 text-[10px]" onClick={() => handleSaveOverride(true)} disabled={!configPath}>
                    Enable
                  </Button>
                  <Button size="sm" variant={override?.enabled === false ? 'default' : 'outline'} className="h-7 text-[10px]" onClick={() => handleSaveOverride(false)} disabled={!configPath}>
                    Disable
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={handleRemoveOverride} disabled={!override || !configPath}>
                    Clear override
                  </Button>
                  {override ? (
                    <span className={`text-[10px] font-semibold ${override.enabled ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {override.enabled ? 'Explicitly enabled' : 'Explicitly disabled'}
                    </span>
                  ) : (
                    <span className="text-[10px] text-foreground/50">Using Codex default behavior</span>
                  )}
                </div>
              </div>

              <textarea
                value={content}
                onChange={(event) => setDrafts(prev => ({ ...prev, [selected.path]: event.target.value }))}
                className="flex-1 min-h-[200px] bg-muted/10 rounded-lg border border-border/30 px-4 py-3 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:border-primary/30 resize-none transition-colors"
                spellCheck={false}
              />
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
        saving={saving === (selected?.path ?? '')}
        onSave={handleSave}
        onDiscard={() => selected && setDrafts(prev => ({ ...prev, [selected.path]: selected.content }))}
        extraLeft={
          selected ? (
            <button
              type="button"
              onClick={() => dispatchDialog({ type: 'openDelete', name: selected.path.split('/').slice(-2)[0] ?? selected.path })}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />

      <CreateDialog
        open={dialog.createOpen}
        name={dialog.createName}
        setName={(value) => dispatchDialog({ type: 'setCreateName', value })}
        onCancel={() => dispatchDialog({ type: 'closeCreate' })}
        onCreate={handleCreate}
      />

      <Dialog open={!!dialog.deleteTarget} onOpenChange={(o) => !o && dispatchDialog({ type: 'closeDelete' })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete skill</DialogTitle>
            <DialogDescription>This removes the skill directory from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{dialog.deleteTarget}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => dispatchDialog({ type: 'closeDelete' })}>Cancel</Button>
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
  const nameId = useId()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>Creates a Codex skill directory with a SKILL.md file.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label htmlFor={nameId} className="text-xs font-semibold text-foreground/60 mb-1.5 block">Skill name</label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9._/-]/g, '-'))}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate()}
            placeholder="e.g. triage"
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

function skillFolderPath(skillMarkdownPath: string): string {
  return skillMarkdownPath.replace(/\/SKILL\.md$/i, '')
}

function parseSkillOverrides(content: string): SkillOverride[] {
  const blocks = content.match(/\[\[skills\.config\]\][\s\S]*?(?=\n\[\[skills\.config\]\]|\n\[[^\n]+\]|$)/g) ?? []
  return blocks.flatMap(block => {
    const path = readScalar(block, 'path')
    if (!path) return []
    return [{ path, enabled: readScalar(block, 'enabled').toLowerCase() === 'true' }]
  })
}

function upsertSkillOverride(content: string, override: SkillOverride): string {
  const section = buildOverrideSection(override)
  const blocks = content.match(/\[\[skills\.config\]\][\s\S]*?(?=\n\[\[skills\.config\]\]|\n\[[^\n]+\]|$)/g) ?? []
  for (const block of blocks) {
    if (readScalar(block, 'path') === override.path) {
      return content.replace(block, section).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
    }
  }
  return `${content.trimEnd()}\n\n${section}\n`
}

function removeSkillOverride(content: string, skillPath: string): string {
  const blocks = content.match(/\[\[skills\.config\]\][\s\S]*?(?=\n\[\[skills\.config\]\]|\n\[[^\n]+\]|$)/g) ?? []
  let next = content
  for (const block of blocks) {
    if (readScalar(block, 'path') === skillPath) {
      next = next.replace(block, '')
    }
  }
  return next.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

function buildOverrideSection(override: SkillOverride): string {
  return `[[skills.config]]
path = "${override.path}"
enabled = ${override.enabled ? 'true' : 'false'}`
}

function readScalar(content: string, field: string): string {
  const pattern = new RegExp(`^${escapeRegExp(field)}\\s*=\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm')
  return content.match(pattern)?.[1]?.trim() ?? ''
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
