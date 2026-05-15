// apps/desktop/src/features/agents/panels/InstructionsPanel.tsx
import { lazy, Suspense, useReducer, useState } from 'react'
import { useAppStore } from '@core/store'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import { usePublishDirty } from '../hooks/use-publish-dirty'

const Editor = lazy(() => import('@monaco-editor/react'))

type ContentState = { content: string }
type ContentAction =
  | { type: 'set'; value: string }
  | { type: 'reset'; value: string }

const contentReducer = (state: ContentState, action: ContentAction): ContentState => {
  switch (action.type) {
    case 'set':
    case 'reset':
      return { content: action.value }
    default:
      return state
  }
}

interface InstructionsPanelProps {
  content: string
  path: string
  exists: boolean
  saving: string | null
  scope: Scope
  projectName: string | null
  onSave: (content: string) => Promise<void>
  onDelete?: () => Promise<void>
}

export function InstructionsPanel({
  content: propsContent, path, exists, saving, scope, projectName, onSave, onDelete,
}: InstructionsPanelProps) {
  return (
    <InstructionsPanelInner
      key={propsContent}
      propsContent={propsContent}
      path={path}
      exists={exists}
      saving={saving}
      scope={scope}
      projectName={projectName}
      onSave={onSave}
      onDelete={onDelete}
    />
  )
}

function InstructionsPanelInner({
  propsContent, path, exists, saving, scope, projectName, onSave, onDelete,
}: {
  propsContent: string
  path: string
  exists: boolean
  saving: string | null
  scope: Scope
  projectName: string | null
  onSave: (content: string) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const [state, dispatch] = useReducer(contentReducer, { content: propsContent })
  const { content } = state
  const [error, setError] = useState('')
  const dirty = content !== propsContent
  usePublishDirty(dirty)

  const eyebrow = scope === 'GLOBAL' ? 'Global / Instructions' : `${projectName ?? 'Project'} / Instructions`
  const sub = scope === 'GLOBAL'
    ? `Global instructions · ${path}`
    : `Project instructions for ${projectName ?? 'this workspace'} · appends to global · ${path}`

  if (!exists) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="CLAUDE.md"
          sub={`No instructions file at this scope · ${path}`}
        />
        <EmptyStateCard
          title="No CLAUDE.md at this scope"
          description={scope === 'GLOBAL'
            ? 'Global instructions apply to every project unless overridden.'
            : 'Project instructions append to global. Optional.'}
          ctaLabel="Create CLAUDE.md"
          onCreate={() => { void onSave('') }}
          pending={!!saving}
        />
      </div>
    )
  }

  const handleSave = async () => {
    setError('')
    try { await onSave(content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="CLAUDE.md"
        sub={sub}
        dirty={dirty}
      />

      <div className="flex-1 min-h-0 rounded-lg border border-border/30 overflow-hidden">
        <Suspense fallback={null}>
          <Editor
            language="markdown"
            value={content}
            theme={theme === 'dark' ? 'vs-dark' : 'vs'}
            onChange={(v) => { if (v !== undefined) dispatch({ type: 'set', value: v }) }}
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

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={dirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={() => dispatch({ type: 'reset', value: propsContent })}
        extraLeft={
          onDelete && (
            <button
              type="button"
              onClick={() => { void onDelete() }}
              className="text-[10px] text-foreground/40 hover:text-red-400 transition-colors"
            >
              Delete file
            </button>
          )
        }
      />
    </div>
  )
}
