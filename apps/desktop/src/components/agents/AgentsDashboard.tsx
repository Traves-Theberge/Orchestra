import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
    Cpu, Save, RefreshCcw, Terminal,
    Zap, Code as CodeIcon,
    FileText, CheckCircle2, AlertCircle, Wrench, 
    Settings, Globe, Layers, Plus, Loader2, Trash2,
    ChevronDown, Search, Network, File, Folder, HardDrive
} from 'lucide-react'
import type { AgentConfig, BackendConfig, Project, SnapshotPayload } from '@/lib/orchestra-types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AppTooltip } from '../ui/tooltip-wrapper'
import {
    fetchAgentConfigs,
    updateAgentConfigByPath,
    fetchProjects,
    createAgentResource,
    fetchMCPTools,
    fetchMCPServers,
    createMCPServer,
    deleteMCPServer,
    type MCPServer,
    type MCPTool,
} from '@/lib/orchestra-client'
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

type MainTab = 'agents' | 'skills' | 'mcp'

export const AgentsDashboard: React.FC<AgentsDashboardProps> = ({ config, snapshot }) => {
    const [configs, setConfigs] = useState<AgentConfig[]>([])
    const [projects, setProjects] = useState<Project[]>([])
    const [mcpTools, setMcpTools] = useState<MCPTool[]>([])
    const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<MainTab>('agents')
    
    // Agent Selection
    const [selectedAgent, setSelectedAgent] = useState<string>('claude')
    const [scope, setScope] = useState<'global' | 'project'>('global')
    const [selectedProjectID, setSelectedProjectID] = useState<string>('')
    
    // Editor State
    const [activeConfig, setActiveConfig] = useState<AgentConfig | null>(null)
    const [editedContent, setEditedContent] = useState('')
    const [error, setError] = useState('')

    // Creation State
    const [createDialogOpen, setCreateResourceDialogOpen] = useState(false)
    const [mcpDialogOpen, setMcpDialogOpen] = useState(false)
    const [newMcpName, setNewMcpName] = useState('')
    const [newMcpCommand, setNewMcpCommand] = useState('')
    const [creating, setCreating] = useState(false)

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

            if (activeTab === 'agents') {
                syncActiveAgentConfig(selectedAgent, configsData)
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            setError(message || 'Failed to load data')
        } finally {
            setLoading(false)
        }
    }

    const syncActiveAgentConfig = (agent: string, availableConfigs: AgentConfig[]) => {
        const match = availableConfigs.find(c => 
            c.scope === scope && 
            c.category === 'core' &&
            c.name.toLowerCase().includes(agent.toLowerCase())
        )
        if (match) {
            setActiveConfig(match)
            setEditedContent(match.content)
        } else {
            setActiveConfig(null)
            setEditedContent('')
        }
    }

    useEffect(() => { loadData() }, [config, scope, selectedProjectID, activeTab])
    useEffect(() => { syncActiveAgentConfig(selectedAgent, configs) }, [selectedAgent])

    const handleSave = async () => {
        if (!config || !activeConfig) return
        setSaving(activeConfig.path)
        try {
            await updateAgentConfigByPath(config, activeConfig.path, editedContent)
            setConfigs(prev => prev.map(c => c.path === activeConfig.path ? { ...c, content: editedContent } : c))
            setError('')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            setError(message || 'Save failed')
        } finally {
            setSaving(null)
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
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            setError(message || 'Failed to create MCP server')
        } finally {
            setCreating(false)
        }
    }

    const isDirty = activeConfig && activeConfig.content !== editedContent

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            {/* Top Navigation */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-muted/10 shrink-0">
                <div className="flex items-center gap-1.5">
                    <AppTooltip content="Managed agent intelligence & model behavioral priors">
                        <button
                            onClick={() => setActiveTab('agents')}
                            className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === 'agents' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:bg-muted/50'}`}
                        >
                            Agents
                        </button>
                    </AppTooltip>
                    <AppTooltip content="Specialized behavioral modules and task-specific scripts">
                        <button
                            onClick={() => setActiveTab('skills')}
                            className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === 'skills' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:bg-muted/50'}`}
                        >
                            Skills
                        </button>
                    </AppTooltip>
                    <AppTooltip content="Model Context Protocol bridge registry and tool-server telemetry">
                        <button
                            onClick={() => setActiveTab('mcp')}
                            className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === 'mcp' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:bg-muted/50'}`}
                        >
                            MCP Servers
                        </button>
                    </AppTooltip>
                </div>

                {isDirty && (
                    <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest animate-pulse">Unsaved Changes</span>
                        <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={!!saving}
                            className="h-8 bg-primary text-primary-foreground font-black uppercase text-[10px] px-4 rounded-xl shadow-lg shadow-primary/20"
                        >
                            {saving ? <Loader2 size={12} className="animate-spin mr-2" /> : <Save size={12} className="mr-2" />}
                            Save Config
                        </Button>
                    </div>
                )}
            </div>

            <div className="flex-1 min-h-0">
                {activeTab === 'agents' && (
                    <div className="h-full flex flex-col">
                        {/* Agent & Scope Selectors */}
                        <div className="p-4 border-b border-border bg-background flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                {['claude', 'gemini', 'codex', 'opencode'].map(id => (
                                    <button
                                        key={id}
                                        onClick={() => setSelectedAgent(id)}
                                        className={`px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${selectedAgent === id 
                                            ? 'bg-primary/10 border-primary text-primary shadow-sm' 
                                            : 'bg-muted/20 border-transparent text-muted-foreground hover:border-border'}`}
                                    >
                                        {id}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="flex items-center bg-muted/30 p-1 rounded-xl border border-border">
                                    <button
                                        onClick={() => setScope('global')}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${scope === 'global' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                    >
                                        Global Config
                                    </button>
                                    <button
                                        onClick={() => setScope('project')}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${scope === 'project' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                    >
                                        Project Overrides
                                    </button>
                                </div>
                                 {scope === 'project' && (
                                     <CustomDropdown
                                         value={selectedProjectID}
                                         onChange={(value) => setSelectedProjectID(String(value))}
                                         options={projects.map(p => ({ label: p.name, value: p.id, icon: <Folder size={12} /> }))}
                                         placeholder="Select Project..."
                                         className="min-w-[200px]"
                                     />
                                 )}
                            </div>
                        </div>

                        {/* Editor */}
                        <div className="flex-1 min-h-0 bg-background flex flex-col p-4">
                            {!activeConfig ? (
                                <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-3xl opacity-30">
                                    <File size={48} strokeWidth={1} />
                                    <p className="mt-4 text-xs font-bold uppercase tracking-widest">No {scope} configuration found for {selectedAgent}</p>
                                </div>
                            ) : (
                                <div className="flex-1 relative border border-border rounded-2xl overflow-hidden shadow-inner bg-card/20">
                                    <div className="absolute top-0 left-0 w-10 h-full bg-muted/20 border-r border-border pointer-events-none flex flex-col pt-6 items-center text-[10px] font-mono text-muted-foreground/30">
                                        {Array.from({ length: 50 }).map((_, i) => <div key={i} className="h-6 flex items-center">{i + 1}</div>)}
                                    </div>
                                    <textarea
                                        value={editedContent}
                                        onChange={(e) => setEditedContent(e.target.value)}
                                        className="w-full h-full bg-transparent pl-14 pr-6 py-6 font-mono text-[13px] leading-6 text-foreground focus:outline-none resize-none"
                                        spellCheck={false}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'skills' && (
                    <div className="h-full flex flex-col p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-foreground/70">Skill Inventory</h2>
                            <Button size="sm" variant="outline" className="h-8 rounded-lg text-[10px] font-black uppercase border-primary/30 text-primary">
                                <Plus size={14} className="mr-2" /> Add Skill
                            </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-auto custom-scrollbar pr-2">
                            {configs.filter(c => c.category === 'skill').map(skill => (
                                <Card key={skill.path} className="p-4 bg-card/40 border-border hover:border-primary/30 transition-all cursor-pointer group">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                                            <Zap size={16} fill="currentColor" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-bold text-foreground truncate">{skill.name}</p>
                                            <p className="text-[9px] font-black uppercase text-muted-foreground/40">{skill.scope}</p>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
                                        Agent skill defined at {skill.path}
                                    </p>
                                </Card>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'mcp' && (
                    <div className="h-full flex flex-col p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-foreground/70">Hardware Bridges</h2>
                            <Button onClick={() => setMcpDialogOpen(true)} size="sm" variant="default" className="h-8 rounded-lg text-[10px] font-black uppercase bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                                <Plus size={14} className="mr-2" /> Register Server
                            </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Object.entries(snapshot?.mcp_servers || {}).map(([name, cmd]) => {
                                const tools = mcpTools.filter(t => t.name.startsWith(name + "_"))
                                return (
                                    <Card key={name} className="p-5 bg-card/40 border-border/60 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                                <span className="text-xs font-black uppercase tracking-wider">{name}</span>
                                            </div>
                                            <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 text-[8px] font-black">{tools.length} TOOLS</Badge>
                                        </div>
                                        <code className="block p-2 bg-muted/30 rounded border border-border/20 text-[9px] font-mono text-muted-foreground truncate">{cmd}</code>
                                        <div className="flex flex-wrap gap-1.5 pt-2">
                                            {tools.map(t => (
                                                <Badge key={t.name} variant="outline" className="text-[7px] font-black tracking-tighter bg-background/50 border-border/40">
                                                    {t.name.split('_').slice(1).join('_')}
                                                </Badge>
                                            ))}
                                        </div>
                                    </Card>
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Dialogs */}
            <Dialog open={mcpDialogOpen} onOpenChange={setMcpDialogOpen}>
                <DialogContent className="max-w-md bg-popover border-border shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black uppercase tracking-tight">Add MCP Server</DialogTitle>
                        <DialogDescription className="text-xs font-bold text-muted-foreground/60">Connect a new tool bridge</DialogDescription>
                    </DialogHeader>
                    <div className="py-6 space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Name</label>
                            <input 
                                className="h-10 w-full rounded-xl border border-border bg-background px-4 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                                value={newMcpName}
                                onChange={e => setNewMcpName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Command</label>
                            <input 
                                className="h-10 w-full rounded-xl border border-border bg-background px-4 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none"
                                value={newMcpCommand}
                                onChange={e => setNewMcpCommand(e.target.value)}
                            />
                        </div>
                        <Button onClick={handleCreateMCPServer} className="w-full h-11 bg-blue-600 text-white font-black uppercase text-[10px] tracking-widest rounded-xl mt-4 shadow-lg shadow-blue-600/20">Establish Link</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function CustomDropdown({
    value,
    options,
    onChange,
    className = '',
    placeholder = 'Select...',
}: {
    value: string | number
    options: { label: string; value: string | number; icon?: React.ReactNode }[]
    onChange: (value: string | number) => void
    className?: string
    placeholder?: string
}) {
    const [isOpen, setIsOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const selectedOption = options.find((opt) => opt.value === value)

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`flex w-full h-8 items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 text-[10px] font-black uppercase tracking-widest text-foreground/70 transition-all hover:bg-muted/40 focus:ring-2 focus:ring-primary/20 ${isOpen ? 'border-primary/40 ring-2 ring-primary/10' : ''}`}
            >
                <div className="flex items-center gap-2 truncate">
                    {selectedOption?.icon}
                    <span className="truncate">{selectedOption?.label || placeholder}</span>
                </div>
                <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute left-0 top-full z-[100] mt-2 w-full min-w-[200px] overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-200 origin-top">
                    <div className="max-h-[300px] overflow-auto custom-scrollbar">
                        {options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                    onChange(option.value)
                                    setIsOpen(false)
                                }}
                                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest transition-all ${option.value === value
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground'
                                    }`}
                            >
                                {option.icon}
                                <span className="flex-1 truncate">{option.label}</span>
                                {option.value === value && <div className="h-1 w-1 rounded-full bg-primary" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

function Card({ children, className = '', onClick, draggable, onDragStart }: { children: React.ReactNode; className?: string; onClick?: () => void; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void }) {
    return (
        <div 
            onClick={onClick}
            draggable={draggable}
            onDragStart={onDragStart}
            className={`rounded-2xl border border-border bg-card shadow-sm transition-all overflow-hidden ${className}`}
        >
            {children}
        </div>
    )
}
