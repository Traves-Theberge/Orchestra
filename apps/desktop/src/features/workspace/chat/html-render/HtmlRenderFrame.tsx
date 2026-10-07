import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import {
  HTML_RENDER_COLUMN_WIDTH,
  htmlRenderFrameHeight,
  type HtmlRenderReference,
} from './htmlRender'
import { HtmlRenderDocument } from './HtmlRenderDocument'
import { HtmlRenderModal } from './HtmlRenderModal'

interface HtmlRenderFrameProps {
  readonly htmlRender: HtmlRenderReference
  readonly className?: string
}

/**
 * An agent's HTML visualization inline in the thread: the page itself on the thread's
 * background, at the measured height for this width until the page reports its own.
 */
export function HtmlRenderFrame({ htmlRender, className = '' }: HtmlRenderFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(HTML_RENDER_COLUMN_WIDTH)
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined)
  const [modalOpen, setModalOpen] = useState(false)

  // Track parent width for responsive breakpoints
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    setWidth(box.clientWidth || HTML_RENDER_COLUMN_WIDTH)

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => {
        if (entry) {
          setWidth(entry.contentRect.width || HTML_RENDER_COLUMN_WIDTH)
        }
      })
      observer.observe(box)
      return () => observer.disconnect()
    }
  }, [])

  const handleContentHeight = useCallback((newHeight: number) => {
    setContentHeight((prev) => (prev === newHeight ? prev : newHeight))
  }, [])

  const height = htmlRenderFrameHeight(htmlRender, width, contentHeight)
  const hasContent = Boolean(htmlRender.html || htmlRender.attachmentId)

  return (
    <>
      <div
        ref={boxRef}
        data-testid="html-render-frame"
        className={`group/html-render relative my-3 w-full rounded-xl border border-border/40 bg-card/60 shadow-xs overflow-hidden transition-all ${className}`}
        style={{ height }}
      >
        {hasContent ? (
          <>
            <HtmlRenderDocument
              html={htmlRender.html}
              title={htmlRender.title}
              className="block size-full"
              onContentHeight={handleContentHeight}
            />

            {/* Floating Action Button: Maximize / Open in panel */}
            <div className="absolute top-2.5 right-2.5 opacity-0 transition-opacity duration-150 group-hover/html-render:opacity-100 focus-within:opacity-100 z-10">
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                aria-label={`Open ${htmlRender.title} in modal`}
                title="Open visualization in panel"
                className="flex size-7 items-center justify-center rounded-lg border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-xs hover:bg-background hover:text-foreground transition-colors"
              >
                <Maximize2 className="size-3.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex size-full items-center justify-center p-4 text-xs text-muted-foreground">
            Unable to load visualization: {htmlRender.title}
          </div>
        )}
      </div>

      {modalOpen && (
        <HtmlRenderModal
          htmlRender={htmlRender}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}
