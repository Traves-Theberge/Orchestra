import { useAppStore } from '@core/store'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Save, RotateCcw, Check, Eye, Pencil, Columns2 } from 'lucide-react'
import type { OpenFile } from '@core/store/types'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'

const Editor = lazy(() => import('@monaco-editor/react'))

interface EditorContentProps {
  file: OpenFile
}

export function EditorContent({ file }: EditorContentProps) {
  const setFileContent = useAppStore((s) => s.setFileContent)
  const setFileDirty = useAppStore((s) => s.setFileDirty)
  const loadFileContent = useAppStore((s) => s.loadFileContent)
  const clearPendingReveal = useAppStore((s) => s.clearPendingReveal)
  const theme = useAppStore((s) => s.theme)
  const config = useAppStore((s) => s.config)
  const editorSettings = useAppStore((s) => s.editorSettings)

  const originalContentRef = useRef<string>('')
  const editorRef = useRef<unknown>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  type PreviewKind = null | 'markdown' | 'html' | 'svg' | 'image' | 'json'
  const previewKind: PreviewKind = useMemo(() => {
    const lower = file.filePath.toLowerCase()
    if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx') || file.language === 'markdown') {
      return 'markdown'
    }
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
    if (lower.endsWith('.svg')) return 'svg'
    if (lower.match(/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/)) return 'image'
    if (lower.endsWith('.json')) return 'json'
    return null
  }, [file.filePath, file.language])
  const isPreviewable = previewKind !== null
  const isMarkdown = previewKind === 'markdown'

  type ViewMode = 'edit' | 'preview' | 'split'
  const [mdView, setMdView] = useState<ViewMode>('edit')

  // Debounce the markdown content fed to the renderer so that mermaid blocks
  // (and code highlighting) don't thrash on every keystroke when split or
  // preview is active. Edit-only view doesn't need this.
  const [previewContent, setPreviewContent] = useState<string>(file.content ?? '')
  useEffect(() => {
    if (!isPreviewable || mdView === 'edit') {
      setPreviewContent(file.content ?? '')
      return
    }
    const handle = window.setTimeout(() => {
      setPreviewContent(file.content ?? '')
    }, 300)
    return () => window.clearTimeout(handle)
  }, [file.content, isPreviewable, mdView])

  // Reveal pending line when content + editor are both ready
  useEffect(() => {
    const line = file.pendingReveal
    const editor = editorRef.current as { revealLineInCenter?: (l: number) => void; setPosition?: (p: { lineNumber: number; column: number }) => void; focus?: () => void } | null
    if (!line || !editor || file.content === null) return
    try {
      editor.revealLineInCenter?.(line)
      editor.setPosition?.({ lineNumber: line, column: 1 })
      editor.focus?.()
    } catch (err) {
      console.warn('[editor] failed to reveal line', err)
    }
    clearPendingReveal(file.id)
  }, [file.id, file.pendingReveal, file.content, clearPendingReveal])

  const saveFile = useCallback(async () => {
    if (!file.isDirty || file.content === null) return
    setSaveState('saving')
    setSaveError(null)
    try {
      // Prefer backend HTTP API (works in browser dev mode); fall back to Electron IPC
      if (config?.baseUrl) {
        const url = `${config.baseUrl}/api/v1/workspace/file?path=${encodeURIComponent(file.filePath)}`
        const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
        if (config.apiToken) headers['Authorization'] = `Bearer ${config.apiToken}`
        const res = await fetch(url, { method: 'PUT', headers, body: file.content })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
        }
      } else if (window.orchestraDesktop?.fs?.writeFile) {
        await window.orchestraDesktop.fs.writeFile(file.filePath, file.content)
      } else {
        throw new Error('No save transport available')
      }
      setFileDirty(file.id, false)
      originalContentRef.current = file.content
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 1500)
    } catch (err) {
      console.error('[editor] save failed', err)
      setSaveError((err as Error).message)
      setSaveState('error')
    }
  }, [file.id, file.isDirty, file.content, file.filePath, config?.baseUrl, config?.apiToken, setFileDirty])

  const revertFile = useCallback(() => {
    if (!file.isDirty || originalContentRef.current === undefined) return
    setFileContent(file.id, originalContentRef.current)
    setFileDirty(file.id, false)
  }, [file.id, file.isDirty, setFileContent, setFileDirty])

  // Defensive load: if content is null and not loading, kick off a load.
  // Handles cases where openFile fired before config was ready.
  useEffect(() => {
    console.log('[editor] EditorContent effect', {
      id: file.id,
      hasContent: file.content !== null,
      loading: file.loading,
      hasConfig: !!config?.baseUrl,
    })
    if (file.content === null && !file.loading) {
      console.log('[editor] EditorContent: triggering loadFileContent for', file.id)
      loadFileContent(file.id)
    }
  }, [file.id, file.content, file.loading, config?.baseUrl, loadFileContent])

  // Track original content for dirty detection
  useEffect(() => {
    if (file.content !== null && !file.isDirty) {
      originalContentRef.current = file.content
    }
  }, [file.id, file.content, file.isDirty])

  // Save handler (Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void saveFile()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [saveFile])

  if (file.content === null) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
        <div>{file.loading ? 'Loading…' : 'Waiting for backend…'}</div>
        <div className="text-[10px] opacity-60">{file.filePath}</div>
        {!file.loading && !config?.baseUrl && (
          <div className="text-[10px] text-amber-500">Backend config not loaded yet</div>
        )}
        {!file.loading && config?.baseUrl && (
          <button
            onClick={() => loadFileContent(file.id)}
            className="mt-1 text-[11px] px-2 py-0.5 rounded bg-accent hover:bg-accent/80"
          >
            Retry
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 h-8 shrink-0 border-b border-border bg-card/50 text-[11px] overflow-hidden">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="truncate text-muted-foreground" title={file.filePath}>{file.relativePath}</span>
          {file.isDirty && (
            <span className="size-1.5 rounded-full bg-blue-400 shrink-0" title="Unsaved changes" />
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isPreviewable && (
            <div className="flex items-center rounded-md bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setMdView('edit')}
                title="Editor"
                aria-label="Markdown editor view"
                aria-pressed={mdView === 'edit'}
                className={`grid h-5 w-6 place-items-center rounded transition-colors ${
                  mdView === 'edit' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/70 hover:text-foreground'
                }`}
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                onClick={() => setMdView('split')}
                title="Split"
                aria-label="Markdown split view"
                aria-pressed={mdView === 'split'}
                className={`grid h-5 w-6 place-items-center rounded transition-colors ${
                  mdView === 'split' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/70 hover:text-foreground'
                }`}
              >
                <Columns2 size={11} />
              </button>
              <button
                type="button"
                onClick={() => setMdView('preview')}
                title="Preview"
                aria-label="Markdown preview view"
                aria-pressed={mdView === 'preview'}
                className={`grid h-5 w-6 place-items-center rounded transition-colors ${
                  mdView === 'preview' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/70 hover:text-foreground'
                }`}
              >
                <Eye size={11} />
              </button>
            </div>
          )}
          {saveState === 'saved' && (
            <span className="flex items-center gap-1 text-green-500">
              <Check size={11} /> Saved
            </span>
          )}
          {saveState === 'error' && saveError && (
            <span className="text-red-400 truncate max-w-[200px]" title={saveError}>{saveError}</span>
          )}
          <button
            onClick={revertFile}
            disabled={!file.isDirty}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            title="Revert unsaved changes"
          >
            <RotateCcw size={11} /> Revert
          </button>
          <button
            onClick={() => void saveFile()}
            disabled={!file.isDirty || saveState === 'saving'}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Save (Ctrl+S)"
          >
            <Save size={11} /> {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex">
        {(!isPreviewable || mdView !== 'preview') && (
          <div className={`min-h-0 ${isPreviewable && mdView === 'split' ? 'w-1/2 border-r border-border/60' : 'w-full'}`}>
            <Suspense fallback={null}>
              <Editor
                key={file.id}
                language={file.language}
                value={file.content}
                theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                onMount={(editor) => {
                  editorRef.current = editor
                  const line = file.pendingReveal
                  if (line) {
                    try {
                      editor.revealLineInCenter(line)
                      editor.setPosition({ lineNumber: line, column: 1 })
                      editor.focus()
                      clearPendingReveal(file.id)
                    } catch (err) {
                      console.warn('[editor] onMount reveal failed', err)
                    }
                  }
                }}
                onChange={(value) => {
                  if (value !== undefined) {
                    setFileContent(file.id, value)
                    setFileDirty(file.id, value !== originalContentRef.current)
                  }
                }}
                options={{
                  minimap: { enabled: editorSettings.minimap },
                  fontSize: editorSettings.fontSize,
                  fontFamily: editorSettings.fontFamily || undefined,
                  lineNumbers: editorSettings.lineNumbers,
                  wordWrap: editorSettings.wordWrap,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: editorSettings.tabSize,
                  renderWhitespace: editorSettings.renderWhitespace,
                }}
              />
            </Suspense>
          </div>
        )}
        {isPreviewable && mdView !== 'edit' && (
          <div className={`min-h-0 overflow-auto ${mdView === 'split' ? 'w-1/2' : 'w-full'}`}>
            <PreviewPane kind={previewKind} content={previewContent} filePath={file.filePath} />
          </div>
        )}
      </div>
    </div>
  )
}

function PreviewPane({
  kind,
  content,
  filePath,
}: {
  kind: 'markdown' | 'html' | 'svg' | 'image' | 'json' | null
  content: string
  filePath: string
}) {
  if (kind === 'markdown') {
    return (
      <div className="px-6 py-5 max-w-3xl mx-auto">
        <MarkdownRenderer content={content} />
      </div>
    )
  }
  if (kind === 'html') {
    // Render in a sandboxed iframe — no scripts, no same-origin, no popups.
    return (
      <iframe
        title={`Preview ${filePath}`}
        srcDoc={content}
        sandbox=""
        className="h-full w-full bg-white"
      />
    )
  }
  if (kind === 'svg') {
    // Inline the SVG so vector scaling kicks in. SVG source comes from the
    // user's own filesystem — same trust model as the rest of the editor.
    return (
      <div className="grid h-full w-full place-items-center p-6">
        <div
          className="max-h-full max-w-full [&_svg]:max-h-full [&_svg]:max-w-full"
          // eslint-disable-next-line react/no-danger -- local file source
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    )
  }
  if (kind === 'image') {
    // Use file:// so binary images render. Electron has no protocol restriction
    // here; in browser dev mode this falls back to the backend file endpoint
    // would be cleaner, but file:// works for the common case.
    const src = `file://${filePath}`
    return (
      <div className="grid h-full w-full place-items-center p-6 bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
        <img src={src} alt={filePath} className="max-h-full max-w-full object-contain" />
      </div>
    )
  }
  if (kind === 'json') {
    let pretty = content
    try {
      pretty = JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      /* keep raw text — likely partial / mid-typing */
    }
    return (
      <pre className="px-6 py-5 text-[12px] leading-relaxed font-mono text-foreground whitespace-pre-wrap break-words">
        {pretty}
      </pre>
    )
  }
  return null
}
