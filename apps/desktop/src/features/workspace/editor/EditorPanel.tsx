import Editor from '@monaco-editor/react'
import { useAppStore } from '@core/store'
import { useEffect, useRef } from 'react'
import { EditorTabs } from './EditorTabs'

export function EditorPanel() {
  const openFiles = useAppStore((s) => s.openFiles)
  const activeFileId = useAppStore((s) => s.activeFileId)
  const setFileContent = useAppStore((s) => s.setFileContent)
  const setFileDirty = useAppStore((s) => s.setFileDirty)
  const theme = useAppStore((s) => s.theme)
  const editorSettings = useAppStore((s) => s.editorSettings)

  const activeFile = openFiles.find((f) => f.id === activeFileId)
  const originalContentRef = useRef<string>('')

  // Load file content when active file changes
  useEffect(() => {
    if (!activeFile || activeFile.content !== null) return
    let cancelled = false
    const load = async () => {
      try {
        const result = await window.orchestraDesktop.fs.readFile(activeFile.filePath)
        if (cancelled) return
        if (result.isBinary) {
          setFileContent(activeFile.id, '// Binary file — cannot display')
        } else if (result.tooLarge) {
          setFileContent(activeFile.id, '// File too large to display (>5MB)')
        } else {
          setFileContent(activeFile.id, result.content)
          originalContentRef.current = result.content
        }
      } catch {
        if (!cancelled) {
          setFileContent(activeFile.id, '// Error loading file')
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.id, activeFile?.content])

  // Update originalContentRef when switching to a file that's already loaded
  useEffect(() => {
    if (activeFile?.content !== null && activeFile?.content !== undefined && !activeFile.isDirty) {
      originalContentRef.current = activeFile.content
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.id])

  // Save handler (Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (activeFile?.isDirty && activeFile.content !== null) {
          window.orchestraDesktop.fs
            .writeFile(activeFile.filePath, activeFile.content)
            .then(() => {
              setFileDirty(activeFile.id, false)
              originalContentRef.current = activeFile.content!
            })
            .catch(() => {})
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeFile?.id, activeFile?.isDirty, activeFile?.content, activeFile?.filePath, setFileDirty])

  if (openFiles.length === 0) return null

  return (
    <div className="flex flex-col h-full">
      <EditorTabs />
      {activeFile && activeFile.content !== null ? (
        <div className="flex-1 min-h-0">
          <Editor
            key={activeFile.id}
            language={activeFile.language}
            value={activeFile.content}
            theme={theme === 'dark' ? 'vs-dark' : 'vs'}
            onChange={(value) => {
              if (value !== undefined) {
                setFileContent(activeFile.id, value)
                setFileDirty(activeFile.id, value !== originalContentRef.current)
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
        </div>
      ) : activeFile ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading...
        </div>
      ) : null}
    </div>
  )
}
