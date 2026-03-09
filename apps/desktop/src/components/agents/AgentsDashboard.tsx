import React, { useState, useEffect, useMemo } from 'react'
import {
    Cpu, Save, RefreshCcw, Info, Terminal,
    ShieldCheck, Zap, Activity, Code as CodeIcon,
    ChevronRight, FileText, Layout,
    CheckCircle2, AlertCircle, Wrench, ListTree, Sparkles,
    Settings, Globe, Layers, Folder, Plus, Loader2, Trash2
} from 'lucide-react'
import type { AgentConfig, BackendConfig, Project, SnapshotPayload } from '@/lib/orchestra-types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AppTooltip } from '../ui/tooltip-wrapper'
import { fetchAgentConfigs, updateAgentConfigByPath, fetchProjects, createAgentResource, fetchMCPTools, fetchMCPServers, createMCPServer, deleteMCPServer } from '@/lib/orchestra-client'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog'
interface AgentsDashboardProps {
    config: BackendConfig | null
    snapshot: SnapshotPayload | null
}

export const AgentsDashboard: React.FC<AgentsDashboardProps> = ({ config, snapshot }) => {
    const [configs, setConfigs] = useState<AgentConfig[]>([])
    const [projects, setProjects] = useState<Project[]>([])
    const [mcpTools, setMcpTools] = useState<any[]>([])
    const [mcpServers, setMcpServers] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState<string | null>(null)
    const [selectedConfig, setSelectedConfig] = useState<AgentConfig | null>(null)
    const [editedContent, setEditedContent] = useState('')
    const [error, setError] = useState('')
    const [activeView, setActiveTab] = useState<'editor' | 'preview'>('editor')

    // Creation State
    const [createDialogOpen, setCreateResourceDialogOpen] = useState(false)
    const [mcpDialogOpen, setMcpDialogOpen] = useState(false)
    const [newResourceProvider, setNewResourceProvider] = useState<string>('Orchestra')
    const [newResourceType, setNewResourceType] = useState<'skill' | 'core'>('skill')
    const [newResourceName, setNewResourceName] = useState('')
    const [newMcpName, setNewMcpName] = useState('')
    const [newMcpCommand, setNewMcpCommand] = useState('')
    const [creating, setCreating] = useState(false)

    // Scope Management
    const [scope, setScope] = useState<'global' | 'project'>('global')
    const [selectedProjectID, setSelectedProjectID] = useState<string>('')

    const osOptions = useMemo(() => ({
        scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
        overflow: { x: 'hidden' as const, y: 'scroll' as const }
    }), [])

    const loadData = async () => {
        if (!config) return
        setLoading(true)
        try {
            const [configsData, projectsData, mcpToolsData, mcpServersData] = await Promise.all([
                fetchAgentConfigs(config, scope === 'project' ? selectedProjectID : undefined),
                fetchProjects(config),
                fetchMCPTools(config),
                fetchMCPServers(config)
            ])
            setConfigs(configsData)
            setProjects(projectsData)
            setMcpTools(mcpToolsData)
            setMcpServers(mcpServersData)

            if (configsData.length > 0) {
                const initial = selectedConfig
                    ? configsData.find(c => c.path === selectedConfig.path) || configsData[0]
                    : configsData[0]
                setSelectedConfig(initial)
                setEditedContent(initial.content)
            } else {
                setSelectedConfig(null)
                setEditedContent('')
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load configurations')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadData()
    }, [config, scope, selectedProjectID])

    const handleSelectConfig = (conf: AgentConfig) => {
        setSelectedConfig(conf)
        setEditedContent(conf.content)
        setError('')
        setActiveTab('editor')
    }

    const handleSave = async () => {
        if (!config || !selectedConfig) return

        // Validate JSON if it's a core config
        if (selectedConfig.category === 'core' && (selectedConfig.name.endsWith('.json') || selectedConfig.name.startsWith('.'))) {
            try {
                if (editedContent.trim()) {
                    JSON.parse(editedContent)
                }
            } catch (e) {
                setError('Invalid JSON: Please check your syntax before saving.')
                return
            }
        }

        setSaving(selectedConfig.path)
        try {
            await updateAgentConfigByPath(config, selectedConfig.path, editedContent)
            setConfigs(prev => prev.map(c =>
                c.path === selectedConfig.path ? { ...c, content: editedContent } : c
            ))
            setError('')
        } catch (err: any) {
            setError(err.message || 'Failed to save configuration')
        } finally {
            setSaving(null)
        }
    }

    const handleCreateResource = async () => {
        if (!config || !newResourceName) return
        setCreating(true)
        try {
            const { path } = await createAgentResource(config, {
                provider: newResourceProvider,
                type: newResourceType,
                name: newResourceName,
                scope: scope,
                project_id: scope === 'project' ? selectedProjectID : undefined
            })
            await loadData()
            setCreateResourceDialogOpen(false)
            setNewResourceName('')
            setError('')
        } catch (err: any) {
            setError(err.message || 'Failed to create resource')
        } finally {
            setCreating(false)
        }
    }
    const handleDeleteMCPServer = async (id: string) => {
        if (!config || !window.confirm('Are you sure you want to remove this MCP server?')) return
        try {
            await deleteMCPServer(config, id)
            await loadData()
        } catch (err: any) {
            setError(err.message || 'Failed to delete MCP server')
        }
    }

    const handleCreateMCPServer = async () => {
        if (!config || !newMcpName || !newMcpCommand) return
        setCreating(true)
        try {
            await createMCPServer(config, newMcpName, newMcpCommand)
            await loadData()
            setMcpDialogOpen(false)
            setNewMcpName('')
            setNewMcpCommand('')
        } catch (err: any) {
            setError(err.message || 'Failed to create MCP server')
        } finally {
            setCreating(false)
        }
    }

    const handleFormatJson = () => {
        try {
            const parsed = JSON.parse(editedContent)
            setEditedContent(JSON.stringify(parsed, null, 2))
            setError('')
        } catch (e) {
            setError('Cannot format: Invalid JSON syntax.')
        }
    }

    const getIcon = (conf: AgentConfig) => {
        if (conf.category === 'skill') return <Wrench size={14} className="text-amber-500/70" />
        const lower = conf.name.toLowerCase()
        if (lower.includes('workspace')) return <Layout size={14} className="text-zinc-100" />
        if (lower.includes('claude')) return <div className="h-2 w-2 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]" />
        if (lower.includes('gemini')) return <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
        if (lower.includes('codex')) return <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
        if (lower.includes('codex')) return <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.4)]" />
        if (lower.includes('open')) return <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
        return <FileText size={14} className="text-zinc-500" />
    }

    const isDirty = selectedConfig && selectedConfig.content !== editedContent

    const coreConfigs = configs.filter(c => c.category === 'core')
    const skillConfigs = configs.filter(c => c.category === 'skill')

    return (
        <div className="flex flex-col h-full bg-background/20 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 bg-background/40 backdrop-blur-xl shrink-0">
                <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/5">
                        <Cpu className="text-primary h-7 w-7" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                            Agent Control Plane
                            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[9px] font-black uppercase tracking-widest h-5 px-2">
                                {scope === 'global' ? 'Global' : 'Project'}
                            </Badge>
                        </h1>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-[0.2em] opacity-60">Global implementation dotfiles & specialized skills</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {/* Scope Switcher Group */}
                    <div className="flex items-center gap-2 pr-4 border-r border-white/10">
                        <div className="flex items-center gap-1 bg-black/40 rounded-xl p-1 border border-white/5">
                            <button
                                onClick={() => setScope('global')}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${scope === 'global' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:bg-white/5'}`}
                            >
                                <Globe size={14} />
                                Global
                            </button>
                            <button
                                onClick={() => setScope('project')}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${scope === 'project' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:bg-white/5'}`}
                            >
                                <Layers size={14} />
                                Project
                            </button>
                        </div>

                        {scope === 'project' && (
                            <select
                                value={selectedProjectID}
                                onChange={(e) => setSelectedProjectID(e.target.value)}
                                className="h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-xs font-bold text-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/20 min-w-[180px] appearance-none cursor-pointer hover:border-white/20 transition-colors"
                            >
                                <option value="">Select Project...</option>
                                {projects.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* Actions Group */}
                    <div className="flex items-center gap-3">
                        {selectedConfig?.category === 'core' && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleFormatJson}
                                className="h-10 px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-all"
                            >
                                <Sparkles size={14} className="mr-2" />
                                Format
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={loadData}
                            disabled={loading}
                            className="h-10 px-4 gap-2 text-[10px] font-black uppercase tracking-widest border-white/10 hover:bg-white/5"
                        >
                            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
                            Reload
                        </Button>
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleSave}
                            disabled={!isDirty || !!saving}
                            className="h-10 px-6 gap-2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            <span className="font-black uppercase tracking-widest text-[10px]">{saving ? 'Saving...' : 'Save Changes'}</span>
                        </Button>
                    </div>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden min-h-0">
                {/* File Sidebar */}
                <div className="w-72 border-r border-white/5 bg-black/20 flex flex-col min-h-0">
                    <OverlayScrollbarsComponent
                        element="div"
                        options={osOptions}
                        className="flex-1"
                    >
                        <div className="p-4 space-y-6">
                            {/* Core Configs */}
                            <div>
                                <div className="flex items-center justify-between px-2 pb-2">
                                    <div className="flex items-center gap-2">
                                        <Settings size={12} className="text-primary/50" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Core Configurations</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setNewResourceType('core')
                                            setCreateResourceDialogOpen(true)
                                        }}
                                        className="text-muted-foreground/40 hover:text-primary transition-colors"
                                    >
                                        <Plus size={12} />
                                    </button>
                                </div>
                                <div className="space-y-0.5">
                                    {loading && coreConfigs.length === 0 ? (
                                        [1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full mb-1 rounded-lg" />)
                                    ) : coreConfigs.length === 0 ? (
                                        <div className="px-3 py-4 text-[10px] text-muted-foreground/40 italic text-center uppercase tracking-widest">No local configs found</div>
                                    ) : coreConfigs.map(conf => (
                                        <button
                                            key={conf.path}
                                            onClick={() => handleSelectConfig(conf)}
                                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left group ${selectedConfig?.path === conf.path
                                                ? 'bg-primary/10 text-primary border border-primary/20 shadow-inner'
                                                : 'text-muted-foreground hover:bg-white/5 border border-transparent hover:text-foreground'
                                                }`}
                                        >
                                            {getIcon(conf)}
                                            <span className="flex-1 text-sm font-bold tracking-tight truncate">{conf.name}</span>
                                            {selectedConfig?.path === conf.path && <ChevronRight size={14} className="opacity-50" />}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Skills - Only show in global scope for now */}
                            {scope === 'global' && (
                                <div>
                                    <div className="flex items-center justify-between px-2 pb-2 pt-2 border-t border-white/5">
                                        <div className="flex items-center gap-2">
                                            <Zap size={12} className="text-amber-500/50" />
                                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Agent Skills</p>
                                        </div>
                                        <button
                                            onClick={() => {
                                                setNewResourceType('skill')
                                                setCreateResourceDialogOpen(true)
                                            }}
                                            className="text-muted-foreground/40 hover:text-amber-500 transition-colors"
                                        >
                                            <Plus size={12} />
                                        </button>
                                    </div>
                                    <div className="space-y-0.5">
                                        {loading && skillConfigs.length === 0 ? (
                                            [1, 2].map(i => <Skeleton key={i} className="h-9 w-full mb-1 rounded-lg" />)
                                        ) : skillConfigs.map(conf => (
                                            <button
                                                key={conf.path}
                                                onClick={() => handleSelectConfig(conf)}
                                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all text-left group ${selectedConfig?.path === conf.path
                                                    ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-inner'
                                                    : 'text-muted-foreground hover:bg-white/5 border border-transparent hover:text-foreground'
                                                    }`}
                                            >
                                                {getIcon(conf)}
                                                <span className="flex-1 text-[11px] font-bold tracking-tight capitalize truncate">{conf.name}</span>
                                                {selectedConfig?.path === conf.path && <ChevronRight size={12} className="opacity-50" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </OverlayScrollbarsComponent>
                </div>

                {/* Editor Area */}
                <div className="flex-1 flex flex-col bg-background/10 min-h-0">
                    {!selectedConfig ? (
                        <div className="flex-1 flex flex-col items-center justify-center opacity-20 grayscale">
                            <Terminal size={64} className="mb-4 text-primary" />
                            <p className="text-sm font-black uppercase tracking-[0.3em]">{loading ? 'Scanning Filesystem...' : 'No Configuration Selected'}</p>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0 relative animate-in fade-in slide-in-from-left-2 duration-500">
                            {/* Editor Toolbar */}
                            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-black/20 shrink-0">
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2 bg-black/40 rounded-lg p-1 border border-white/5">
                                        <button
                                            onClick={() => setActiveTab('editor')}
                                            className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'editor' ? 'bg-primary text-primary-foreground shadow-lg' : 'text-muted-foreground hover:text-foreground'}`}
                                        >
                                            Source
                                        </button>
                                        {selectedConfig.category === 'skill' && (
                                            <button
                                                onClick={() => setActiveTab('preview')}
                                                className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'preview' ? 'bg-primary text-primary-foreground shadow-lg' : 'text-muted-foreground hover:text-foreground'}`}
                                            >
                                                Preview
                                            </button>
                                        )}
                                    </div>
                                    <Badge variant="outline" className="bg-white/5 text-muted-foreground/70 border-white/10 font-mono text-[9px] h-6">
                                        {selectedConfig.path}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-4 text-[9px] font-black text-muted-foreground/30 uppercase tracking-[0.2em]">
                                    {selectedConfig.category === 'skill' ? <span>Markdown / YAML</span> : <span>JSON Object</span>}
                                    <span className="h-3 w-[1px] bg-white/10" />
                                    <span>UTF-8</span>
                                </div>
                            </div>

                            {/* Main View Area */}
                            <div className="flex-1 relative min-h-0">
                                {activeView === 'editor' ? (
                                    <textarea
                                        value={editedContent}
                                        onChange={(e) => setEditedContent(e.target.value)}
                                        className="w-full h-full bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground/80 focus:outline-none resize-none spellcheck-false selection:bg-primary/30"
                                        placeholder={`// Runtime configuration for ${selectedConfig.name}\n{ ... }`}
                                        spellCheck={false}
                                    />
                                ) : (
                                    <div className="h-full bg-muted/5">
                                        <OverlayScrollbarsComponent
                                            element="div"
                                            options={osOptions}
                                            className="h-full p-2"
                                        >
                                            <div className="max-w-3xl mx-auto prose prose-invert prose-sm">
                                                <SyntaxHighlighter
                                                    language="markdown"
                                                    style={oneDark}
                                                    customStyle={{ margin: 0, padding: '2rem', borderRadius: '1rem', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.2)' }}
                                                >
                                                    {editedContent}
                                                </SyntaxHighlighter>
                                            </div>
                                        </OverlayScrollbarsComponent>
                                    </div>
                                )}

                                {isDirty && (
                                    <div className="absolute top-6 right-8 flex items-center gap-2 animate-in fade-in duration-500">
                                        <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-amber-500/80">Unsynced Changes</span>
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-lg w-full bg-red-500/10 border border-red-500/20 backdrop-blur-2xl rounded-2xl p-4 flex gap-4 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 z-50">
                                    <div className="h-10 w-10 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0">
                                        <AlertCircle className="text-red-500" size={24} />
                                    </div>
                                    <div className="flex-1 space-y-1">
                                        <p className="text-xs font-black uppercase tracking-widest text-red-500">Validation Error</p>
                                        <p className="text-sm text-red-400 font-medium leading-relaxed">{error}</p>
                                    </div>
                                    <button onClick={() => setError('')} className="text-red-500/50 hover:text-red-500 transition-colors self-start pt-1">
                                        <CodeIcon size={16} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Info Side Panel */}
                <div className="w-52 border-l border-white/5 bg-black/10 flex flex-col min-h-0 overflow-hidden">
                    <div className="p-4 border-b border-white/5 shrink-0 bg-white/[0.02]">
                        <div className="flex items-center gap-2 mb-1.5">
                            <Info size={12} className="text-primary" />
                            <h2 className="text-[10px] font-black uppercase tracking-widest text-foreground/80">Context & Help</h2>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                            These configurations directly influence how your autonomous fleet behaves in the {scope} scope.
                        </p>
                    </div>

                    <OverlayScrollbarsComponent
                        element="div"
                        options={osOptions}
                        className="flex-1"
                    >
                        <div className="p-6 space-y-8">
                            <div className="space-y-3">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-primary/60">Documentation</h3>
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                                        <div className="flex items-center gap-2 font-bold text-xs">
                                            <ListTree size={14} className="text-muted-foreground" />
                                            Hierarchy
                                        </div>
                                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                                            Global defaults in <code className="text-primary/80">~/.config</code> or <code className="text-primary/80">~/.claude.json</code> are used unless project-specific overrides exist.
                                        </p>
                                    </div>

                                    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                                        <div className="flex items-center gap-2 font-bold text-xs">
                                            <Folder size={14} className="text-muted-foreground" />
                                            Project Overrides
                                        </div>
                                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                                            Selecting <strong>Project</strong> allows you to edit local <code className="text-amber-500/80">.claude/settings.json</code> or <code className="text-amber-500/80">opencode.json</code> files.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between px-1">
                                    <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-400/60">MCP Status</h3>
                                    <button
                                        onClick={() => setMcpDialogOpen(true)}
                                        className="h-4 w-4 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-400 hover:bg-blue-500/20 transition-all shadow-sm border border-blue-500/20"
                                    >
                                        <Plus size={10} strokeWidth={3} />
                                    </button>
                                </div>
                                <div className="space-y-1.5">
                                    {!snapshot?.mcp_servers || Object.keys(snapshot.mcp_servers).length === 0 ? (
                                        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[9px] text-muted-foreground italic">
                                            No active MCP servers.
                                        </div>
                                    ) : Object.entries(snapshot.mcp_servers).map(([name, cmd]) => {
                                        const serverTools = mcpTools.filter(t => t.name.startsWith(name + "_"))
                                        const dbRecord = mcpServers.find(s => s.name === name)
                                        return (
                                            <div key={name} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2 group hover:bg-white/[0.05] transition-all relative">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-bold text-foreground/80">{name}</span>
                                                    <div className="flex items-center gap-2">
                                                        {dbRecord && (
                                                            <button
                                                                onClick={() => handleDeleteMCPServer(dbRecord.id)}
                                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-red-500/50 hover:text-red-500"
                                                            >
                                                                <Trash2 size={10} />
                                                            </button>
                                                        )}
                                                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                                    </div>
                                                </div>
                                                <p className="text-[9px] text-muted-foreground font-mono truncate opacity-40 mb-2">{cmd}</p>
                                                
                                                {serverTools.length > 0 && (
                                                    <div className="pt-2 border-t border-white/5 space-y-1">
                                                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40 mb-1.5">Available Tools</p>
                                                        <div className="flex flex-wrap gap-1">
                                                            {serverTools.map(tool => (
                                                                <AppTooltip key={tool.name} content={tool.description || 'No description provided'}>
                                                                    <Badge variant="outline" className="text-[8px] h-4 px-1.5 border-primary/10 bg-primary/5 text-primary/70 hover:bg-primary/10 cursor-help">
                                                                        {tool.name.replace(name + "_", "")}
                                                                    </Badge>
                                                                </AppTooltip>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-500/60">Live Telemetry</h3>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-[10px] px-1">
                                        <span className="text-muted-foreground">Active Scope</span>
                                        <span className="text-foreground font-bold uppercase">{scope}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] px-1">
                                        <span className="text-muted-foreground">FS Integrity</span>
                                        <span className="text-primary font-bold">VERIFIED</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </OverlayScrollbarsComponent>
                </div>
            </div>

            {/* Micro Context Footer */}
            <div className="px-8 py-3 bg-black/40 border-t border-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <ShieldCheck size={14} className="text-primary/60" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Policy: {selectedConfig?.category === 'core' ? 'System Core' : 'Behavioral Skill'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Activity size={14} className="text-amber-500/60" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Live Injection: Active</span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[10px] font-mono text-muted-foreground/30 uppercase tracking-tighter">v1.0.6-runtime-sync</span>
                    <Badge variant="outline" className="h-5 text-[9px] border-white/5 bg-white/5 text-muted-foreground/40 font-mono">
                        {selectedConfig?.name || 'none'}
                    </Badge>
                </div>
            </div>

            <Dialog open={createDialogOpen} onOpenChange={setCreateResourceDialogOpen}>
                <DialogContent className="max-w-md bg-card border-border shadow-2xl">
                    <DialogHeader className="border-b border-border/40 pb-4">
                        <DialogTitle className="text-xl font-bold tracking-tight">Create New {newResourceType === 'skill' ? 'Skill' : 'Configuration'}</DialogTitle>
                        <DialogDescription className="text-muted-foreground/70">
                            Initialize a new {newResourceType} file for the {scope} scope.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 py-6">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1">Resource Name</label>
                            <input
                                autoFocus
                                className="h-11 w-full rounded-xl border border-border bg-background px-4 text-sm font-medium focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
                                placeholder={newResourceType === 'skill' ? "e.g. documentation-refactor" : "e.g. custom-config.json"}
                                value={newResourceName}
                                onChange={(e) => setNewResourceName(e.target.value)}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1">Target Provider</label>
                            <select
                                value={newResourceProvider}
                                onChange={(e) => setNewResourceProvider(e.target.value)}
                                className="h-11 w-full rounded-xl border border-border bg-background px-4 text-sm font-medium focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm appearance-none"
                            >
                                <option value="Orchestra">Orchestra (System)</option>
                                <option value="claude">Claude Code</option>
                                <option value="gemini">Gemini CLI</option>
                                <option value="codex">Codex</option>
                                <option value="codex">Codex</option>
                                <option value="opencode">OpenCode</option>
                            </select>
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setCreateResourceDialogOpen(false)}
                                disabled={creating}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCreateResource}
                                disabled={creating || !newResourceName.trim()}
                                className="px-6 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
                            >
                                {creating ? (
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        <span>Creating...</span>
                                    </div>
                                ) : 'Create Resource'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={mcpDialogOpen} onOpenChange={setMcpDialogOpen}>
                <DialogContent className="max-w-md bg-card border-border shadow-2xl font-sans">
                    <DialogHeader className="border-b border-border/40 pb-4">
                        <DialogTitle className="text-xl font-bold tracking-tight">Add MCP Server</DialogTitle>
                        <DialogDescription className="text-muted-foreground/70">
                            Connect an external tool host via JSON-RPC over stdio.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 py-6">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1">Server Name</label>
                            <input
                                autoFocus
                                className="h-11 w-full rounded-xl border border-border bg-background px-4 text-sm font-medium focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
                                placeholder="e.g. github"
                                value={newMcpName}
                                onChange={(e) => setNewMcpName(e.target.value)}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1">Executable Command</label>
                            <input
                                className="h-11 w-full rounded-xl border border-border bg-background px-4 text-sm font-medium font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
                                placeholder="e.g. npx @modelcontextprotocol/server-github"
                                value={newMcpCommand}
                                onChange={(e) => setNewMcpCommand(e.target.value)}
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setMcpDialogOpen(false)}
                                disabled={creating}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCreateMCPServer}
                                disabled={creating || !newMcpName.trim() || !newMcpCommand.trim()}
                                className="px-6 bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20"
                            >
                                {creating ? (
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        <span>Connecting...</span>
                                    </div>
                                ) : 'Register Server'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
