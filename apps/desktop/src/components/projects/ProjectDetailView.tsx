import React, { useState, useEffect, useMemo } from 'react'
import {
    ArrowLeft, Folder, Globe, History, Zap, ExternalLink,
    Calendar, Code as CodeIcon, GitBranch, RefreshCcw, Trash2, Github,
    FileText, Activity, Layers, ChevronRight, File, Folder as FolderIcon, Info
} from 'lucide-react'
import type { Project, ProjectStats, SnapshotPayload, BackendConfig } from '@/lib/orchestra-types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { KanbanBoard } from '@/components/app-shell/panels'
import { fetchProjectTree, fetchProjectGitHistory, refreshProject, gitCommit, gitPush, gitPull } from '@/lib/orchestra-client'
import { Skeleton } from '@/components/ui/skeleton'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'

interface ProjectDetailViewProps {
    project: Project
    stats?: ProjectStats
    config: BackendConfig | null
    snapshot: SnapshotPayload | null
    boardIssues: any[]
    availableAgents: string[]
    loadingState: boolean
    onBack: () => void
    onInspectIssue: (id: string) => Promise<void>
    onIssueUpdate: (id: string, updates: Record<string, unknown>) => Promise<void>
    onCreateIssue: (state: string) => void
    onDeleteProject: (id: string) => Promise<void>
}

type ProjectTab = 'overview' | 'tasks' | 'files' | 'git'

const calculateStabilityScore = (stats?: ProjectStats): number => {
    if (!stats || stats.total_sessions === 0) return 100
    const finished = stats.success_count + stats.failure_count
    if (finished === 0) return 100
    return Math.round((stats.success_count / finished) * 100)
}

export const ProjectDetailView: React.FC<ProjectDetailViewProps> = ({
    project,
    stats,
    config,
    snapshot,
    boardIssues,
    availableAgents,
    loadingState,
    onBack,
    onInspectIssue,
    onIssueUpdate,
    onCreateIssue,
    onDeleteProject,
}) => {
    const [activeTab, setActiveTab] = useState<ProjectTab>('overview')
    const [fileTree, setFileTree] = useState<any[]>([])
    const [gitHistory, setGitHistory] = useState<any[]>([])
    const [loadingTab, setLoadingTab] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [gitPending, setGitPending] = useState(false)
    const [commitMessage, setCommitMessage] = useState('')
    const [showCommitDialog, setShowCommitDialog] = useState(false)

    const stability = calculateStabilityScore(stats)

    useEffect(() => {
        if (!config) return

        const loadTabData = async () => {
            if (activeTab === 'files' && fileTree.length === 0) {
                setLoadingTab(true)
                try {
                    const tree = await fetchProjectTree(config, project.id)
                    setFileTree(tree)
                } finally {
                    setLoadingTab(false)
                }
            } else if (activeTab === 'git' && gitHistory.length === 0) {
                setLoadingTab(true)
                try {
                    const history = await fetchProjectGitHistory(config, project.id)
                    setGitHistory(history)
                } finally {
                    setLoadingTab(false)
                }
            }
        }

        loadTabData()
    }, [activeTab, config, project.id])

    const handleRefresh = async () => {
        if (!config) return
        setRefreshing(true)
        try {
            await refreshProject(config, project.id)
            // Trigger a re-fetch of tree/git if we are on those tabs
            if (activeTab === 'files') {
                const tree = await fetchProjectTree(config, project.id)
                setFileTree(tree)
            } else if (activeTab === 'git') {
                const history = await fetchProjectGitHistory(config, project.id)
                setGitHistory(history)
            }
        } finally {
            setRefreshing(false)
        }
    }

    const handleGitAction = async (action: 'commit' | 'push' | 'pull') => {
        if (!config) return
        setGitPending(true)
        try {
            if (action === 'commit') {
                if (!commitMessage.trim()) return
                await gitCommit(config, project.id, commitMessage)
                setCommitMessage('')
                setShowCommitDialog(false)
            } else if (action === 'push') {
                await gitPush(config, project.id)
            } else if (action === 'pull') {
                await gitPull(config, project.id)
            }
            await handleRefresh()
        } catch (err) {
            console.error(`Git ${action} failed:`, err)
            alert(`Git ${action} failed: ` + (err instanceof Error ? err.message : String(err)))
        } finally {
            setGitPending(false)
        }
    }

    const handleConnectGitHub = () => {
        if (!config || !project.id) return
        const loginUrl = `${config.baseUrl}/api/v1/github/login?project_id=${project.id}`
        window.open(loginUrl, 'GitHub Auth', 'width=600,height=800')
    }

    const tabs = [
        { id: 'overview', label: 'Overview', icon: <Layers size={14} /> },
        { id: 'tasks', label: 'Board', icon: <CodeIcon size={14} /> },
        { id: 'files', label: 'Files', icon: <FileText size={14} /> },
        { id: 'git', label: 'Git', icon: <GitBranch size={14} /> },
    ] as const

    const osOptions = useMemo(() => ({
        scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
        overflow: { x: 'hidden' as const, y: 'scroll' as const }
    }), [])

    return (
        <div className="flex flex-col h-full bg-background/20 overflow-hidden">
            {/* Header */}
            <div className="flex flex-col px-8 pt-6 border-b border-white/5 bg-background/40 backdrop-blur-xl sticky top-0 z-20 shrink-0">
                <div className="flex items-center justify-between mb-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onBack}
                        className="text-muted-foreground hover:text-foreground gap-2 -ml-2"
                    >
                        <ArrowLeft size={16} />
                        Back
                    </Button>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 text-xs"
                            onClick={handleRefresh}
                            disabled={refreshing}
                        >
                            <RefreshCcw size={14} className={refreshing ? 'animate-spin' : ''} />
                            Refresh
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 text-xs text-red-500 hover:text-red-400 hover:bg-red-500/10 border-red-500/20"
                            onClick={() => {
                                if (confirm(`Are you sure you want to remove project "${project.name}"?`)) {
                                    onDeleteProject(project.id)
                                }
                            }}
                        >
                            <Trash2 size={14} />
                            Remove
                        </Button>
                    </div>
                </div>

                <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-primary/10 text-primary border border-primary/20">
                            <Folder size={28} />
                        </div>
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
                                {project.remote_url && (
                                    <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 gap-1 h-5 px-1.5 cursor-default">
                                        <GitBranch size={10} />
                                        Git Managed
                                    </Badge>
                                )}
                                {project.github_token ? (
                                    <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 gap-1 h-5 px-1.5 cursor-default">
                                        <Github size={10} />
                                        Connected: {project.github_owner}/{project.github_repo}
                                    </Badge>
                                ) : (
                                    project.github_owner && (
                                        <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 gap-1 h-5 px-1.5 cursor-default">
                                            <Github size={10} />
                                            {project.github_owner}/{project.github_repo}
                                        </Badge>
                                    )
                                )}
                            </div>
                            <p className="text-sm text-muted-foreground font-mono opacity-60 flex items-center gap-2">
                                {project.root_path}
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary">
                                    <ExternalLink size={12} />
                                </Button>
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        {!project.github_token && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-2 h-9 bg-black text-white hover:bg-zinc-800"
                                onClick={handleConnectGitHub}
                            >
                                <Github size={16} />
                                Connect GitHub
                            </Button>
                        )}
                        {project.remote_url && (
                            <Button variant="outline" size="sm" className="gap-2 h-9" asChild>
                                <a href={project.remote_url} target="_blank" rel="noreferrer">
                                    <Globe size={16} />
                                    Remote
                                </a>
                            </Button>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === tab.id
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <OverlayScrollbarsComponent
                element="div"
                options={osOptions}
                className="flex-1 min-h-0"
            >
                <div className="p-8 min-h-full flex flex-col">
                    {activeTab === 'overview' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1">
                            {/* Stats Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                                <StatCard title="Total Sessions" value={stats?.total_sessions || 0} icon={<History size={20} />} color="blue" />
                                <StatCard title="Token Throughput" value={((stats?.total_input || 0) + (stats?.total_output || 0)).toLocaleString()} icon={<Zap size={20} />} color="amber" />
                                <StatCard title="Last Active" value={stats?.last_active ? new Date(stats.last_active).toLocaleDateString() : 'N/A'} icon={<Calendar size={20} />} color="green" />
                                <StatCard title="Project Health" value={`${stability}%`} icon={<ShieldCheck size={20} />} color={stability > 80 ? "primary" : stability > 50 ? "amber" : "destructive"} />
                            </div>

                            {/* Recent Activity Mini-Timeline */}
                            <div className="bg-background/20 rounded-2xl border border-white/5 p-6 backdrop-blur-sm mb-8">
                                <div className="flex items-center justify-between mb-6">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Stability Forecast</h3>
                                        <p className="text-[10px] text-muted-foreground/60">Historical run performance and reliability index.</p>
                                    </div>
                                    <Badge variant="outline" className={stability > 80 ? "text-emerald-500 border-emerald-500/20" : stability > 50 ? "text-amber-500 border-amber-500/20" : "text-red-500 border-red-500/20"}>
                                        {stability > 80 ? 'Stable' : stability > 50 ? 'Degraded' : 'Unstable'}
                                    </Badge>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between text-xs mb-1">
                                                <span className="text-muted-foreground font-medium uppercase tracking-tighter text-[10px]">Reliability Index</span>
                                                <span className="font-bold">{stability}%</span>
                                            </div>
                                            <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-1000 ${stability > 80 ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]' :
                                                        stability > 50 ? 'bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.4)]' :
                                                            'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)]'
                                                        }`}
                                                    style={{ width: `${stability}%` }}
                                                />
                                            </div>
                                        </div>
                                        <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                                            <div className="space-y-1">
                                                <p className="text-[9px] font-black uppercase text-muted-foreground/40 tracking-tighter">Total</p>
                                                <p className="text-sm font-bold">{stats?.total_sessions || 0}</p>
                                            </div>
                                            <div className="space-y-1 border-x border-white/5">
                                                <p className="text-[9px] font-black uppercase text-emerald-500/40 tracking-tighter text-emerald-500/60">Success</p>
                                                <p className="text-sm font-bold text-emerald-500">{stats?.success_count || 0}</p>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-[9px] font-black uppercase text-red-500/40 tracking-tighter text-red-500/60">Failures</p>
                                                <p className="text-sm font-bold text-red-500">{stats?.failure_count || 0}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col justify-center items-center p-4 border border-dashed border-white/10 rounded-xl bg-white/[0.01]">
                                        <Activity className="text-primary/20 mb-2" size={32} />
                                        <p className="text-[10px] text-muted-foreground text-center uppercase font-bold tracking-widest opacity-40">Predictive Analytics Inactive</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'tasks' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col">
                            <div className="bg-background/20 rounded-2xl border border-white/5 p-6 backdrop-blur-sm flex-1 flex flex-col">
                                <KanbanBoard
                                    loadingState={loadingState}
                                    snapshot={snapshot}
                                    boardIssues={boardIssues.filter(i => i.project_id === project.id)}
                                    projects={[project]}
                                    onInspectIssue={onInspectIssue}
                                    onIssueUpdate={onIssueUpdate}
                                    onCreateIssue={onCreateIssue}
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'files' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col">
                            {loadingTab ? (
                                <div className="space-y-2">
                                    {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                                </div>
                            ) : fileTree.length === 0 ? (
                                <div className="flex flex-1 flex-col items-center justify-center py-20 opacity-40">
                                    <Info size={48} className="mb-4 text-primary" />
                                    <p className="text-sm font-bold uppercase tracking-widest text-center">No Files Indexed</p>
                                    <p className="text-xs mt-2 text-center max-w-xs capitalize">This workspace has no active source files tracked by the orchestrator.</p>
                                </div>
                            ) : (
                                <div className="bg-background/40 border border-white/10 rounded-xl overflow-hidden shadow-inner flex-1">
                                    <FileTree items={fileTree} />
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'git' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1">
                            {loadingTab ? (
                                <div className="space-y-4">
                                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
                                </div>
                            ) : gitHistory.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 opacity-40">
                                    <GitBranch size={48} className="mb-4" />
                                    <p className="text-sm font-bold uppercase tracking-widest text-center">No Git History Available</p>
                                </div>
                            ) : (
                                <div className="space-y-4 pb-8">
                                    {/* Git Operations Bar */}
                                    <div className="flex items-center gap-3 mb-6 bg-background/40 border border-white/5 p-3 rounded-xl backdrop-blur-md">
                                        <div className="flex-1 flex gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-2 bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                                                onClick={() => setShowCommitDialog(true)}
                                                disabled={gitPending}
                                            >
                                                <History size={14} />
                                                Commit
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-2"
                                                onClick={() => handleGitAction('push')}
                                                disabled={gitPending}
                                            >
                                                <Globe size={14} />
                                                Push
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-2"
                                                onClick={() => handleGitAction('pull')}
                                                disabled={gitPending}
                                            >
                                                <RefreshCcw size={14} className={gitPending ? 'animate-spin' : ''} />
                                                Pull
                                            </Button>
                                        </div>
                                    </div>

                                    {showCommitDialog && (
                                        <div className="mb-6 p-4 bg-background/60 border border-primary/30 rounded-xl animate-in zoom-in-95 duration-200 shadow-2xl shadow-primary/10">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-3 px-1">Commit Changes</p>
                                            <textarea
                                                className="w-full bg-background/50 border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:border-primary/50 transition-colors mb-4 resize-none"
                                                placeholder="Enter commit message..."
                                                rows={2}
                                                value={commitMessage}
                                                onChange={(e) => setCommitMessage(e.target.value)}
                                            />
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="sm" onClick={() => setShowCommitDialog(false)}>Cancel</Button>
                                                <Button size="sm" onClick={() => handleGitAction('commit')} disabled={!commitMessage.trim() || gitPending}>Confirm Commit</Button>
                                            </div>
                                        </div>
                                    )}

                                    {gitHistory.map((commit, idx) => {
                                        const dateStr = /^\d+$/.test(commit.date)
                                            ? new Date(parseInt(commit.date) * 1000).toLocaleString()
                                            : new Date(commit.date).toLocaleString();

                                        return (
                                            <div key={idx} className="bg-background/40 border border-white/10 rounded-xl p-4 flex gap-4 items-start group hover:border-primary/30 transition-colors shadow-sm mb-4">
                                                <div className="mt-1">
                                                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                                                        {commit.author?.slice(0, 2).toUpperCase() || '??'}
                                                    </div>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <p className="text-sm font-bold truncate">{commit.message}</p>
                                                        <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 rounded">{commit.hash?.slice(0, 7)}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground uppercase tracking-widest">
                                                        <span className="font-bold text-primary/70">{commit.author}</span>
                                                        <span>•</span>
                                                        <span>{dateStr}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </OverlayScrollbarsComponent>
        </div>
    )
}

function StatCard({ title, value, icon, color }: { title: string, value: string | number, icon: React.ReactNode, color: string }) {
    const colorClasses: Record<string, string> = {
        blue: 'bg-blue-500/10 text-blue-500',
        amber: 'bg-amber-500/10 text-amber-500',
        green: 'bg-green-500/10 text-green-500',
        primary: 'bg-primary/10 text-primary',
    }

    return (
        <div className="bg-background/40 border border-white/10 rounded-xl p-5 shadow-sm hover:border-white/20 transition-colors group">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1 group-hover:text-foreground transition-colors">{title}</p>
            <div className="flex items-center justify-between">
                <p className="text-2xl font-bold">{value}</p>
                <div className={`p-2 rounded-lg ${colorClasses[color] || colorClasses.primary}`}>
                    {icon}
                </div>
            </div>
        </div>
    )
}

function FileTree({ items, level = 0 }: { items: any[], level?: number }) {
    return (
        <div className="divide-y divide-white/5">
            {items.map((item, idx) => (
                <FileTreeNode key={idx} item={item} level={level} />
            ))}
        </div>
    )
}

function FileTreeNode({ item, level }: { item: any, level: number }) {
    const [isOpen, setIsOpen] = useState(false)
    const hasChildren = item.is_dir && item.children && item.children.length > 0

    return (
        <>
            <div
                style={{ paddingLeft: `${level * 16 + 12}px` }}
                className="py-2 hover:bg-white/5 flex items-center gap-3 group cursor-pointer transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                {item.is_dir ? (
                    <>
                        <ChevronRight
                            size={14}
                            className={`text-muted-foreground/40 group-hover:text-primary transition-all duration-200 ${isOpen ? 'rotate-90' : ''}`}
                        />
                        <FolderIcon size={16} className="text-primary/60" />
                        <span className="text-sm font-medium">{item.name}</span>
                    </>
                ) : (
                    <>
                        <div className="w-[14px]" />
                        <File size={16} className="text-muted-foreground/60" />
                        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{item.name}</span>
                    </>
                )}
            </div>
            {isOpen && hasChildren && (
                <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                    <FileTree items={item.children} level={level + 1} />
                </div>
            )}
        </>
    )
}
