import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  Monitor,
  RotateCcw,
  Smartphone,
  Tablet,
  X,
} from 'lucide-react'
import { htmlRenderFileName, type HtmlRenderReference } from './htmlRender'
import { HtmlRenderDocument } from './HtmlRenderDocument'

interface HtmlRenderModalProps {
  readonly htmlRender: HtmlRenderReference
  readonly isOpen: boolean
  readonly onClose: () => void
}

type ViewportMode = 'fluid' | 'tablet' | 'mobile'
type ViewTab = 'preview' | 'source'

export function HtmlRenderModal({ htmlRender, isOpen, onClose }: HtmlRenderModalProps) {
  const [tab, setTab] = useState<ViewTab>('preview')
  const [viewport, setViewport] = useState<ViewportMode>('fluid')
  const [copied, setCopied] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Listen for Escape key to close modal
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const fileName = htmlRenderFileName(htmlRender.title)
  const rawHtml = htmlRender.html ?? ''

  const lines = useMemo(() => {
    if (!rawHtml) return []
    return rawHtml.split('\n')
  }, [rawHtml])

  const fileSizeKb = useMemo(() => {
    if (!rawHtml) return '0.0'
    const bytes = new Blob([rawHtml]).size
    return (bytes / 1024).toFixed(1)
  }, [rawHtml])

  if (!isOpen) return null

  const handleCopy = async () => {
    if (!rawHtml) return
    try {
      await navigator.clipboard.writeText(rawHtml)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  const handleDownload = () => {
    if (!rawHtml) return
    try {
      const blob = new Blob([rawHtml], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // ignore
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={htmlRender.title}
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl animate-in fade-in-0 duration-150 select-none"
    >
      {/* Refined Studio Header Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-background/80 px-4 sm:px-6 backdrop-blur-md">
        {/* Left: Clean spacer */}
        <div className="w-8 shrink-0" />

        {/* Center: Tabs & Viewport Switcher */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Tabs: Preview vs Source */}
          <div className="flex rounded-lg border border-border/50 bg-muted/30 p-0.5 text-xs font-medium shadow-xs">
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${
                tab === 'preview'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Eye className="size-3.5" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('source')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${
                tab === 'source'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Code2 className="size-3.5" />
              <span>Source</span>
            </button>
          </div>

          {/* Viewport Widths (Preview only) */}
          {tab === 'preview' && (
            <div className="hidden md:flex items-center gap-2">
              <div className="h-4 w-px bg-border/60" />

              <div className="flex items-center rounded-lg border border-border/50 bg-muted/30 p-0.5 text-xs shadow-xs">
                <button
                  type="button"
                  onClick={() => setViewport('mobile')}
                  title="Mobile (390px)"
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-all ${
                    viewport === 'mobile'
                      ? 'bg-background text-foreground shadow-xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Smartphone className="size-3.5" />
                  <span className="text-[11px]">Mobile</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewport('tablet')}
                  title="Tablet (768px)"
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-all ${
                    viewport === 'tablet'
                      ? 'bg-background text-foreground shadow-xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Tablet className="size-3.5" />
                  <span className="text-[11px]">Tablet</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewport('fluid')}
                  title="Fluid (100%)"
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-all ${
                    viewport === 'fluid'
                      ? 'bg-background text-foreground shadow-xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Monitor className="size-3.5" />
                  <span className="text-[11px]">Fluid</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {tab === 'preview' && (
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              title="Reload preview"
              className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shadow-xs"
            >
              <RotateCcw className="size-3.5" />
              <span className="hidden lg:inline">Reload</span>
            </button>
          )}

          {rawHtml && (
            <>
              <button
                type="button"
                onClick={() => void handleCopy()}
                title="Copy HTML to clipboard"
                className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shadow-xs"
              >
                {copied ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={handleDownload}
                title="Download HTML file"
                className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shadow-xs"
              >
                <Download className="size-3.5" />
                <span className="hidden sm:inline">Download</span>
              </button>
            </>
          )}

          <div className="h-4 w-px bg-border/60 mx-0.5" />

          {/* Close Button with Esc shortcut badge */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center gap-1.5 rounded-lg border border-transparent p-1.5 text-muted-foreground hover:border-border/50 hover:bg-muted hover:text-foreground transition-all"
          >
            <X className="size-4" />
            <kbd className="hidden sm:inline-flex items-center rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
              ESC
            </kbd>
          </button>
        </div>
      </header>

      {/* Main Studio Canvas */}
      <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 flex items-center justify-center bg-muted/10 [background-image:radial-gradient(rgba(128,128,128,0.12)_1px,transparent_1px)] [background-size:24px_24px]">
        {tab === 'preview' ? (
          viewport === 'mobile' ? (
            /* Mobile Device Frame */
            <div className="w-[390px] max-w-full h-[820px] max-h-[84vh] rounded-[2.5rem] border-4 border-border/80 bg-card shadow-2xl shadow-black/60 overflow-hidden flex flex-col ring-1 ring-border/20 transition-all duration-200">
              {/* Dynamic Island / Speaker notch */}
              <div className="shrink-0 h-7 bg-background/60 flex items-center justify-center border-b border-border/30">
                <div className="h-3.5 w-24 rounded-full bg-border/70 flex items-center px-2">
                  <div className="size-1.5 rounded-full bg-background/80 ml-auto" />
                </div>
              </div>
              <div className="flex-1 overflow-hidden bg-background">
                <HtmlRenderDocument
                  key={refreshKey}
                  html={rawHtml}
                  title={htmlRender.title}
                  className="size-full"
                />
              </div>
              {/* Home indicator bar */}
              <div className="shrink-0 h-4 bg-background/60 flex items-center justify-center">
                <div className="h-1 w-32 rounded-full bg-muted-foreground/30" />
              </div>
            </div>
          ) : viewport === 'tablet' ? (
            /* Tablet Frame */
            <div className="w-[768px] max-w-full h-[840px] max-h-[84vh] rounded-2xl border-2 border-border/70 bg-card shadow-2xl shadow-black/50 overflow-hidden flex flex-col ring-1 ring-border/20 transition-all duration-200">
              {/* Top tablet header */}
              <div className="shrink-0 h-6 bg-muted/30 border-b border-border/30 flex items-center px-4 justify-between text-[10px] text-muted-foreground font-mono">
                <div className="flex items-center gap-1.5">
                  <div className="size-1.5 rounded-full bg-muted-foreground/40" />
                  <span>iPad Preview • 768px</span>
                </div>
                <span>768 × 1024</span>
              </div>
              <div className="flex-1 overflow-hidden bg-background">
                <HtmlRenderDocument
                  key={refreshKey}
                  html={rawHtml}
                  title={htmlRender.title}
                  className="size-full"
                />
              </div>
            </div>
          ) : (
            /* Fluid: a borderless sheet floating over the canvas */
            <div className="w-full max-w-7xl h-[84vh] rounded-2xl bg-background shadow-[0_30px_90px_-20px_rgba(0,0,0,0.55),0_8px_24px_-12px_rgba(0,0,0,0.35)] overflow-hidden flex flex-col transition-all duration-200">
              <div className="flex-1 overflow-hidden">
                <HtmlRenderDocument
                  key={refreshKey}
                  html={rawHtml}
                  title={htmlRender.title}
                  className="size-full"
                />
              </div>
            </div>
          )
        ) : (
          /* Refined Source Viewer with Line Numbers */
          <div className="w-full max-w-5xl h-[84vh] rounded-xl border border-border/60 bg-card shadow-2xl shadow-black/40 overflow-hidden flex flex-col select-text">
            {/* Source Header */}
            <div className="shrink-0 h-9 bg-muted/40 border-b border-border/40 px-4 flex items-center justify-between text-xs text-muted-foreground select-none">
              <div className="flex items-center gap-2">
                <Code2 className="size-3.5 text-primary" />
                <span className="font-semibold text-foreground text-[11px]">HTML Document</span>
                <span className="font-mono text-[10px] text-muted-foreground">({fileName})</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground/80">
                <span>{lines.length} lines</span>
                <span>•</span>
                <span>{fileSizeKb} KB</span>
                <span>•</span>
                <span className="text-emerald-500 font-sans font-medium">UTF-8</span>
              </div>
            </div>

            {/* Source Code Content with Line Numbers */}
            <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed bg-zinc-950/70 text-zinc-100">
              <table className="w-full border-collapse">
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx} className="hover:bg-muted/10 transition-colors">
                      <td className="w-12 text-right pr-4 text-zinc-600 select-none text-[11px] align-top">
                        {idx + 1}
                      </td>
                      <td className="whitespace-pre overflow-x-auto text-zinc-200 select-text align-top">
                        {line || ' '}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
