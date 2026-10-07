import { lazy, Suspense } from 'react'
import { useAppStore } from '@core/store'

const Editor = lazy(() => import('@monaco-editor/react'))

/** Markdown prompt editor (Monaco), with a plain textarea while Monaco loads. */
export function PromptEditor({ value, onChange, invalid }: { value: string; onChange: (value: string) => void; invalid?: boolean }) {
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const fallback = (
    <textarea
      aria-label="Prompt"
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder="Describe what the agent should do on each run…"
      className="h-full w-full resize-none bg-transparent p-3 font-mono text-[13px] leading-5 outline-none placeholder:text-muted-foreground"
    />
  )
  return (
    <div className={`h-full min-h-[240px] overflow-hidden rounded-md border ${invalid ? 'border-red-500/60' : 'border-border'} bg-background/40`} data-testid="prompt-editor">
      <Suspense fallback={fallback}>
        <Editor
          language="markdown"
          value={value}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          onChange={next => onChange(next ?? '')}
          options={{
            minimap: { enabled: false },
            fontSize: editorSettings?.fontSize ?? 13,
            fontFamily: editorSettings?.fontFamily || undefined,
            lineNumbers: 'off',
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            renderLineHighlight: 'none',
            folding: false,
            tabSize: 2,
            padding: { top: 10, bottom: 10 },
            ariaLabel: 'Prompt',
          }}
        />
      </Suspense>
    </div>
  )
}
