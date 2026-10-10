import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import { CodeBlock, CopyButton } from './CodeBlock'

let renderQueue: Promise<void> = Promise.resolve()
let initializedTheme: 'light' | 'dark' | null = null

function ensureInitialized(theme: 'light' | 'dark') {
  if (initializedTheme === theme) return
  mermaid.initialize({
    startOnLoad: false,
    // Calm palettes: neutral greys in light, mermaid's dark theme in dark.
    theme: theme === 'light' ? 'neutral' : 'dark',
    securityLevel: 'strict',
    // Never inject mermaid's "Syntax error" bomb SVG into the page.
    suppressErrorRendering: true,
    fontFamily: 'inherit',
  })
  initializedTheme = theme
}

// Stable per-instance id so re-renders mutate the same SVG node instead of
// regenerating one with a fresh random id (which causes the visible flash).
let nextMermaidId = 0

/** Render the diagram at its natural width so wide charts scroll instead of shrinking. */
function applyNaturalWidth(svg: SVGSVGElement | null) {
  if (!svg) return
  const max = parseFloat(svg.style.maxWidth)
  if (Number.isFinite(max) && max > 0) {
    svg.setAttribute('width', String(max))
    svg.style.maxWidth = 'none'
  }
  svg.style.height = 'auto'
}

interface MermaidBlockProps {
  code: string
  theme?: 'light' | 'dark'
  /** The message is still streaming: an invalid block is just incomplete. */
  isStreaming?: boolean
  /** The fence has not been closed yet (streaming or truncated). */
  pending?: boolean
}

export function MermaidBlock({ code, theme, isStreaming = false, pending = false }: MermaidBlockProps) {
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const idRef = useRef<string>(`mermaid-${++nextMermaidId}`)
  const lastRenderedRef = useRef<{ code: string; theme?: string } | null>(null)
  // hasSvg tracks whether the container currently has a rendered diagram in
  // it. While false we show the source as a code block, so the user always
  // sees readable text: mid-stream, before first paint, or when it fails.
  const [hasSvg, setHasSvg] = useState(false)
  const incomplete = isStreaming || pending

  useEffect(() => {
    const last = lastRenderedRef.current
    if (last && last.code === code && last.theme === theme) return

    let cancelled = false
    const trimmed = code.trim()
    const clear = () => {
      if (svgContainerRef.current) svgContainerRef.current.innerHTML = ''
      lastRenderedRef.current = null
      setHasSvg(false)
    }
    if (!trimmed) {
      clear()
      return
    }

    renderQueue = renderQueue.then(async () => {
      if (cancelled) return
      try {
        ensureInitialized(theme === 'light' ? 'light' : 'dark')
        const isValid = await tryParse(trimmed)
        if (cancelled) return
        if (!isValid) {
          // Mid-stream: keep the previous diagram (no flash). Final: show the source.
          if (!incomplete) clear()
          return
        }
        const { svg } = await mermaid.render(idRef.current, trimmed)
        if (cancelled || !svgContainerRef.current) return
        // Mermaid puts node labels inside <foreignObject> as HTML, so we need
        // both SVG and HTML profiles. Without the html profile, label text is
        // stripped and you see empty boxes. Keep <style>/<foreignObject> tags
        // because Mermaid's themes embed CSS in a <style> child of the SVG.
        svgContainerRef.current.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true, html: true },
          ADD_TAGS: ['foreignObject', 'style'],
          ADD_ATTR: ['xmlns', 'xmlns:xlink', 'transform', 'preserveAspectRatio'],
        })
        applyNaturalWidth(svgContainerRef.current.querySelector('svg'))
        lastRenderedRef.current = { code, theme }
        setHasSvg(true)
      } catch {
        if (!cancelled) clear()
      }
    })

    return () => { cancelled = true }
  }, [code, theme, incomplete])

  // Both nodes stay mounted (the SVG container is hidden until rendered) so
  // swapping between source and diagram never causes layout flicker.
  return (
    <div className="my-3" data-testid="mermaid-block" data-state={hasSvg ? 'diagram' : 'source'}>
      <div className={`group relative rounded-xl bg-muted/25 ${hasSvg ? '' : 'hidden'}`}>
        <CopyButton text={code} title="Copy diagram source" />
        <div className="overflow-x-auto px-4 py-5">
          <div
            ref={svgContainerRef}
            role="img"
            aria-label="Mermaid diagram"
            className="mx-auto flex w-max min-w-full justify-center"
          />
        </div>
      </div>
      {!hasSvg && (
        <pre className="relative border-0">
          <CodeBlock className="language-mermaid">{code}</CodeBlock>
        </pre>
      )}
    </div>
  )
}

async function tryParse(code: string): Promise<boolean> {
  try {
    return Boolean(await mermaid.parse(code, { suppressErrors: true }))
  } catch {
    return false
  }
}
