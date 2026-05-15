// apps/desktop/src/features/agents/panels/RulesPanel.tsx
import { lazy, Suspense, useId, useMemo, useReducer, useRef, useState } from 'react'
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

const Editor = lazy(() => import('@monaco-editor/react'))

const RULE_TEMPLATE = `---
paths:
  - "src/**/*.ts"
---
# {{NAME}}

Describe the rule here.
`

const EMPTY_ITEMS: ClaudeFileEntry[] = []

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

type DialogState = {
  deleteTarget: string | null
  deletePending: boolean
  createOpen: boolean
  createName: string
  createPending: boolean
}

type DialogAction =
  | { type: 'openDelete'; name: string }
  | { type: 'closeDelete' }
  | { type: 'setDeletePending'; value: boolean }
  | { type: 'openCreate' }
  | { type: 'closeCreate' }
  | { type: 'setCreateName'; value: string }
  | { type: 'setCreatePending'; value: boolean }

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'openDelete': return { ...state, deleteTarget: action.name }
    case 'closeDelete': return { ...state, deleteTarget: null, deletePending: false }
    case 'setDeletePending': return { ...state, deletePending: action.value }
    case 'openCreate': return { ...state, createOpen: true }
    case 'closeCreate': return { ...state, createOpen: false, createName: '', createPending: false }
    case 'setCreateName': return { ...state, createName: action.value }
    case 'setCreatePending': return { ...state, createPending: action.value }
    default: return state
  }
}

export function RulesPanel({
  items, globalItems = EMPTY_ITEMS, scope = 'GLOBAL', projectName = null,
  saving, onSave, onDelete,
}: RulesPanelProps) {
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const contentKeyRef = useRef<string | null>(null)
  const [error, setError] = useState('')
  const [dialogs, dispatchDialog] = useReducer(dialogReducer, {
    deleteTarget: null,
    deletePending: false,
    createOpen: false,
    createName: '',
    createPending: false,
  })

  const inheritedItems: ClaudeFileEntry[] = useMemo(() =>
    scope === 'PROJECT'
      ? globalItems.filter(g => !items.some(p => p.name === g.name))
      : [],
    [scope, globalItems, items],
  )
  const displayItems: DisplayItem[] = useMemo(() => [
    ...items.map(i => ({ ...i, isInherited: false as boolean })),
    ...inheritedItems.map(i => ({ ...i, isInherited: true as boolean })),
  ], [items, inheritedItems])

  const effectiveSelectedName = (() => {
    if (selectedName && displayItems.find(i => i.name === selectedName)) return selectedName
    return displayItems.length > 0 ? displayItems[0].name : null
  })()

  const selected = displayItems.find(i => i.name === effectiveSelectedName) ?? null

  const selectedContentKey = selected ? `${selected.name}::${selected.content}` : null
  if (selectedContentKey !== contentKeyRef.current) {
    contentKeyRef.current = selectedContentKey
    setContent(selected?.content ?? '')
    setError('')
  }

  const dirty = selected && !selected.isInherited ? content !== selected.content : false
  const projectCount = items.length
  const inheritedCount = inheritedItems.length

  const handleCreate = async () => {
    const name = dialogs.createName.trim()
    if (!name) return
    dispatchDialog({ type: 'setCreatePending', value: true })
    try {
      await onSave(name, RULE_TEMPLATE.replaceAll('{{NAME}}', name))
      setSelectedName(name)
      dispatchDialog({ type: 'closeCreate' })
    } finally {
      dispatchDialog({ type: 'setCreatePending', value: false })
    }
  }

  const handleConfirmDelete = async () => {
    if (!dialogs.deleteTarget) return
    dispatchDialog({ type: 'setDeletePending', value: true })
    try {
      await onDelete(dialogs.deleteTarget)
      dispatchDialog({ type: 'closeDelete' })
    } finally {
      dispatchDialog({ type: 'setDeletePending', value: false })
    }
  }

  const eyebrow = scope === 'GLOBAL' ? 'Global / Rules' : `${projectName ?? 'Project'} / Rules`

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
          onCreate={() => dispatchDialog({ type: 'openCreate' })}
        />
        <CreateDialog
          open={dialogs.createOpen}
          name={dialogs.createName}
          setName={(v) => dispatchDialog({ type: 'setCreateName', value: v })}
          pending={dialogs.createPending}
          onCancel={() => dispatchDialog({ type: 'closeCreate' })}
          onCreate={handleCreate}
        />
      </div>
    )
  }

  const handleSave = async () => {
    if (!selected || selected.isInherited) return
    setError('')
    try { await onSave(selected.name, content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Rules"
        sub={`.claude/rules/ · ${displayItems.length} rule${displayItems.length === 1 ? '' : 's'} · ${projectCount} project, ${inheritedCount} inherited`}
        dirty={!!dirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[200px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => dispatchDialog({ type: 'openCreate' })} className="w-full h-7 text-[10px]">
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
                  item.name === effectiveSelectedName ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
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
              onClick={() => dispatchDialog({ type: 'openDelete', name: selected.name })}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />

      <CreateDialog
        open={dialogs.createOpen}
        name={dialogs.createName}
        setName={(v) => dispatchDialog({ type: 'setCreateName', value: v })}
        pending={dialogs.createPending}
        onCancel={() => dispatchDialog({ type: 'closeCreate' })}
        onCreate={handleCreate}
      />

      <Dialog open={!!dialogs.deleteTarget} onOpenChange={(o) => !o && dispatchDialog({ type: 'closeDelete' })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete rule</DialogTitle>
            <DialogDescription>This removes the file from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{dialogs.deleteTarget}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => dispatchDialog({ type: 'closeDelete' })} disabled={dialogs.deletePending}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={dialogs.deletePending}>
              <Trash2 size={14} className="mr-2" /> {dialogs.deletePending ? 'Deleting…' : 'Delete'}
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
