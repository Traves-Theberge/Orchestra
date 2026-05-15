// apps/desktop/src/features/agents/panels/RulesPanel.tsx
import { lazy, Suspense, useReducer, useState, useId } from 'react'

const Editor = lazy(() => import('@monaco-editor/react'))
import { useAppStore } from '@core/store'
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
import type { ClaudeFileEntry } from '@core/api/client'
import type { Scope } from '../types'

const EMPTY_ENTRIES: readonly ClaudeFileEntry[] = Object.freeze([])

const RULE_TEMPLATE = `---
paths:
  - "src/**/*.ts"
---
# {{NAME}}

Describe the rule here.
`

interface RulesPanelProps {
  items: ClaudeFileEntry[]
  globalItems?: ClaudeFileEntry[]
  scope?: Scope
  projectName?: string | null
  saving: string | null
  onSave: (name: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
}

type DisplayItem = ClaudeFileEntry & { isInherited: boolean }

interface DialogState {
  createOpen: boolean
  createName: string
  createPending: boolean
  deleteTarget: string | null
  deletePending: boolean
}

type DialogAction =
  | { type: 'open_create' }
  | { type: 'set_create_name'; name: string }
  | { type: 'close_create' }
  | { type: 'create_start' }
  | { type: 'create_done' }
  | { type: 'open_delete'; name: string }
  | { type: 'close_delete' }
  | { type: 'delete_start' }
  | { type: 'delete_done' }

const initialDialogState: DialogState = {
  createOpen: false,
  createName: '',
  createPending: false,
  deleteTarget: null,
  deletePending: false,
}

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'open_create': return { ...state, createOpen: true }
    case 'set_create_name': return { ...state, createName: action.name }
    case 'close_create': return { ...state, createOpen: false, createName: '' }
    case 'create_start': return { ...state, createPending: true }
    case 'create_done': return { ...state, createPending: false, createOpen: false, createName: '' }
    case 'open_delete': return { ...state, deleteTarget: action.name }
    case 'close_delete': return { ...state, deleteTarget: null }
    case 'delete_start': return { ...state, deletePending: true }
    case 'delete_done': return { ...state, deletePending: false, deleteTarget: null }
    default: return state
  }
}

export function RulesPanel({
  items, globalItems = EMPTY_ENTRIES as ClaudeFileEntry[], scope = 'GLOBAL', projectName = null,
  saving, onSave, onDelete,
}: RulesPanelProps) {
  const inheritedItems: ClaudeFileEntry[] = scope === 'PROJECT'
    ? globalItems.filter(g => !items.some(p => p.name === g.name))
    : []
  const displayItems: DisplayItem[] = [
    ...items.map(i => ({ ...i, isInherited: false as boolean })),
    ...inheritedItems.map(i => ({ ...i, isInherited: true as boolean })),
  ]

  const [dialog, dispatch] = useReducer(dialogReducer, initialDialogState)

  const eyebrow = scope === 'GLOBAL' ? 'Global / Rules' : `${projectName ?? 'Project'} / Rules`

  const handleCreate = async () => {
    const name = dialog.createName.trim()
    if (!name) return
    dispatch({ type: 'create_start' })
    try {
      await onSave(name, RULE_TEMPLATE.replaceAll('{{NAME}}', name))
      dispatch({ type: 'create_done' })
    } catch {
      dispatch({ type: 'create_done' })
    }
  }

  const handleConfirmDelete = async () => {
    if (!dialog.deleteTarget) return
    const target = dialog.deleteTarget
    dispatch({ type: 'delete_start' })
    try {
      await onDelete(target)
    } finally {
      dispatch({ type: 'delete_done' })
    }
  }

  if (displayItems.length === 0 && scope === 'PROJECT' && projectName) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Rules"
          sub="No project rules · inherits 0 from global"
        />
        <EmptyStateCard
          title="No rules at this scope"
          description="Add a rule to apply path-scoped instructions to this project."
          ctaLabel="New rule"
          onCreate={() => dispatch({ type: 'open_create' })}
        />
        <CreateDialog
          open={dialog.createOpen}
          name={dialog.createName}
          setName={(n) => dispatch({ type: 'set_create_name', name: n })}
          pending={dialog.createPending}
          onCancel={() => dispatch({ type: 'close_create' })}
          onCreate={handleCreate}
        />
      </div>
    )
  }

  return (
    <RulesPanelLoaded
      key={`${scope}:${displayItems.map(d => d.name).join('|')}`}
      displayItems={displayItems}
      eyebrow={eyebrow}
      projectCount={items.length}
      inheritedCount={inheritedItems.length}
      saving={saving}
      onSave={onSave}
      dialog={dialog}
      dispatch={dispatch}
      handleCreate={handleCreate}
      handleConfirmDelete={handleConfirmDelete}
    />
  )
}

interface RulesPanelLoadedProps {
  displayItems: DisplayItem[]
  eyebrow: string
  projectCount: number
  inheritedCount: number
  saving: string | null
  onSave: (name: string, content: string) => Promise<void>
  dialog: DialogState
  dispatch: React.Dispatch<DialogAction>
  handleCreate: () => Promise<void>
  handleConfirmDelete: () => Promise<void>
}

function RulesPanelLoaded({
  displayItems, eyebrow, projectCount, inheritedCount,
  saving, onSave, dialog, dispatch, handleCreate, handleConfirmDelete,
}: RulesPanelLoadedProps) {
  const [selectedName, setSelectedName] = useState<string | null>(displayItems[0]?.name ?? null)
  const effectiveSelected = selectedName && displayItems.some(i => i.name === selectedName)
    ? selectedName
    : (displayItems[0]?.name ?? null)
  const selected = displayItems.find(i => i.name === effectiveSelected) ?? null

  return (
    <RulesEditor
      key={selected?.name ?? '__none__'}
      selected={selected}
      displayItems={displayItems}
      selectedName={effectiveSelected}
      setSelectedName={setSelectedName}
      eyebrow={eyebrow}
      projectCount={projectCount}
      inheritedCount={inheritedCount}
      saving={saving}
      onSave={onSave}
      dialog={dialog}
      dispatch={dispatch}
      handleCreate={handleCreate}
      handleConfirmDelete={handleConfirmDelete}
    />
  )
}

interface RulesEditorProps {
  selected: DisplayItem | null
  displayItems: DisplayItem[]
  selectedName: string | null
  setSelectedName: (name: string | null) => void
  eyebrow: string
  projectCount: number
  inheritedCount: number
  saving: string | null
  onSave: (name: string, content: string) => Promise<void>
  dialog: DialogState
  dispatch: React.Dispatch<DialogAction>
  handleCreate: () => Promise<void>
  handleConfirmDelete: () => Promise<void>
}

function RulesEditor({
  selected, displayItems, selectedName, setSelectedName,
  eyebrow, projectCount, inheritedCount,
  saving, onSave, dialog, dispatch, handleCreate, handleConfirmDelete,
}: RulesEditorProps) {
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const [content, setContent] = useState(selected?.content ?? '')
  const [error, setError] = useState('')

  const dirty = selected && !selected.isInherited ? content !== selected.content : false

  const handleSave = async () => {
    if (!selected || selected.isInherited) return
    setError('')
    try { await onSave(selected.name, content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Rules"
        sub={`.claude/rules/ · ${displayItems.length} rule${displayItems.length === 1 ? '' : 's'} · ${projectCount} project, ${inheritedCount} inherited`}
        dirty={!!dirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[200px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'open_create' })} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New rule
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {displayItems.map(item => (
              <button
                key={item.name}
                type="button"
                onClick={() => setSelectedName(item.name)}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 ${
                  item.name === selectedName ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
                }`}
              >
                <span className="truncate flex-1">{item.name}</span>
                {item.isInherited && (
                  <span className="text-[8.5px] font-mono uppercase text-foreground/30">(G)</span>
                )}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {selected ? (
            <>
              <div className="text-[10px] text-foreground/45 font-mono">
                {selected.name}
                {selected.isInherited && ' · inherited from global (read-only at this scope)'}
              </div>
              <div className="flex-1 min-h-0 rounded-md border border-border/30 overflow-hidden">
                <Suspense fallback={null}>
                  <Editor
                    language="markdown"
                    value={content}
                    theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                    onChange={(v) => { if (v !== undefined && !selected.isInherited) setContent(v) }}
                    options={{
                      readOnly: selected.isInherited,
                      minimap: { enabled: false },
                      fontSize: editorSettings.fontSize,
                      fontFamily: editorSettings.fontFamily || undefined,
                      lineNumbers: 'off',
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                      padding: { top: 10, bottom: 10 },
                    }}
                  />
                </Suspense>
              </div>
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
        dirty={!!dirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={() => setContent(selected?.content ?? '')}
        extraLeft={
          selected && !selected.isInherited ? (
            <button
              type="button"
              onClick={() => dispatch({ type: 'open_delete', name: selected.name })}
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
        setName={(n) => dispatch({ type: 'set_create_name', name: n })}
        pending={dialog.createPending}
        onCancel={() => dispatch({ type: 'close_create' })}
        onCreate={handleCreate}
      />

      <Dialog open={!!dialog.deleteTarget} onOpenChange={(o) => !o && dispatch({ type: 'close_delete' })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete rule</DialogTitle>
            <DialogDescription>This removes the file from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{dialog.deleteTarget}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => dispatch({ type: 'close_delete' })} disabled={dialog.deletePending}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={dialog.deletePending}>
              <Trash2 size={14} className="mr-2" /> {dialog.deletePending ? 'Deleting…' : 'Delete'}
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
          <DialogTitle>New rule</DialogTitle>
          <DialogDescription>Creates a markdown file in .claude/rules/ with path-scoping frontmatter.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label htmlFor={nameId} className="text-xs font-semibold text-foreground/60 mb-1.5 block">Rule name</label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate()}
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono"
            placeholder="e.g. no-console-log"
          />
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">Letters, numbers, hyphens, underscores only</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onCreate} disabled={!name.trim() || pending}>
            <Plus size={12} className="mr-2" /> {pending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
