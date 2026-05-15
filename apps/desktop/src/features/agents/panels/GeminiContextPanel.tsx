// apps/desktop/src/features/agents/panels/GeminiContextPanel.tsx
import { lazy, Suspense, useEffect, useState } from 'react'

const Editor = lazy(() => import('@monaco-editor/react'))
import { useAppStore } from '@core/store'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import type { FileResourceItem } from './FileResourcePanel'

interface GeminiContextPanelProps {
  items: FileResourceItem[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onCreate: () => Promise<void>
}

export function GeminiContextPanel({ items, scope, projectName, saving, onSave, onCreate }: GeminiContextPanelProps) {
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const selected = items[0] ?? null
  const [content, setContent] = useState(selected?.content ?? '')
  const [error, setError] = useState('')

  useEffect(() => { setContent(selected?.content ?? ''); setError('') }, [selected?.path, selected?.content])

  const dirty = selected ? content !== selected.content : false
  const lineCount = content.split('\n').length
  const eyebrow = scope === 'GLOBAL' ? 'Global / Context' : `${projectName ?? 'Project'} / Context`

  if (!selected) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="GEMINI.md"
          sub="No GEMINI.md file at this scope"
        />
        <EmptyStateCard
          title="No context files found"
          description="Gemini loads workspace and project context from GEMINI.md files. Global context establishes broad defaults, while project-level GEMINI.md files act as the closest operational context for a repository."
          ctaLabel="Create Context"
          onCreate={() => { void onCreate() }}
          pending={!!saving}
        />
      </div>
    )
  }

  const handleSave = async () => {
    setError('')
    try { await onSave(selected.path, content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="GEMINI.md"
        sub={`GEMINI.md · ${lineCount} line${lineCount === 1 ? '' : 's'} · ${selected.path}`}
        dirty={dirty}
      />

      <div className="flex-1 min-h-0 rounded-lg border border-border/30 overflow-hidden">
        <Suspense fallback={null}>
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
        </Suspense>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={dirty}
        saving={saving === selected.path}
        onSave={handleSave}
        onDiscard={() => setContent(selected.content)}
      />
    </div>
  )
}
