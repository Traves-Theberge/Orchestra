import { useState, type ReactNode } from 'react'
import { HtmlRenderFrame } from '@features/workspace/chat/html-render'
import { CodeBlock } from './CodeBlock'

function previewTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
    || /<!--\s*title:\s*(.+?)\s*-->/i.exec(html)
    || /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html)
  const title = match?.[1]?.replace(/<[^>]+>/g, '').trim()
  return title || 'HTML preview'
}

interface HtmlPreviewBlockProps {
  /** Raw html of the fence. */
  source: string
  /** Highlighted code children and their class, for the Code view. */
  className?: string
  children?: ReactNode
  /** The fence is not closed yet (streaming or truncated): show code, never a half page. */
  pending?: boolean
}

/**
 * A plain ```html fence holding a full page: Preview (the same sandboxed
 * HtmlRenderFrame as orchestra-html) or Code.
 */
export function HtmlPreviewBlock({ source, className, children, pending = false }: HtmlPreviewBlockProps) {
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const showPreview = !pending && view === 'preview'
  const tab = (active: boolean) =>
    `rounded-md px-2 py-0.5 transition-colors ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'} disabled:opacity-50 disabled:hover:text-muted-foreground`

  return (
    <div data-testid="html-preview-block" data-view={showPreview ? 'preview' : 'code'} className="my-3">
      <div role="tablist" aria-label="HTML view" className="mb-1 flex items-center gap-1 text-[11px] font-medium">
        <button type="button" role="tab" aria-selected={showPreview} disabled={pending} onClick={() => setView('preview')} className={tab(showPreview)}>
          Preview
        </button>
        <button type="button" role="tab" aria-selected={!showPreview} onClick={() => setView('code')} className={tab(!showPreview)}>
          Code
        </button>
        {pending && <span className="ml-1 text-[10px] text-muted-foreground/70">Preview when complete…</span>}
      </div>
      {showPreview ? (
        <HtmlRenderFrame htmlRender={{ title: previewTitle(source), height: 500, html: source }} className="!my-0" />
      ) : (
        <pre className="relative border-0">
          <CodeBlock className={className ?? 'language-html'}>{children ?? source}</CodeBlock>
        </pre>
      )}
    </div>
  )
}
