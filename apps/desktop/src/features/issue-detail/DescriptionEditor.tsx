import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'

export function DescriptionEditor({ value, onChange, onBlur, theme, projectId }: {
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  theme?: 'light' | 'dark'
  projectId?: string
}) {
  // eslint-disable-next-line react-doctor/rerender-state-only-in-handlers
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.selectionStart = textareaRef.current.value.length
    }
  }, [editing])

  if (editing) {
    return (
      <div className="flex-1 flex flex-col min-h-0 rounded-lg border border-primary/30 bg-muted/10 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 bg-muted/20 shrink-0">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Editing Markdown</span>
          <button
            className="text-[9px] font-bold uppercase tracking-widest text-primary/60 hover:text-primary transition-colors"
            onClick={() => setEditing(false)}
          >
            Preview
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="w-full flex-1 bg-transparent text-sm text-foreground font-mono outline-none focus:outline-none placeholder:text-muted-foreground/15 leading-relaxed resize-none p-4"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={() => { onBlur(); setEditing(false) }}
          placeholder="Describe what this task should accomplish...&#10;&#10;Supports **Markdown** formatting."
        />
      </div>
    )
  }

  if (!value.trim()) {
    return (
      <button
        className="flex-1 flex flex-col items-center justify-center rounded-lg border border-dashed border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-all cursor-text group"
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-5 text-muted-foreground/15 group-hover:text-primary/30 transition-colors mb-2" />
        <span className="text-sm text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors">Click to add a description…</span>
      </button>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex-1 min-h-0 rounded-lg cursor-text transition-all group/md relative overflow-auto"
      onClick={() => setEditing(true)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true) } }}
    >
      <div className="absolute top-2 right-2 opacity-0 group-hover/md:opacity-100 transition-opacity">
        <div className="flex items-center gap-1 rounded-md bg-muted/80 backdrop-blur px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 border border-border/30">
          <Pencil className="size-2.5" />
          Edit
        </div>
      </div>
      <div className={`prose ${theme === 'dark' ? 'prose-invert' : ''} prose-sm max-w-none text-foreground/70 leading-relaxed
        prose-headings:text-foreground prose-headings:font-bold prose-headings:tracking-tight
        prose-h1:text-lg prose-h1:border-b prose-h1:border-border/20 prose-h1:pb-2 prose-h1:mb-3
        prose-h2:text-base prose-h2:mb-2
        prose-h3:text-sm prose-h3:mb-1
        prose-p:mb-2 prose-p:text-foreground/60
        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
        prose-strong:text-foreground/80 prose-strong:font-bold
        prose-code:text-[12px] prose-code:font-mono prose-code:bg-muted/40 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:border prose-code:border-border/20 prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-card dark:bg-card prose-pre:border prose-pre:border-border/20 prose-pre:rounded-lg
        prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-foreground/60
        prose-li:marker:text-muted-foreground/30
        prose-blockquote:border-l-primary/30 prose-blockquote:text-muted-foreground/50 prose-blockquote:italic prose-blockquote:not-italic prose-blockquote:font-normal
        prose-hr:border-border/20
        prose-img:rounded-lg prose-img:border prose-img:border-border/20
        prose-table:text-sm prose-th:text-foreground/70 prose-td:text-foreground/50
      `}>
        <MarkdownRenderer content={value} linkProjectId={projectId} />
      </div>
    </div>
  )
}
