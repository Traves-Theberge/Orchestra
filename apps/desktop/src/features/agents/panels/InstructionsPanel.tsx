// apps/desktop/src/features/agents/panels/InstructionsPanel.tsx
import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useAppStore } from '@core/store'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import { usePublishDirty } from '../hooks/use-publish-dirty'

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
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const [content, setContent] = useState(propsContent)
  const [error, setError] = useState('')
  const dirty = content !== propsContent
  usePublishDirty(dirty)

  useEffect(() => { setContent(propsContent); setError('') }, [propsContent])

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
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="CLAUDE.md"
        sub={sub}
        dirty={dirty}
      />

      <div className="flex-1 min-h-0 rounded-lg border border-border/30 overflow-hidden">
        <Editor
          language="markdown"
          value={content}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          onChange={(v) => { if (v !== undefined) setContent(v) }}
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
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={dirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={() => setContent(propsContent)}
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
