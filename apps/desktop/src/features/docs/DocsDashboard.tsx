import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
    FileText, ChevronRight, Search,
    RefreshCcw, Folder, FolderOpen,
    ArrowUp, Code as CodeIcon, ExternalLink
} from 'lucide-react'
import type { DocItem, BackendConfig } from '@core/api/types'
import { Button } from '@ui/button'
import { Skeleton } from '@ui/skeleton'
import { fetchDocs, fetchDocContent } from '@core/api/client'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { D3ArchitectureGraph } from '@ui/D3ArchitectureGraph'
import { MermaidDiagram, DiagramFullscreenOverlay, DiagramErrorBoundary } from '@ui/MermaidDiagram'
import { AppTooltip } from '@ui/tooltip-wrapper'

interface DocsDashboardProps {
    config: BackendConfig | null
    theme?: 'light' | 'dark'
}

function AuthImage({ docPath, alt, config, ...props }: { docPath: string; alt: string; config: BackendConfig | null; [key: string]: unknown }) {
    const [blobUrl, setBlobUrl] = useState<string | null>(null)
    useEffect(() => {
        if (!config) return
        let revoked = false
        const url = new URL(`/api/v1/docs/${docPath}`, config.baseUrl).toString()
        fetch(url, { headers: { Authorization: `Bearer ${config.apiToken}` } })
            .then(r => r.blob())
            .then(blob => {
                if (revoked) return
                setBlobUrl(URL.createObjectURL(blob))
            })
            .catch(() => {})
        return () => { revoked = true; if (blobUrl) URL.revokeObjectURL(blobUrl) }
    }, [config, docPath])
    if (!blobUrl) return <div className="h-48 bg-muted/10 rounded-xl animate-pulse" />
    return <img src={blobUrl} alt={alt} className="rounded-xl border border-border shadow-lg max-w-full" {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
}

export const DocsDashboard: React.FC<DocsDashboardProps> = ({ config, theme }) => {
    const [docs, setDocs] = useState<DocItem[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [content, setContent] = useState<string>('')
    const [contentLoading, setContentLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['plans', 'specs']))
    const [toc, setToc] = useState<{ id: string, text: string, level: number }[]>([])
    
    const scrollRef = useRef<HTMLDivElement | null>(null)

    const loadDocs = async () => {
        if (!config) return
        setLoading(true)
        try {
            const data = await fetchDocs(config)
            setDocs(data)
            
            if (!selectedPath && data.length > 0) {
                const first = findFirstDoc(data)
                if (first) {
                    handleSelectDoc(first.path)
                }
            }
        } catch (err) {
            console.error('Failed to load documentation tree:', err)
        } finally {
            setLoading(false)
        }
    }

    const findFirstDoc = (items: DocItem[]): DocItem | null => {
        // Prefer index.md as the landing page
        const indexDoc = items.find(i => i.name === 'index.md')
        if (indexDoc) return indexDoc
        for (const item of items) {
            if (!item.is_folder) return item
            if (item.children) {
                const child = findFirstDoc(item.children)
                if (child) return child
            }
        }
        return null
    }

    useEffect(() => {
        loadDocs()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config])

    const handleSelectDoc = async (path: string) => {
        if (!config) return
        setSelectedPath(path)
        setContentLoading(true)
        try {
            const text = await fetchDocContent(config, path)
            setContent(text)
            generateToc(text)
            // Scroll to top
            scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        } catch (_err) {
            setContent('# Error\nFailed to load document content.')
        } finally {
            setContentLoading(false)
        }
    }

    // Stable refs for the memoized markdown components
    const handleSelectDocRef = useRef(handleSelectDoc)
    handleSelectDocRef.current = handleSelectDoc
    const selectedPathRef = useRef(selectedPath)
    selectedPathRef.current = selectedPath
    const configRef = useRef(config)
    configRef.current = config

    /* eslint-disable @typescript-eslint/no-explicit-any -- react-markdown component override props use untyped AST nodes */
    const markdownComponents = useMemo(() => ({
        img({src, alt, ...props}: any) {
            if (src && !src.startsWith('http') && !src.startsWith('data:')) {
                const currentDir = selectedPathRef.current?.split('/').slice(0, -1).join('/') || ''
                let resolvedPath = src
                if (!resolvedPath.startsWith('/') && currentDir) {
                    resolvedPath = `${currentDir}/${resolvedPath}`
                }
                const parts = resolvedPath.split('/').filter(Boolean)
                const normalized: string[] = []
                for (const p of parts) {
                    if (p === '..') normalized.pop()
                    else if (p !== '.') normalized.push(p)
                }
                resolvedPath = normalized.join('/')
                return <AuthImage docPath={resolvedPath} alt={alt || ''} config={configRef.current} {...props} />
            }
            return <img src={src} alt={alt || ''} className="rounded-xl max-w-full" {...props} />
        },
        a({href, children, ...props}: any) {
            if (href && (href.endsWith('.md') || href.includes('.md#'))) {
                const currentDir = selectedPathRef.current?.split('/').slice(0, -1).join('/') || ''
                let resolvedPath = href.split('#')[0]
                if (!resolvedPath.startsWith('/') && currentDir) {
                    resolvedPath = `${currentDir}/${resolvedPath}`
                }
                const parts = resolvedPath.split('/').filter(Boolean)
                const normalized: string[] = []
                for (const p of parts) {
                    if (p === '..') normalized.pop()
                    else if (p !== '.') normalized.push(p)
                }
                resolvedPath = normalized.join('/')
                return (
                    <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); handleSelectDocRef.current(resolvedPath) }}
                        className="text-primary border-b border-primary/30 hover:border-primary transition-colors cursor-pointer"
                        {...props}
                    >
                        {children}
                    </a>
                )
            }
            return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
        },
        pre({node, children, ...preProps}: any) {
            const codeChild = node?.children?.[0]
            if (codeChild?.type === 'element' && codeChild.tagName === 'code') {
                const cls = codeChild.properties?.className
                const langStr = Array.isArray(cls) ? cls.join(' ') : String(cls || '')
                if (langStr.includes('language-mermaid')) {
                    const text = codeChild.children
                        ?.map((c: any) => c.type === 'text' ? c.value : '')
                        .join('') || ''
                    return <DiagramErrorBoundary chart={text}><MermaidDiagram chart={text} theme={theme} /></DiagramErrorBoundary>
                }
            }
            return <pre {...preProps}>{children}</pre>
        },
        code({node, className, children, ...props}: any) {
            const match = /language-([a-zA-Z0-9-]+)/.exec(className || '')
            const isInline = node?.tagName === 'code' && !match
            if (!isInline && match) {
                if (match[1] === 'diagram-architecture') {
                    return <D3ArchitectureGraph data={String(children)} />
                }
                return (
                    <div className="my-10 rounded-3xl overflow-hidden border border-border shadow-2xl bg-card">
                        <div className="bg-muted/30 px-6 py-3 flex items-center justify-between border-b border-border">
                            <div className="flex items-center gap-3">
                                <div className="flex gap-1.5">
                                    <div className="h-2.5 w-2.5 rounded-full bg-destructive/20 border border-destructive/10" />
                                    <div className="h-2.5 w-2.5 rounded-full bg-amber-500/20 border border-amber-500/10" />
                                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/10" />
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">{match[1]}</span>
                            </div>
                            <div className="h-5 w-5 rounded-md bg-muted/20 flex items-center justify-center border border-border">
                                <CodeIcon size={12} className="text-muted-foreground/40" />
                            </div>
                        </div>
                        <SyntaxHighlighter
                            style={oneDark}
                            language={match[1]}
                            PreTag="div"
                            customStyle={{ margin: 0, padding: '2rem', fontSize: '14px', background: 'transparent', lineHeight: '1.6' }}
                        >
                            {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                    </div>
                )
            }
            return (
                <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-md font-mono text-[0.9em]" {...props}>
                    {children}
                </code>
            )
        }
    }), [theme])
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const generateToc = (markdown: string) => {
        const lines = markdown.split('\n')
        const headings: { id: string, text: string, level: number }[] = []
        lines.forEach(line => {
            const match = line.match(/^(#{1,3})\s+(.+)$/)
            if (match) {
                const level = match[1].length
                const text = match[2].trim()
                const id = text.toLowerCase()
                    .replace(/[^\w\s-]/g, '')
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                headings.push({ id, text, level })
            }
        })
        setToc(headings)
    }

    const toggleFolder = (path: string) => {
        const next = new Set(expandedFolders)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        setExpandedFolders(next)
    }

    const scrollToHeading = (id: string) => {
        const element = document.getElementById(id)
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
    }

    const filterTree = (items: DocItem[], query: string): DocItem[] => {
        if (!query) return items
        const lowerQuery = query.toLowerCase()
        return items.reduce<DocItem[]>((acc, item) => {
            if (item.is_folder) {
                const filteredChildren = item.children ? filterTree(item.children, query) : []
                if (filteredChildren.length > 0) {
                    acc.push({ ...item, children: filteredChildren })
                }
            } else if (item.name.toLowerCase().includes(lowerQuery)) {
                acc.push(item)
            }
            return acc
        }, [])
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const filteredDocs = useMemo(() => filterTree(docs, searchQuery), [docs, searchQuery])

    // Section ordering and numbering
    const sectionOrder: Record<string, number> = {
        'index.md': 0,
        'architecture': 1,
        'api': 2,
        'backend': 3,
        'frontend': 4,
        'guides': 5,
        'operations': 6,
        'enums.md': 7,
    }
    const subSectionOrder: Record<string, Record<string, number>> = {
        'architecture': { 'overview.md': 0, 'backend.md': 1, 'desktop.md': 2, 'tui.md': 3, 'data-flow.md': 4 },
        'api': { 'reference.md': 0, 'schemas.md': 1, 'sse-events.md': 2 },
        'backend': { 'orchestrator.md': 0, 'agents.md': 1, 'tracker.md': 2, 'workspace.md': 3, 'database.md': 4, 'config.md': 5, 'mcp.md': 6, 'tools.md': 7, 'telemetry.md': 8 },
        'frontend': { 'components.md': 0, 'views.md': 1, 'client.md': 2, 'state-management.md': 3, 'electron.md': 4 },
        'guides': { 'getting-started.md': 0, 'configuration.md': 1, 'development.md': 2 },
        'operations': { 'deployment.md': 0, 'docker.md': 1, 'ci-cd.md': 2 },
    }

    const getDisplayName = (item: DocItem): string => {
        if (item.name === 'index.md') return 'Orchestra Documentation'
        return item.name.replace('.md', '').replace(/[-_]/g, ' ')
    }

    const getSectionNumber = (item: DocItem): string => {
        const parentDir = item.path.includes('/') ? item.path.split('/')[0] : ''
        if (item.is_folder) {
            const num = sectionOrder[item.name]
            return num !== undefined && num > 0 ? `${num}` : ''
        }
        if (!parentDir) {
            // Root-level file
            const num = sectionOrder[item.name]
            return num !== undefined ? (num === 0 ? '' : `${num}`) : ''
        }
        // File inside a folder
        const parentNum = sectionOrder[parentDir]
        const subOrder = subSectionOrder[parentDir]
        const subNum = subOrder?.[item.name]
        if (parentNum !== undefined && subNum !== undefined) {
            return `${parentNum}.${subNum + 1}`
        }
        return ''
    }

    const sortItems = (items: DocItem[], parentDir?: string): DocItem[] => {
        return [...items].sort((a, b) => {
            // Folders before files, except index.md always first
            if (a.name === 'index.md') return -1
            if (b.name === 'index.md') return 1
            if (a.is_folder && !b.is_folder) return -1
            if (!a.is_folder && b.is_folder) return 1

            const orderMap = parentDir ? subSectionOrder[parentDir] : sectionOrder
            const aOrder = orderMap?.[a.name] ?? 999
            const bOrder = orderMap?.[b.name] ?? 999
            if (aOrder !== bOrder) return aOrder - bOrder
            return a.name.localeCompare(b.name)
        })
    }

    const renderTree = (items: DocItem[], level = 0, parentDir?: string) => {
        return sortItems(items, parentDir).map(item => {
            if (item.is_folder) {
                const isExpanded = expandedFolders.has(item.path)
                return (
                    <div key={item.path}>
                        <button
                            onClick={() => toggleFolder(item.path)}
                            className="group w-full flex items-center gap-2.5 h-9 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.03] transition-colors text-left"
                            style={{ paddingLeft: `${level * 12 + 10}px`, paddingRight: '10px' }}
                        >
                            {isExpanded
                                ? <FolderOpen size={15} strokeWidth={1.75} className="shrink-0 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                                : <Folder size={15} strokeWidth={1.75} className="shrink-0 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                            }
                            <span className="flex-1 truncate text-[12.5px] font-medium tracking-tight capitalize">{item.name}</span>
                            <ChevronRight size={12} className={`shrink-0 transition-transform duration-150 text-muted-foreground/40 ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                        {isExpanded && item.children && (
                            <div className="mt-0.5">{renderTree(item.children, level + 1, item.name)}</div>
                        )}
                    </div>
                )
            }

            const isActive = selectedPath === item.path
            return (
                <button
                    key={item.path}
                    onClick={() => handleSelectDoc(item.path)}
                    className={`group relative w-full flex items-center gap-2.5 h-9 rounded-md transition-all duration-150 text-left ${
                        isActive
                            ? 'bg-foreground/[0.06] text-foreground'
                            : 'text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.03]'
                    }`}
                    style={{ paddingLeft: `${level * 12 + 10}px`, paddingRight: '10px' }}
                >
                    {isActive && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-primary" />}
                    <FileText
                        size={15}
                        strokeWidth={isActive ? 2.25 : 1.75}
                        className={`shrink-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground/60 group-hover:text-foreground'}`}
                    />
                    <span className="flex-1 truncate text-[12.5px] font-medium tracking-tight capitalize">
                        {getDisplayName(item)}
                    </span>
                </button>
            )
        })
    }

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            <DiagramFullscreenOverlay />
            <div className="flex-1 flex overflow-hidden min-h-0 relative">
                {/* Left Sidebar (Navigation) */}
                <div className="w-64 border-r border-border/40 flex flex-col min-h-0">
                    <div className="px-4 pt-7 pb-3 flex items-center justify-between">
                        <h2 className="text-[15px] font-black tracking-tight leading-none">Documentation</h2>
                        {config && (
                            <AppTooltip content="Open interactive API docs">
                                <button
                                    onClick={() => {
                                        const url = `${config.baseUrl}/api/docs`
                                        const bridge = (window as { orchestraDesktop?: { openExternal?: (u: string) => void } }).orchestraDesktop
                                        if (bridge?.openExternal) bridge.openExternal(url)
                                        else window.open(url, '_blank', 'noopener,noreferrer')
                                    }}
                                    className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.03] transition-colors"
                                >
                                    <ExternalLink size={13} />
                                </button>
                            </AppTooltip>
                        )}
                    </div>
                    <div className="px-3 pb-3 flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                            <input
                                type="text"
                                placeholder="Search docs..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full h-8 pl-8 pr-3 bg-muted/30 rounded-md text-[12px] font-medium placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all"
                            />
                        </div>
                        <AppTooltip content="Refresh">
                            <button
                                onClick={loadDocs}
                                disabled={loading}
                                className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.03] transition-colors disabled:opacity-50"
                            >
                                <RefreshCcw size={13} className={loading ? 'animate-refresh-spin' : ''} />
                            </button>
                        </AppTooltip>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                        <div className="px-3 pb-6 flex flex-col gap-0.5">
                            {loading && docs.length === 0 ? (
                                [1, 2, 3, 4, 5, 6, 7].map(i => <Skeleton key={i} className="h-9 w-full rounded-md bg-muted/20" />)
                            ) : filteredDocs.length === 0 ? (
                                <div className="px-3 py-8 text-center text-[11px] text-muted-foreground/70 italic">
                                    {searchQuery
                                        ? <>No documents match <span className="font-mono not-italic">"{searchQuery}"</span></>
                                        : 'No documentation available.'}
                                </div>
                            ) : renderTree(filteredDocs)}
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col min-h-0 relative">
                    <div
                        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
                        ref={scrollRef}
                    >
                        <div className="px-10 pt-6 pb-12 max-w-4xl mx-auto flex flex-col text-left">
                            {contentLoading ? (
                                <div className="space-y-8 animate-pulse">
                                    <Skeleton className="h-12 w-3/4 rounded-lg bg-muted/20" />
                                    <div className="space-y-3">
                                        <Skeleton className="h-4 w-full bg-muted/20" />
                                        <Skeleton className="h-4 w-full bg-muted/20" />
                                        <Skeleton className="h-4 w-5/6 bg-muted/20" />
                                    </div>
                                    <Skeleton className="h-64 w-full rounded-lg bg-muted/20" />
                                </div>
                            ) : !selectedPath ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/40">
                                    <FileText size={32} className="mb-4" strokeWidth={1.25} />
                                    <p className="text-sm font-medium">Select a document</p>
                                </div>
                            ) : (
                                <div className="animate-in fade-in duration-300">
                                    <article className="prose prose-invert max-w-none prose-wiki prose-headings:tracking-tight prose-h1:mt-0 prose-h1:mb-6">
                                        <MarkdownRenderer
                                            content={content}
                                            allowHtml
                                            components={markdownComponents}
                                        />
                                    </article>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Back to top */}
                    <button
                        onClick={() => {
                            scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                        className="absolute bottom-6 right-6 h-9 w-9 rounded-md bg-muted/40 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 grid place-items-center transition-colors"
                        title="Back to top"
                    >
                        <ArrowUp size={15} />
                    </button>
                </div>

                {/* Right Sidebar (Table of Contents) */}
                <div className="w-64 border-l border-border/40 flex flex-col min-h-0">
                    <div className="px-5 pt-7 pb-3">
                        <h2 className="text-[15px] font-black tracking-tight leading-none">On this page</h2>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                        <div className="px-3 pb-6">
                            {toc.length === 0 ? (
                                <p className="px-3 py-4 text-[11px] text-muted-foreground/50">No headings</p>
                            ) : (
                                <nav className="flex flex-col gap-0.5">
                                    {toc.map((heading, i) => (
                                        <button
                                            key={`${heading.id}-${i}`}
                                            onClick={() => scrollToHeading(heading.id)}
                                            className={`w-full text-left rounded-md px-3 py-1.5 text-[12px] tracking-tight transition-colors text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.03] ${
                                                heading.level === 1 ? 'font-semibold' :
                                                heading.level === 2 ? 'font-medium pl-5' :
                                                'pl-8'
                                            }`}
                                        >
                                            {heading.text}
                                        </button>
                                    ))}
                                </nav>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
