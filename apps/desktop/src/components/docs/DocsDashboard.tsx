import React, { useState, useEffect, useMemo, useRef } from 'react'
import { 
    BookOpen, FileText, ChevronRight, Search, 
    Terminal, Info, ShieldCheck, ListTree, 
    Sparkles, RefreshCcw, Folder, FolderOpen,
    CheckCircle2, Activity, Clock, Hash,
    ArrowUp, Menu, LayoutList, ScrollText, Code as CodeIcon
} from 'lucide-react'
import type { DocItem, BackendConfig } from '@/lib/orchestra-types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchDocs, fetchDocContent } from '@/lib/orchestra-client'
import { OverlayScrollbarsComponent, type OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { D3ArchitectureGraph } from '../diagrams/D3ArchitectureGraph'
import { AppTooltip } from '../ui/tooltip-wrapper'

interface DocsDashboardProps {
    config: BackendConfig | null
}

export const DocsDashboard: React.FC<DocsDashboardProps> = ({ config }) => {
    const [docs, setDocs] = useState<DocItem[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [content, setContent] = useState<string>('')
    const [contentLoading, setContentLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['plans', 'specs']))
    const [toc, setToc] = useState<{ id: string, text: string, level: number }[]>([])
    
    const scrollRef = useRef<OverlayScrollbarsComponentRef<'div'> | null>(null)

    const osOptions = useMemo(() => ({
        scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
        overflow: { x: 'hidden' as const, y: 'scroll' as const }
    }), [])

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
            if (scrollRef.current) {
                const instance = scrollRef.current.osInstance()
                if (instance) {
                    const { viewport } = instance.elements()
                    viewport.scrollTo({ top: 0, behavior: 'smooth' })
                }
            }
        } catch (err) {
            setContent('# Error\nFailed to load document content.')
        } finally {
            setContentLoading(false)
        }
    }

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

    const renderTree = (items: DocItem[], level = 0) => {
        return items.sort((a, b) => {
            if (a.is_folder && !b.is_folder) return -1
            if (!a.is_folder && b.is_folder) return 1
            return a.name.localeCompare(b.name)
        }).map(item => {
            if (item.is_folder) {
                const isExpanded = expandedFolders.has(item.path)
                return (
                    <div key={item.path} className="space-y-0.5">
                        <button
                            onClick={() => toggleFolder(item.path)}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-muted-foreground/50 hover:bg-muted transition-all text-left group"
                            style={{ paddingLeft: `${level * 12 + 8}px` }}
                        >
                            <div className="flex items-center gap-2 flex-1 text-left">
                                {isExpanded ? <FolderOpen size={12} className="text-primary/60" /> : <Folder size={12} className="text-muted-foreground/30" />}
                                <span className="text-[10px] font-black uppercase tracking-widest group-hover:text-muted-foreground transition-colors">{item.name}</span>
                            </div>
                            <ChevronRight size={10} className={`transition-transform duration-200 opacity-20 ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                        {isExpanded && item.children && renderTree(item.children, level + 1)}
                    </div>
                )
            }

            const isActive = selectedPath === item.path
            return (
                <button
                    key={item.path}
                    onClick={() => handleSelectDoc(item.path)}
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-all text-left relative group ${
                        isActive 
                            ? 'bg-primary/10 text-primary border border-primary/20 shadow-sm font-bold' 
                            : 'text-muted-foreground/60 hover:bg-muted border border-transparent hover:text-foreground'
                    }`}
                    style={{ paddingLeft: `${level * 12 + 8}px` }}
                >
                    {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-3 w-0.5 bg-primary rounded-r-full" />}
                    <FileText size={12} className={isActive ? 'text-primary' : 'text-muted-foreground/30 group-hover:text-muted-foreground/60'} />
                    <span className={`flex-1 text-[13px] tracking-tight truncate`}>
                        {item.name.replace('.md', '').replace(/_/g, ' ')}
                    </span>
                </button>
            )
        })
    }

    return (
        <div className="flex flex-col h-full bg-background/20 overflow-hidden">
            {/* Wiki Header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-border bg-background/40 shadow-sm transition-colors duration-300">
                <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/5">
                        <BookOpen className="text-primary h-5 w-5" />
                    </div>
                    <div className="text-left">
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-black tracking-tight text-foreground/90 uppercase">Knowledge Base</h1>
                            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[8px] font-black uppercase tracking-widest h-4 px-1.5">v1.0.8</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium uppercase tracking-widest opacity-60">
                            <span>{selectedPath?.split('/').join(' / ') || 'Home'}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                        <input 
                            type="text"
                            placeholder="Search wiki..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-9 pl-9 pr-4 bg-muted/30 border-border rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 w-64 transition-all"
                        />
                    </div>
                    <AppTooltip content="Force documentation scan">
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={loadDocs} 
                            disabled={loading}
                            className="h-9 w-9 p-0 border border-border hover:bg-muted"
                        >
                            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
                        </Button>
                    </AppTooltip>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden min-h-0 relative bg-transparent">
                {/* Left Sidebar (Navigation) */}
                <div className="w-72 border-r border-border bg-muted/10 flex flex-col min-h-0 z-20">
                    <div className="p-4 border-b border-border shrink-0 bg-muted/5">
                        <div className="flex items-center gap-2 px-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">
                            <LayoutList size={12} />
                            Navigation
                        </div>
                    </div>
                    <OverlayScrollbarsComponent
                        element="div"
                        options={osOptions}
                        className="flex-1"
                    >
                        <div className="p-3 space-y-1">
                            {loading && docs.length === 0 ? (
                                [1, 2, 3, 4, 5, 6, 7].map(i => <Skeleton key={i} className="h-8 w-full mb-1 rounded-lg bg-muted/30" />)
                            ) : renderTree(docs)}
                        </div>
                    </OverlayScrollbarsComponent>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col bg-background/5 min-h-0 relative">
                    <OverlayScrollbarsComponent
                        element="div"
                        options={osOptions}
                        className="flex-1"
                        ref={scrollRef}
                    >
                        <div className="px-16 py-16 max-w-5xl mx-auto min-h-full flex flex-col text-left">
                            {contentLoading ? (
                                <div className="space-y-8 animate-pulse">
                                    <Skeleton className="h-16 w-3/4 rounded-2xl bg-muted/30" />
                                    <div className="space-y-3">
                                        <Skeleton className="h-4 w-full bg-muted/30" />
                                        <Skeleton className="h-4 w-full bg-muted/30" />
                                        <Skeleton className="h-4 w-5/6 bg-muted/30" />
                                    </div>
                                    <Skeleton className="h-96 w-full rounded-3xl bg-muted/30" />
                                </div>
                            ) : !selectedPath ? (
                                <div className="flex-1 flex flex-col items-center justify-center opacity-20 grayscale">
                                    <Terminal size={80} className="mb-6 text-primary" strokeWidth={1} />
                                    <p className="text-lg font-black uppercase tracking-[0.4em]">Initialize Wiki Stream</p>
                                </div>
                            ) : (
                                <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000 ease-out">
                                    {/* Wiki Breadcrumbs */}
                                    <div className="mb-10 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-primary/40">
                                        <BookOpen size={12} />
                                        <span>Wiki</span>
                                        <ChevronRight size={10} />
                                        <span className="text-muted-foreground/60">{selectedPath.replace('.md', '').split('/').join(' / ')}</span>
                                    </div>

                                    <article className="prose prose-invert max-w-none prose-wiki">
                                        <ReactMarkdown 
                                            remarkPlugins={[remarkGfm]}
                                            rehypePlugins={[rehypeSlug]}
                                            components={{
                                                code({node, className, children, ...props}) {
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
                                            }}
                                        >
                                            {content}
                                        </ReactMarkdown>
                                    </article>
                                    
                                    {/* Wiki Footer */}
                                    <div className="mt-24 pt-10 border-t border-border flex flex-wrap items-center justify-between gap-6 opacity-30">
                                        <div className="flex items-center gap-6">
                                            <div className="flex items-center gap-2">
                                                <ShieldCheck size={14} className="text-primary" />
                                                <span className="text-[10px] font-black uppercase tracking-widest">Verified Specs</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Clock size={14} />
                                                <span className="text-[10px] font-black uppercase tracking-widest">Auto-Synced</span>
                                            </div>
                                        </div>
                                        <div className="text-[10px] font-mono flex items-center gap-2 bg-muted/30 px-3 py-1 rounded-full border border-border">
                                            <Hash size={12} className="text-primary" />
                                            {selectedPath}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </OverlayScrollbarsComponent>

                    {/* Back to top fab */}
                    <button 
                        onClick={() => {
                            if (scrollRef.current) {
                                const instance = scrollRef.current.osInstance()
                                if (instance) {
                                    const { viewport } = instance.elements()
                                    viewport.scrollTo({ top: 0, behavior: 'smooth' })
                                }
                            }
                        }}
                        className="absolute bottom-8 right-8 h-10 w-10 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shadow-2xl backdrop-blur-xl hover:bg-primary/20 transition-all z-50 group"
                    >
                        <ArrowUp size={18} className="group-hover:-translate-y-0.5 transition-transform" />
                    </button>
                </div>

                {/* Right Sidebar (Table of Contents) */}
                <div className="w-80 border-l border-border bg-muted/10 flex flex-col min-h-0 z-20">
                    <div className="p-6 border-b border-border shrink-0 bg-muted/5">
                        <div className="flex items-center gap-2 mb-2">
                            <ScrollText size={14} className="text-primary" />
                            <h2 className="text-xs font-black uppercase tracking-widest text-foreground/80">On this page</h2>
                        </div>
                    </div>
                    
                    <OverlayScrollbarsComponent
                        element="div"
                        options={osOptions}
                        className="flex-1"
                    >
                        <div className="p-6 text-left">
                            {toc.length === 0 ? (
                                <div className="py-10 text-center opacity-20 grayscale">
                                    <Activity size={32} className="mx-auto mb-2" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-center">No Headings</p>
                                </div>
                            ) : (
                                <nav className="space-y-1">
                                    {toc.map((heading, i) => (
                                        <button
                                            key={`${heading.id}-${i}`}
                                            onClick={() => scrollToHeading(heading.id)}
                                            className={`w-full text-left rounded-lg px-3 py-2 text-xs transition-all hover:bg-muted/50 ${
                                                heading.level === 1 ? 'font-black uppercase tracking-widest text-foreground/90' : 
                                                heading.level === 2 ? 'font-bold text-muted-foreground/80 pl-6' : 
                                                'font-medium text-muted-foreground/60 pl-10'
                                            }`}
                                        >
                                            {heading.text}
                                        </button>
                                    ))}
                                </nav>
                            )}

                            <div className="mt-12 space-y-4 pt-8 border-t border-border">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-primary/60 px-3 italic">System Wiki</h3>
                                <div className="grid gap-2">
                                    <div className="p-4 rounded-2xl bg-muted/30 border border-border space-y-2 group hover:bg-muted/50 transition-all">
                                        <div className="flex items-center gap-2 font-black text-[10px] uppercase tracking-widest text-foreground/60">
                                            <Sparkles size={12} className="text-amber-500" />
                                            Contribution
                                        </div>
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            Documentation is extracted from the <code className="text-primary/80">/docs</code> root. Submit a PR to add new guides.
                                        </p>
                                    </div>
                                    
                                    <div className="p-4 rounded-2xl bg-muted/30 border border-border space-y-2 group hover:bg-muted/50 transition-all">
                                        <div className="flex items-center gap-2 font-black text-[10px] uppercase tracking-widest text-foreground/60">
                                            <ShieldCheck size={12} className="text-primary" />
                                            Standards
                                        </div>
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            Follow the <code className="text-amber-500/80">ARCHITECTURE.md</code> patterns for all new system integrations.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </OverlayScrollbarsComponent>
                </div>
            </div>
        </div>
    )
}
