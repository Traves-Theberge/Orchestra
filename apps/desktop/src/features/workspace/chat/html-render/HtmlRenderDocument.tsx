import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  htmlRenderResult,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  injectHtmlRenderBootstrap,
  readHtmlRenderContentHeight,
  readHtmlRenderLinkRequest,
} from './htmlRender'
import { useHtmlRenderTheme } from './useHtmlRenderTheme'

interface HtmlRenderDocumentProps {
  readonly src?: string
  readonly html?: string
  readonly title: string
  readonly className?: string
  /** Receives the page's content height whenever it changes, so the frame fits it. */
  readonly onContentHeight?: (height: number) => void
}

/**
 * A sandboxed agent HTML render with app theming.
 * Sandboxed with `allow-scripts allow-forms` and strictly WITHOUT `allow-same-origin`,
 * ensuring an opaque origin (`null`) that cannot access host cookies, storage, or APIs.
 */
export function HtmlRenderDocument({
  src,
  html,
  title,
  className = '',
  onContentHeight,
}: HtmlRenderDocumentProps) {
  const theme = useHtmlRenderTheme()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)

  // Use srcDoc for raw HTML: in modern Chromium/Electron, navigating a sandboxed
  // (opaque origin: null) iframe to a blob: URL is blocked as a cross-origin violation.
  // srcDoc avoids navigation blocks while preserving strict sandboxing.
  const bootstrappedHtml = useMemo(() => {
    if (!html) return undefined
    return injectHtmlRenderBootstrap(html, theme)
  }, [html])

  const onContentHeightRef = useRef(onContentHeight)
  onContentHeightRef.current = onContentHeight

  // External URLs use src with theme fragment
  const effectiveSrc = useMemo(() => {
    if (!src) return undefined
    const base = src.split('#')[0]
    return `${base}${htmlRenderThemeFragment(theme)}`
  }, [src, theme])

  // Post theme updates to the iframe whenever theme changes
  const postTheme = () => {
    frameRef.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), '*')
  }

  useEffect(() => {
    if (loaded) {
      postTheme()
    }
  }, [theme, loaded])

  // Handle open-link requests from the iframe (MCP Apps bridge protocol)
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      if (!frame || event.source !== frame.contentWindow) return

      const request = readHtmlRenderLinkRequest(event.data)
      if (request) {
        // Verify link protocol
        if (/^https?:\/\//i.test(request.url)) {
          window.open(request.url, '_blank', 'noopener,noreferrer')
        }
        frame.contentWindow?.postMessage(htmlRenderResult(request.id), '*')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Handle size-changed notifications from the iframe
  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      if (!frame || event.source !== frame.contentWindow) return

      const height = readHtmlRenderContentHeight(event.data)
      if (height !== undefined) {
        onContentHeightRef.current?.(height)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="relative size-full overflow-hidden bg-background">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/60 backdrop-blur-xs">
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
            <Loader2 className="size-3.5 animate-spin text-primary/70" />
            <span>Loading preview…</span>
          </div>
        </div>
      )}
      <iframe
        ref={frameRef}
        src={src ? effectiveSrc : undefined}
        srcDoc={!src ? bootstrappedHtml : undefined}
        title={title}
        // Never allow-same-origin: the opaque origin keeps the page isolated from host context
        sandbox="allow-scripts allow-forms"
        loading="lazy"
        onLoad={() => {
          setLoaded(true)
          postTheme()
        }}
        className={`border-0 size-full transition-opacity duration-200 ${
          loaded ? 'opacity-100' : 'opacity-0'
        } ${className}`}
        style={{
          colorScheme: theme.appearance,
          backgroundColor: 'transparent',
        }}
      />
    </div>
  )
}
