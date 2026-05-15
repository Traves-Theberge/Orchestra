// apps/desktop/src/features/agents/panels/CodexSkillsPanel.tsx
import { useId, useMemo, useReducer } from 'react'
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

type PanelState = {
  selectedPath: string | null
  drafts: Record<string, string>
  createOpen: boolean
  createName: string
  deleteTarget: string | null
  error: string
}

type PanelAction =
  | { type: 'select', path: string | null }
  | { type: 'set-draft', path: string, value: string }
  | { type: 'reset-draft', path: string, value: string }
  | { type: 'open-create' }
  | { type: 'close-create' }
  | { type: 'set-create-name', value: string }
  | { type: 'set-delete-target', value: string | null }
  | { type: 'set-error', value: string }

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'select':
      return { ...state, selectedPath: action.path }
    case 'set-draft':
      return { ...state, drafts: { ...state.drafts, [action.path]: action.value } }
    case 'reset-draft':
      return { ...state, drafts: { ...state.drafts, [action.path]: action.value } }
    case 'open-create':
      return { ...state, createOpen: true }
    case 'close-create':
      return { ...state, createOpen: false, createName: '' }
    case 'set-create-name':
      return { ...state, createName: action.value }
    case 'set-delete-target':
      return { ...state, deleteTarget: action.value }
    case 'set-error':
      return { ...state, error: action.value }
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
  const [state, dispatch] = useReducer(panelReducer, undefined as never, () => ({
    selectedPath: items[0]?.path ?? null,
    drafts: {},
    createOpen: false,
    createName: '',
    deleteTarget: null,
    error: '',
  }))
  const overrides = useMemo(() => parseSkillOverrides(configContent), [configContent])

  const effectiveSelectedPath = state.selectedPath && items.some(item => item.path === state.selectedPath)
    ? state.selectedPath
    : (items[0]?.path ?? null)
  const selected = items.find(item => item.path === effectiveSelectedPath) ?? null
  const content = selected ? (state.drafts[selected.path] ?? selected.content) : ''
  const isDirty = selected ? content !== selected.content : false
  const skillFolder = selected ? skillFolderPath(selected.path) : ''
  const override = overrides.find(entry => entry.path === skillFolder) ?? null

  const eyebrow = scope === 'GLOBAL' ? 'Global / Skills' : `${projectName ?? 'Project'} / Skills`

  const handleCreate = async () => {
    if (!state.createName.trim()) return
    try { await onCreate(state.createName.trim()) } catch (e) {
      dispatch({ type: 'set-error', value: e instanceof Error ? e.message : 'Failed to create' })
      return
    }
    dispatch({ type: 'close-create' })
  }

  const handleSave = async () => {
    if (!selected) return
    dispatch({ type: 'set-error', value: '' })
    try { await onSave(selected.path, content) } catch (e) {
      dispatch({ type: 'set-error', value: e instanceof Error ? e.message : 'Failed to save' })
    }
  }

  const handleSaveOverride = async (enabled: boolean) => {
    if (!configPath || !skillFolder) return
    dispatch({ type: 'set-error', value: '' })
    try {
      await onSaveConfig(configPath, upsertSkillOverride(configContent, { path: skillFolder, enabled }))
    } catch (e) {
      dispatch({ type: 'set-error', value: e instanceof Error ? e.message : 'Failed to save' })
    }
  }

  const handleRemoveOverride = async () => {
    if (!configPath || !skillFolder) return
    dispatch({ type: 'set-error', value: '' })
    try {
      await onSaveConfig(configPath, removeSkillOverride(configContent, skillFolder))
    } catch (e) {
      dispatch({ type: 'set-error', value: e instanceof Error ? e.message : 'Failed to save' })
    }
  }

  const handleDelete = async () => {
    if (!state.deleteTarget) return
    try { await onDelete(state.deleteTarget) } catch (e) {
      dispatch({ type: 'set-error', value: e instanceof Error ? e.message : 'Failed to delete' })
    }
    dispatch({ type: 'set-delete-target', value: null })
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
          onCreate={() => dispatch({ type: 'open-create' })}
        />
        <CreateDialog
          open={state.createOpen}
          name={state.createName}
          setName={(value) => dispatch({ type: 'set-create-name', value })}
          onCancel={() => dispatch({ type: 'close-create' })}
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
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'open-create' })} className="w-full h-7 text-[10px]">
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
                  onClick={() => dispatch({ type: 'select', path: item.path })}
                  className={`w-full text-left px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 ${
                    item.path === effectiveSelectedPath ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
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
                onChange={(event) => dispatch({ type: 'set-draft', path: selected.path, value: event.target.value })}
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

      <ErrorStrip message={state.error} onDismiss={() => dispatch({ type: 'set-error', value: '' })} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === (selected?.path ?? '')}
        onSave={handleSave}
        onDiscard={() => selected && dispatch({ type: 'reset-draft', path: selected.path, value: selected.content })}
        extraLeft={
          selected ? (
            <button
              type="button"
              onClick={() => dispatch({ type: 'set-delete-target', value: selected.path.split('/').slice(-2)[0] ?? selected.path })}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />

      <CreateDialog
        open={state.createOpen}
        name={state.createName}
        setName={(value) => dispatch({ type: 'set-create-name', value })}
        onCancel={() => dispatch({ type: 'close-create' })}
        onCreate={handleCreate}
      />

      <Dialog open={!!state.deleteTarget} onOpenChange={(o) => !o && dispatch({ type: 'set-delete-target', value: null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete skill</DialogTitle>
            <DialogDescription>This removes the skill directory from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{state.deleteTarget}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => dispatch({ type: 'set-delete-target', value: null })}>Cancel</Button>
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
  const result: SkillOverride[] = []
  for (const block of blocks) {
    const path = readScalar(block, 'path')
    if (!path) continue
    result.push({ path, enabled: readScalar(block, 'enabled').toLowerCase() === 'true' })
  }
  return result
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
