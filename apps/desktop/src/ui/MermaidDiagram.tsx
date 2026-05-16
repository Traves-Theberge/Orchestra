import React, { Component, useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { createPortal } from 'react-dom'
import mermaid from 'mermaid'
import { Maximize2, ZoomIn, ZoomOut, X } from 'lucide-react'

// Error boundary that catches any crash inside a diagram and shows it inline
export class DiagramErrorBoundary extends Component<
    { chart: string; children: ReactNode },
    { error: string | null }
> {
    state = { error: null as string | null }
    static getDerivedStateFromError(err: Error) {
        return { error: err.message || 'Unknown rendering error' }
    }
    componentDidCatch(err: Error, info: ErrorInfo) {
        console.error('[MermaidDiagram] Render crash:', err, info)
    }
    render() {
        if (this.state.error) {
            return (
                <div className="my-10 rounded-2xl overflow-hidden border border-amber-500/30 bg-amber-500/5 p-5">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="size-2 rounded-full bg-amber-500" />
                        <p className="text-xs font-bold text-amber-500 uppercase tracking-widest">Diagram Render Error</p>
                    </div>
                    <pre className="text-xs text-muted-foreground/80 whitespace-pre-wrap leading-relaxed">{this.state.error}</pre>
                    <details className="mt-3">
                        <summary className="text-[10px] text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors uppercase tracking-widest font-bold">View Source</summary>
                        <pre className="mt-2 text-[11px] text-muted-foreground/40 whitespace-pre-wrap font-mono bg-muted/20 rounded-lg p-3 max-h-40 overflow-auto">{this.props.chart}</pre>
                    </details>
                </div>
            )
        }
        return this.props.children
    }
}

interface MermaidDiagramProps {
    chart: string
    theme?: 'light' | 'dark'
}

// ── Module-level render machinery ──────────────────────────────────

let renderCounter = 0
let lastInitTheme: string | null = null
const svgCache = new Map<string, string>()

function cacheKey(chart: string, theme: string) {
    return `${theme}::${chart.trim()}`
}

const darkThemeVars = {
    primaryColor: 'hsl(161 72% 20%)',
    primaryTextColor: 'hsl(160 20% 98%)',
    primaryBorderColor: 'hsl(161 72% 45%)',
    secondaryColor: 'hsl(160 10% 12%)',
    secondaryTextColor: 'hsl(160 20% 98%)',
    secondaryBorderColor: 'hsl(160 10% 25%)',
    tertiaryColor: 'hsl(160 10% 9%)',
    tertiaryTextColor: 'hsl(160 5% 65%)',
    tertiaryBorderColor: 'hsl(160 10% 20%)',
    lineColor: 'hsl(161 72% 45%)',
    textColor: 'hsl(160 20% 98%)',
    mainBkg: 'hsl(160 10% 7%)',
    nodeBorder: 'hsl(161 72% 45%)',
    clusterBkg: 'hsl(160 10% 9%)',
    clusterBorder: 'hsl(160 10% 15%)',
    titleColor: 'hsl(160 20% 98%)',
    edgeLabelBackground: 'hsl(160 10% 7%)',
    nodeTextColor: 'hsl(160 20% 98%)',
}

const lightThemeVars = {
    primaryColor: 'hsl(230 44% 90%)',
    primaryTextColor: 'hsl(224 50% 10%)',
    primaryBorderColor: 'hsl(230 44% 56%)',
    secondaryColor: 'hsl(220 14% 96%)',
    secondaryTextColor: 'hsl(224 50% 10%)',
    secondaryBorderColor: 'hsl(220 13% 80%)',
    tertiaryColor: 'hsl(220 20% 97%)',
    tertiaryTextColor: 'hsl(220 10% 40%)',
    tertiaryBorderColor: 'hsl(220 13% 87%)',
    lineColor: 'hsl(230 44% 56%)',
    textColor: 'hsl(224 50% 10%)',
    mainBkg: 'hsl(0 0% 100%)',
    nodeBorder: 'hsl(230 44% 56%)',
    clusterBkg: 'hsl(220 20% 97%)',
    clusterBorder: 'hsl(220 13% 87%)',
    titleColor: 'hsl(224 50% 10%)',
    edgeLabelBackground: 'hsl(0 0% 100%)',
    nodeTextColor: 'hsl(224 50% 10%)',
}

function initMermaid(theme: string) {
    if (lastInitTheme === theme) return
    lastInitTheme = theme
    mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: theme === 'dark' ? darkThemeVars : lightThemeVars,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    })
}

// ── Module-level fullscreen store (survives component remounts) ────

type FullscreenState = { svg: string; scale: number } | null
let fullscreenState: FullscreenState = null
const fullscreenListeners = new Set<() => void>()

function getFullscreenSnapshot(): FullscreenState {
    return fullscreenState
}

function subscribeFullscreen(cb: () => void) {
    fullscreenListeners.add(cb)
    return () => { fullscreenListeners.delete(cb) }
}

function setFullscreen(next: FullscreenState) {
    fullscreenState = next
    fullscreenListeners.forEach(cb => cb())
}

// ── Fullscreen overlay (rendered once via portal) ──────────────────

export function DiagramFullscreenOverlay() {
    const state = useSyncExternalStore(subscribeFullscreen, getFullscreenSnapshot)

    const close = useCallback(() => setFullscreen(null), [])
    const zoomIn = useCallback(() => {
        if (fullscreenState) setFullscreen({ ...fullscreenState, scale: Math.min(fullscreenState.scale + 0.5, 10) })
    }, [])
    const zoomOut = useCallback(() => {
        if (fullscreenState) setFullscreen({ ...fullscreenState, scale: Math.max(fullscreenState.scale - 0.5, 0.25) })
    }, [])
    const resetZoom = useCallback(() => {
        if (fullscreenState) setFullscreen({ ...fullscreenState, scale: 1 })
    }, [])

    // Scroll wheel zoom
    useEffect(() => {
        if (!state) return
        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                if (!fullscreenState) return
                const delta = e.deltaY > 0 ? -0.25 : 0.25
                const next = Math.min(Math.max(fullscreenState.scale + delta, 0.25), 10)
                setFullscreen({ ...fullscreenState, scale: next })
            }
        }
        window.addEventListener('wheel', handleWheel, { passive: false })
        return () => window.removeEventListener('wheel', handleWheel)
    }, [state])

    useEffect(() => {
        if (!state) return
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setFullscreen(null)
        }
        window.addEventListener('keydown', handleKey)
        return () => window.removeEventListener('keydown', handleKey)
    }, [state])

    if (!state) return null

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Mermaid diagram fullscreen"
            className="fixed inset-0 z-[9999] bg-background/95 backdrop-blur-xl flex flex-col animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget) close() }}
            onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                    e.preventDefault()
                    close()
                }
            }}
        >
            <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card/80 shrink-0">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                    <span>Mermaid Diagram</span>
                    <span className="text-muted-foreground/30">|</span>
                    <span>{Math.round(state.scale * 100)}%</span>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={zoomOut} className="size-8 rounded-lg border border-border bg-muted/30 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                        <ZoomOut size={14} />
                    </button>
                    <button onClick={resetZoom} className="h-8 px-3 rounded-lg border border-border bg-muted/30 flex items-center justify-center text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                        Reset
                    </button>
                    <button onClick={zoomIn} className="size-8 rounded-lg border border-border bg-muted/30 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                        <ZoomIn size={14} />
                    </button>
                    <div className="w-px h-5 bg-border mx-2" />
                    <button onClick={close} className="size-8 rounded-lg border border-destructive/30 bg-destructive/10 flex items-center justify-center text-destructive hover:bg-destructive/20 transition-all">
                        <X size={14} />
                    </button>
                </div>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center p-8">
                <div
                    className="transition-transform duration-200 w-full h-full flex items-center justify-center [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:object-contain"
                    style={{ transform: `scale(${state.scale})`, transformOrigin: 'center center' }}
                    // eslint-disable-next-line react/no-danger -- SVG produced by Mermaid library, no user input rendered as HTML
                    dangerouslySetInnerHTML={{ __html: state.svg }}
                />
            </div>
            <div className="px-6 py-2 border-t border-border text-center shrink-0">
                <span className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">
                    Esc to close · Click backdrop to close · Scroll to pan
                </span>
            </div>
        </div>,
        document.body
    )
}

// ── Inline diagram component ───────────────────────────────────────

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart, theme }) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const resolvedTheme = theme ?? (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    const key = cacheKey(chart, resolvedTheme)

    const [svg, setSvg] = useState<string>(() => svgCache.get(key) || '')
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (svgCache.has(key)) {
            setSvg(svgCache.get(key)!)
            setError(null)
            return
        }

        let cancelled = false
        renderCounter++
        const renderId = `mermaid-render-${renderCounter}-${Date.now()}`

        const render = async () => {
            initMermaid(resolvedTheme)
            try {
                const { svg: renderedSvg } = await mermaid.render(renderId, chart.trim())
                if (!cancelled) {
                    svgCache.set(key, renderedSvg)
                    setSvg(renderedSvg)
                    setError(null)
                }
            } catch (err) {
                // Clean up any error elements mermaid injected into the DOM
                const errEl = document.getElementById(renderId)
                if (errEl) errEl.remove()
                document.querySelectorAll('.mermaid-error, [id^="d"]').forEach(el => {
                    if (el.classList.contains('error-icon') || el.querySelector('.error-text')) el.remove()
                })
                if (!cancelled) {
                    const msg = err instanceof Error ? err.message : String(err)
                    setError(msg.replace(/ParseError:?\s*/i, '').trim() || 'Failed to render diagram')
                    setSvg('')
                }
            }
        }

        render()
        return () => {
            cancelled = true
            const tempEl = document.getElementById(renderId)
            if (tempEl) tempEl.remove()
        }
    }, [key, chart, resolvedTheme])

    useEffect(() => {
        const stalePrefix = resolvedTheme === 'dark' ? 'light::' : 'dark::'
        for (const k of svgCache.keys()) {
            if (k.startsWith(stalePrefix)) svgCache.delete(k)
        }
    }, [resolvedTheme])

    const openFullscreen = useCallback(() => {
        if (!svg) return
        // Strip fixed width/height from SVG so it scales with CSS, keep viewBox
        const scalable = svg
            .replace(/(<svg[^>]*)\s+width="[^"]*"/i, '$1')
            .replace(/(<svg[^>]*)\s+height="[^"]*"/i, '$1')
            .replace(/(<svg[^>]*)\s+style="[^"]*"/i, '$1 style="width:100%;height:100%"')
        setFullscreen({ svg: scalable, scale: 1 })
    }, [svg])

    if (error) {
        return (
            <div className="my-10 rounded-2xl overflow-hidden border border-amber-500/30 bg-amber-500/5 p-5">
                <div className="flex items-center gap-2 mb-2">
                    <div className="size-2 rounded-full bg-amber-500" />
                    <p className="text-xs font-bold text-amber-500 uppercase tracking-widest">Diagram Syntax Error</p>
                </div>
                <pre className="text-xs text-muted-foreground/80 whitespace-pre-wrap leading-relaxed">{error}</pre>
                <details className="mt-3">
                    <summary className="text-[10px] text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors uppercase tracking-widest font-bold">View Source</summary>
                    <pre className="mt-2 text-[11px] text-muted-foreground/40 whitespace-pre-wrap font-mono bg-muted/20 rounded-lg p-3 max-h-40 overflow-auto">{chart}</pre>
                </details>
            </div>
        )
    }

    if (!svg) {
        return (
            <div className="my-10 rounded-3xl overflow-hidden border border-border bg-card/50 p-8 flex items-center justify-center h-48">
                <div className="flex items-center gap-3 text-muted-foreground/40">
                    <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin-smooth" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Rendering diagram</span>
                </div>
            </div>
        )
    }

    return (
        <div className="my-10 rounded-3xl overflow-hidden border border-border bg-card/50 group relative">
            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <button
                    onClick={openFullscreen}
                    className="size-8 rounded-lg border border-border bg-card/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all shadow-lg"
                >
                    <Maximize2 size={14} />
                </button>
            </div>
            <div
                ref={containerRef}
                className="p-8 flex items-center justify-center [&_svg]:max-w-full overflow-x-auto"
                // eslint-disable-next-line react/no-danger -- SVG produced by Mermaid library, no user input rendered as HTML
                dangerouslySetInnerHTML={{ __html: svg }}
            />
        </div>
    )
}
