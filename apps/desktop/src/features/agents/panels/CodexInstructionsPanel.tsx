// apps/desktop/src/features/agents/panels/CodexInstructionsPanel.tsx
import { lazy, Suspense, useReducer, useState } from 'react'

const Editor = lazy(() => import('@monaco-editor/react'))
import { useAppStore } from '@core/store'
import { Plus } from 'lucide-react'
import { Button } from '@ui/button'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import { TOKENS } from '../tokens'
import type { Scope } from '../types'
import type { FileResourceItem } from './FileResourcePanel'

interface CodexInstructionsPanelProps {
  items: FileResourceItem[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onCreate: () => Promise<void>
}

export function CodexInstructionsPanel({ items, scope, projectName, saving, onSave, onCreate }: CodexInstructionsPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const effectiveSelectedKey = selectedKey && items.some(i => i.key === selectedKey)
    ? selectedKey
    : (items[0]?.key ?? null)
  const selected = items.find(i => i.key === effectiveSelectedKey) ?? null

  const eyebrow = scope === 'GLOBAL' ? 'Global / Instructions' : `${projectName ?? 'Project'} / Instructions`

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="AGENTS.md"
          sub="No instruction files at this scope"
        />
        <EmptyStateCard
          title="No AGENTS.md at this scope"
          description="Codex instructions are discovered from AGENTS.md files. Project instructions append to global."
          ctaLabel="Create AGENTS.md"
          onCreate={() => { void onCreate() }}
          pending={!!saving}
        />
      </div>
    )
  }

  const editorKey = `${selected?.key ?? ''}::${selected?.content ?? ''}`

  return (
    <InstructionsEditor
      key={editorKey}
      items={items}
      selected={selected}
      effectiveSelectedKey={effectiveSelectedKey}
      eyebrow={eyebrow}
      saving={saving}
      onSelect={setSelectedKey}
      onSave={onSave}
      onCreate={onCreate}
    />
  )
}

interface InstructionsEditorProps {
  items: FileResourceItem[]
  selected: FileResourceItem | null
  effectiveSelectedKey: string | null
  eyebrow: string
  saving: string | null
  onSelect: (key: string) => void
  onSave: (path: string, content: string) => Promise<void>
  onCreate: () => Promise<void>
}

type EditorState = {
  content: string
  error: string
}

type EditorAction =
  | { type: 'set-content', value: string }
  | { type: 'set-error', value: string }
  | { type: 'discard', value: string }

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'set-content':
      return { ...state, content: action.value }
    case 'set-error':
      return { ...state, error: action.value }
    case 'discard':
      return { content: action.value, error: '' }
  }
}

function InstructionsEditor({ items, selected, effectiveSelectedKey, eyebrow, saving, onSelect, onSave, onCreate }: InstructionsEditorProps) {
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const [state, dispatch] = useReducer(editorReducer, undefined as never, () => ({
    content: selected?.content ?? '',
    error: '',
  }))

  const dirty = selected ? state.content !== selected.content : false
  const lineCount = state.content ? state.content.split('\n').length : 0
  const sub = selected
    ? `${selected.path} · ${lineCount} lines`
    : '.codex/AGENTS.md'

  const handleSave = async () => {
    if (!selected) return
    dispatch({ type: 'set-error', value: '' })
    try { await onSave(selected.path, state.content) } catch (e) {
      dispatch({ type: 'set-error', value: e instanceof Error ? e.message : 'Failed to save' })
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="AGENTS.md"
        sub={sub}
        dirty={dirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        {items.length > 1 ? (
          <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
            <div className="px-3 pt-3 pb-2 shrink-0">
              <h3 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">Instruction Stack</h3>
              <p className="text-[10px] text-foreground/35 mt-0.5">AGENTS.md files</p>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
              {items.map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelect(item.key)}
                  className={`w-full text-left px-2.5 py-2 rounded-md transition-colors border ${
                    item.key === effectiveSelectedKey
                      ? 'bg-primary/8 text-primary border-primary/20'
                      : 'text-foreground/65 hover:bg-foreground/[0.03] border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold truncate flex-1">{item.name}</span>
                    {item.badge ? <span className="text-[8px] font-bold uppercase tracking-wider rounded-full border border-border/40 px-1.5 py-0.5 text-foreground/50">{item.badge}</span> : null}
                  </div>
                  <p className="text-[9px] mt-1 font-mono text-foreground/35 truncate">{item.path}</p>
                </button>
              ))}
            </div>
            <div className="p-2 shrink-0 border-t border-border/30">
              <Button size="sm" variant="ghost" onClick={() => onCreate()} className="w-full h-7 text-[10px]">
                <Plus size={10} className="mr-1" /> Create Instructions
              </Button>
            </div>
          </aside>
        ) : null}

        <div className="flex-1 min-w-0 rounded-lg border border-border/30 overflow-hidden">
          <Suspense fallback={null}>
            <Editor
              language="markdown"
              value={state.content}
              theme={theme === 'dark' ? 'vs-dark' : 'vs'}
              onChange={(v) => { if (v !== undefined) dispatch({ type: 'set-content', value: v }) }}
              options={{
                minimap: { enabled: false },
                fontSize: editorSettings.fontSize,
                fontFamily: editorSettings.fontFamily || undefined,
                lineNumbers: 'off',
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                renderWhitespace: 'none',
                padding: { top: 12, bottom: 12 },
              }}
            />
          </Suspense>
        </div>
      </div>

      <ErrorStrip message={state.error} onDismiss={() => dispatch({ type: 'set-error', value: '' })} />

      <PanelFooter
        dirty={dirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={() => dispatch({ type: 'discard', value: selected?.content ?? '' })}
      />
    </div>
  )
}
