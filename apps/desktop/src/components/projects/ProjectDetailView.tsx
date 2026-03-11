import React, { useState, useEffect, useMemo } from 'react'
import {
    ArrowLeft, Folder, Globe, History, Zap, ExternalLink,
    Calendar, Code as CodeIcon, GitBranch, RefreshCcw, Trash2, Github,
    FileText, Activity, Layers, ChevronRight, File, Folder as FolderIcon, Info, ShieldCheck, AlertCircle
} from 'lucide-react'
import type { Project, ProjectStats, SnapshotPayload, BackendConfig } from '@/lib/orchestra-types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { KanbanBoard } from '@/components/app-shell/panels'
import { fetchProjectTree, fetchProjectGitHistory, fetchProjectGitStatus, fetchProjectGitDiff, refreshProject, gitCommit, gitPush, gitPull, fetchProjectFileContent } from '@/lib/orchestra-client'
import { Skeleton } from '@/components/ui/skeleton'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { Prism } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"

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

const calculateReliabilityIndex = (stats?: ProjectStats): number => {
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
    const [selectedFile, setSelectedFile] = useState<string | null>(null)
    const [fileContent, setFileContent] = useState<string | null>(null)
    const [contentLoading, setContentLoading] = useState(false)
    const [gitHistory, setGitHistory] = useState<any[]>([])
    const [gitStatus, setGitStatus] = useState<any[]>([])
    const [loadingTab, setLoadingTab] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [tabError, setTabError] = useState<string | null>(null)
    const [gitPending, setGitPending] = useState(false)
    const [commitMessage, setCommitMessage] = useState('')
    const [showCommitDialog, setShowCommitDialog] = useState(false)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [selectedDiff, setSelectedDiff] = useState<string | null>(null)
    const [isDiffModalOpen, setIsDiffModalOpen] = useState(false)
    const [diffLoading, setDiffLoading] = useState(false)
    const [selectedCommitInfo, setSelectedCommitInfo] = useState<any>(null)
    const [diffFiles, setDiffFiles] = useState<{path: string, content: string}[]>([])
    const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null)
    const reliability = calculateReliabilityIndex(stats)

    const parseDiff = (rawDiff: string) => {
        const files: {path: string, content: string}[] = []
        const lines = rawDiff.split('\n')
        let currentFile: string | null = null
        let currentContent: string[] = []

        lines.forEach(line => {
            if (line.startsWith('diff --git')) {
                if (currentFile) {
                    files.push({ path: currentFile, content: currentContent.join('\n') })
                }
                const match = line.match(/b\/(.+)$/)
                currentFile = match ? match[1] : 'unknown'
                currentContent = [line]
            } else if (currentFile) {
                currentContent.push(line)
            }
        })

        if (currentFile) {
            files.push({ path: currentFile, content: currentContent.join('\n') })
        }

        return files
    }

    const handleViewDiff = async (hash?: string) => {
        if (!config) return
        setDiffLoading(true)
        setIsDiffModalOpen(true)
        setSelectedDiff(null)
        setDiffFiles([])
        setActiveDiffFile(null)

        if (hash) {
            const commit = gitHistory.find(c => c.hash === hash)
            setSelectedCommitInfo(commit)
        } else {
            setSelectedCommitInfo({ message: 'Uncommitted Changes', author: 'Local User', date: new Date().toISOString() })
        }

        try {
            const diff = await fetchProjectGitDiff(config, project.id, hash)
            setSelectedDiff(diff)
            const parsed = parseDiff(diff)
            setDiffFiles(parsed)
            if (parsed.length > 0) setActiveDiffFile(parsed[0].path)
        } catch (err) {
            console.error('Failed to fetch git diff:', err)
            setSelectedDiff('Error: Failed to fetch diff.')
        } finally {
            setDiffLoading(false)
        }
    }

    useEffect(() => {
        if (!config || !project.id) return

        const loadTabData = async () => {
            setLoadingTab(true)
            setTabError(null)
            try {
                if (activeTab === 'files') {
                    const tree = await fetchProjectTree(config, project.id)
                    setFileTree(tree)
                } else if (activeTab === 'git') {
                    const history = await fetchProjectGitHistory(config, project.id)
                    const status = await fetchProjectGitStatus(config, project.id)
                    setGitHistory(history || [])
                    setGitStatus(status || [])
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                setTabError(msg)
                console.error('[ProjectDetailView] Failed to load tab data:', err)
            } finally {
                setLoadingTab(false)
            }
        }

        void loadTabData()
    }, [activeTab, config, project.id])

    const handleRefresh = async () => {
        if (!config) return
        setRefreshing(true)
        try {
            await refreshProject(config, project.id)
            if (activeTab === 'files') {
                const tree = await fetchProjectTree(config, project.id)
                setFileTree(tree)
            } else if (activeTab === 'git') {
                const [history, status] = await Promise.all([
                    fetchProjectGitHistory(config, project.id),
                    fetchProjectGitStatus(config, project.id)
                ])
                setGitHistory(history || [])
                setGitStatus(status || [])
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

    const handleExpandFolder = async (path: string) => {
        if (!config) return []
        try {
            return await fetchProjectTree(config, project.id, path)
        } catch (err) {
            console.error('Failed to expand folder:', err)
            return []
        }
    }

    const handleFileClick = async (path: string) => {
        if (!config) return
        setSelectedFile(path)
        setContentLoading(true)
        setFileContent(null)
        try {
            const content = await fetchProjectFileContent(config, project.id, path)
            setFileContent(content)
        } catch (err) {
            console.error('Failed to load file content:', err)
            setFileContent('Error: Could not load file content.')
        } finally {
            setContentLoading(false)
        }
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

    const handleDelete = async () => {
        await onDeleteProject(project.id)
        setIsDeleteDialogOpen(false)
    }

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

                        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                            <DialogTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2 text-xs text-red-500 hover:text-red-400 hover:bg-red-500/10 border-red-500/20"
                                >
                                    <Trash2 size={14} />
                                    Remove
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800">
                                <DialogHeader>
                                    <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
                                        <Trash2 className="text-red-500" size={20} />
                                        Remove Project
                                    </DialogTitle>
                                    <DialogDescription className="text-zinc-400 pt-2">
                                        Are you sure you want to remove <span className="text-white font-bold">{project.name}</span> from your workspace?
                                        <br /><br />
                                        <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">Project Path</span>
                                        <div className="bg-black/40 border border-white/5 p-2 rounded mt-1 font-mono text-[10px] text-zinc-300 truncate">
                                            {project.root_path}
                                        </div>
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogFooter className="mt-6">
                                    <Button
                                        variant="ghost"
                                        onClick={() => setIsDeleteDialogOpen(false)}
                                        className="text-zinc-400 hover:text-white"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        onClick={handleDelete}
                                        className="bg-red-600 hover:bg-red-500 text-white font-bold"
                                    >
                                        Remove Project
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
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
                                <StatCard title="Reliability Index" value={`${reliability}%`} icon={<ShieldCheck size={20} />} color={reliability > 80 ? "primary" : reliability > 50 ? "amber" : "destructive"} />
                            </div>

                            {/* Recent Activity Mini-Timeline */}
                            <div className="bg-background/20 rounded-2xl border border-white/5 p-6 backdrop-blur-sm mb-8">
                                <div className="flex items-center justify-between mb-6">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Reliability Index</h3>
                                        <p className="text-[10px] text-muted-foreground/60">Historical run performance and reliability index.</p>
                                    </div>
                                    <Badge variant="outline" className={reliability > 80 ? "text-emerald-500 border-emerald-500/20" : reliability > 50 ? "text-amber-500 border-amber-500/20" : "text-red-500 border-red-500/20"}>
                                        {reliability > 80 ? 'Stable' : reliability > 50 ? 'Degraded' : 'Unstable'}
                                    </Badge>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between text-xs mb-1">
                                                <span className="text-muted-foreground font-medium uppercase tracking-tighter text-[10px]">Reliability Index</span>
                                                <span className="font-bold">{reliability}%</span>
                                            </div>
                                            <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-1000 ${reliability > 80 ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]' :
                                                        reliability > 50 ? 'bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.4)]' :
                                                            'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)]'
                                                        }`}
                                                    style={{ width: `${reliability}%` }}
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
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col min-h-0">
                            {tabError ? (
                                <div className="flex flex-col items-center justify-center py-20 text-red-400 bg-red-500/5 border border-red-500/20 rounded-xl">
                                    <AlertCircle size={48} className="mb-4" />
                                    <p className="text-sm font-bold uppercase tracking-widest">Loading Failed</p>
                                    <p className="text-xs mt-2 font-mono">{tabError}</p>
                                </div>
                            ) : loadingTab ? (
                                <div className="space-y-2">
                                    {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                                </div>
                            ) : (
                                <div className="flex-1 flex gap-4 min-h-0 text-left">
                                    {/* Explorer */}
                                    <div className="w-1/3 bg-background/40 border border-white/10 rounded-xl overflow-hidden shadow-inner flex flex-col">
                                        <div className="p-2 border-b border-white/5 bg-white/5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center justify-between">
                                            <span>Explorer</span>
                                            <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                                        </div>
                                        <div className="flex-1 overflow-auto custom-scrollbar text-left">
                                            <FileTree 
                                                items={fileTree} 
                                                onExpand={handleExpandFolder} 
                                                onFileClick={handleFileClick} 
                                                activeFile={selectedFile} 
                                            />
                                        </div>
                                    </div>

                                    {/* Content Viewer */}
                                    <div className="flex-1 bg-[#1e1e1e] border border-white/10 rounded-xl overflow-hidden shadow-2xl flex flex-col">
                                        <div className="p-2 border-b border-white/5 bg-black/20 flex items-center justify-between">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <File size={12} className="text-primary/60 shrink-0" />
                                                <span className="text-[10px] font-mono text-zinc-400 truncate">{selectedFile || 'No file selected'}</span>
                                            </div>
                                            {contentLoading && <RefreshCcw size={12} className="text-primary animate-spin" />}
                                        </div>
                                        <div className="flex-1 overflow-auto custom-scrollbar text-left">
                                            {selectedFile ? (
                                                fileContent !== null ? (
                                                    <Prism
                                                        language={selectedFile.split('.').pop() || 'text'}
                                                        style={oneDark}
                                                        customStyle={{ margin: 0, padding: '1.5rem', background: 'transparent', fontSize: '12px' }}
                                                        showLineNumbers
                                                    >
                                                        {fileContent}
                                                    </Prism>
                                                ) : (
                                                    <div className="h-full flex items-center justify-center opacity-20 italic text-sm">Loading content...</div>
                                                )
                                            ) : (
                                                <div className="h-full flex flex-col items-center justify-center opacity-20 grayscale py-32 text-center">
                                                    <FileText size={64} className="mb-4 mx-auto" />
                                                    <p className="text-sm font-bold uppercase tracking-widest">Select a file to view content</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'git' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1">
                            {tabError ? (
                                <div className="flex flex-col items-center justify-center py-20 text-red-400 bg-red-500/5 border border-red-500/20 rounded-xl">
                                    <AlertCircle size={48} className="mb-4" />
                                    <p className="text-sm font-bold uppercase tracking-widest">Git Loading Failed</p>
                                    <p className="text-xs mt-2 font-mono">{tabError}</p>
                                </div>
                            ) : loadingTab ? (
                                <div className="space-y-4">
                                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
                                </div>
                            ) : (
                                <div className="space-y-8 pb-8">
                                    {/* Git Operations Bar */}
                                    <div className="flex items-center gap-3 bg-background/40 border border-white/5 p-3 rounded-xl backdrop-blur-md sticky top-0 z-10">
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
                                        <div className="p-4 bg-background/60 border border-primary/30 rounded-xl animate-in zoom-in-95 duration-200 shadow-2xl shadow-primary/10 text-left">
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

                                    {/* Uncommitted Changes */}
                                    {gitStatus.length > 0 && (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between px-1">
                                                <div className="flex items-center gap-2 text-left">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Uncommitted Changes ({gitStatus.length})</h3>
                                                </div>
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm" 
                                                    className="h-6 text-[9px] uppercase tracking-widest font-bold text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 gap-1.5"
                                                    onClick={() => handleViewDiff()}
                                                >
                                                    <FileText size={10} />
                                                    View Full Diff
                                                </Button>
                                            </div>
                                            <div className="bg-amber-500/[0.03] border border-amber-500/10 rounded-xl p-2 text-left">
                                                {gitStatus.map((item, idx) => (
                                                    <div 
                                                        key={idx} 
                                                        className="flex items-center justify-between p-2 hover:bg-amber-500/5 rounded-lg transition-colors group text-left cursor-pointer"
                                                        onClick={() => handleViewDiff()}
                                                    >
                                                        <div className="flex items-center gap-3 overflow-hidden text-left">
                                                            <div className={`text-[10px] font-mono font-bold w-6 h-5 flex items-center justify-center rounded ${
                                                                item.status === 'M' ? 'bg-blue-500/20 text-blue-400' :
                                                                item.status === '??' ? 'bg-emerald-500/20 text-emerald-400' :
                                                                'bg-red-500/20 text-red-400'
                                                            }`}>
                                                                {item.status}
                                                            </div>
                                                            <span className="text-xs font-mono truncate text-muted-foreground group-hover:text-foreground transition-colors">{item.path}</span>
                                                        </div>
                                                        <ChevronRight size={12} className="text-muted-foreground/20 group-hover:text-amber-500/40 transition-colors" />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Commit History */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 px-1 text-left">
                                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Commit History</h3>
                                        </div>
                                        {gitHistory.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-20 opacity-40 text-center">
                                                <GitBranch size={48} className="mb-4 mx-auto" />
                                                <p className="text-sm font-bold uppercase tracking-widest text-center">No Git History Available</p>
                                            </div>
                                        ) : (
                                            gitHistory.map((commit, idx) => {
                                                const dateStr = /^\d+$/.test(commit.date)
                                                    ? new Date(parseInt(commit.date) * 1000).toLocaleString()
                                                    : new Date(commit.date).toLocaleString();

                                                return (
                                                    <div 
                                                        key={idx} 
                                                        className="bg-background/40 border border-white/10 rounded-xl p-4 flex gap-4 items-start group hover:border-primary/30 transition-colors shadow-sm text-left cursor-pointer"
                                                        onClick={() => handleViewDiff(commit.hash)}
                                                    >
                                                        <div className="mt-1">
                                                            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold group-hover:bg-primary/20 group-hover:text-primary transition-colors">
                                                                {commit.author?.slice(0, 2).toUpperCase() || '??'}
                                                            </div>
                                                        </div>
                                                        <div className="flex-1 min-w-0 text-left">
                                                            <div className="flex items-center justify-between mb-1">
                                                                <p className="text-sm font-bold truncate group-hover:text-primary transition-colors">{commit.message}</p>
                                                                <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 rounded group-hover:bg-primary/10 group-hover:text-primary/70 transition-colors">{commit.hash?.slice(0, 7)}</span>
                                                            </div>
                                                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground uppercase tracking-widest">
                                                                <span className="font-bold text-primary/70">{commit.author}</span>
                                                                <span>•</span>
                                                                <span>{dateStr}</span>
                                                            </div>
                                                        </div>
                                                        <div className="self-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <ChevronRight size={16} className="text-primary" />
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </OverlayScrollbarsComponent>

            {/* Git Diff Modal */}
            <Dialog open={isDiffModalOpen} onOpenChange={setIsDiffModalOpen}>
                <DialogContent className="max-w-6xl w-[95vw] h-[85vh] flex flex-col p-0 bg-[#0c0c0e] border-zinc-800 gap-0 overflow-hidden shadow-2xl">
                    {/* Modal Header */}
                    <div className="p-5 border-b border-white/5 bg-zinc-900/50 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-4">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
                                <History size={20} />
                            </div>
                            <div className="space-y-1">
                                <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                                    {selectedCommitInfo?.message || 'Git Inspector'}
                                </DialogTitle>
                                <div className="flex items-center gap-3 text-[10px] text-zinc-500 uppercase tracking-widest font-black">
                                    <span className="text-primary/70">{selectedCommitInfo?.author || 'Unknown'}</span>
                                    <span>•</span>
                                    <span>{selectedCommitInfo?.date ? (
                                        /^\d+$/.test(selectedCommitInfo.date) 
                                            ? new Date(parseInt(selectedCommitInfo.date) * 1000).toLocaleString()
                                            : new Date(selectedCommitInfo.date).toLocaleString()
                                    ) : 'N/A'}</span>
                                    {selectedCommitInfo?.hash && (
                                        <>
                                            <span>•</span>
                                            <span className="font-mono text-zinc-400">{selectedCommitInfo.hash}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 h-6 px-2">
                                {diffFiles.length} {diffFiles.length === 1 ? 'File' : 'Files'} Changed
                            </Badge>
                        </div>
                    </div>
                    
                    {/* Modal Content - Two Pane */}
                    <div className="flex-1 flex min-h-0 bg-black/40 relative">
                        {diffLoading ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-black/60 backdrop-blur-sm">
                                <RefreshCcw size={32} className="text-primary animate-spin" />
                                <p className="text-xs font-bold uppercase tracking-widest text-zinc-400 animate-pulse">Reconstructing Changes</p>
                            </div>
                        ) : diffFiles.length > 0 ? (
                            <>
                                {/* Left Pane: File List */}
                                <div className="w-72 border-r border-white/5 bg-zinc-950/50 flex flex-col shrink-0">
                                    <div className="p-3 border-b border-white/5 bg-black/20 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                        Affected Files
                                    </div>
                                    <OverlayScrollbarsComponent 
                                        element="div"
                                        options={{ scrollbars: { autoHide: 'move', theme: 'os-theme-light' } }}
                                        className="flex-1"
                                    >
                                        <div className="p-2 space-y-1">
                                            {diffFiles.map(file => (
                                                <button
                                                    key={file.path}
                                                    onClick={() => setActiveDiffFile(file.path)}
                                                    className={`w-full text-left p-2 rounded-lg text-xs transition-all flex items-center gap-3 group ${
                                                        activeDiffFile === file.path 
                                                            ? 'bg-primary/10 text-primary border border-primary/20 font-bold' 
                                                            : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                                                    }`}
                                                >
                                                    <File size={14} className={activeDiffFile === file.path ? 'text-primary' : 'text-zinc-600'} />
                                                    <span className="truncate">{file.path}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </OverlayScrollbarsComponent>
                                </div>

                                {/* Right Pane: Diff View */}
                                <div className="flex-1 min-w-0 bg-zinc-950/20">
                                    <OverlayScrollbarsComponent 
                                        element="div" 
                                        options={{ scrollbars: { autoHide: 'move', theme: 'os-theme-light' } }}
                                        className="h-full"
                                    >
                                        <div className="p-6">
                                            <div className="mb-4 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <FileText size={16} className="text-primary/60" />
                                                    <span className="text-sm font-mono text-zinc-300 font-bold">{activeDiffFile}</span>
                                                </div>
                                            </div>
                                            <div className="rounded-xl overflow-hidden border border-white/5 bg-black/40">
                                                <Prism
                                                    language="diff"
                                                    style={oneDark}
                                                    customStyle={{ 
                                                        margin: 0, 
                                                        padding: '1.5rem', 
                                                        background: 'transparent', 
                                                        fontSize: '12px',
                                                        lineHeight: '1.7'
                                                    }}
                                                    showLineNumbers={false}
                                                >
                                                    {diffFiles.find(f => f.path === activeDiffFile)?.content || ''}
                                                </Prism>
                                            </div>
                                        </div>
                                    </OverlayScrollbarsComponent>
                                </div>
                            </>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 opacity-30 grayscale">
                                <GitBranch size={64} className="text-zinc-600 mb-2" />
                                <div className="text-center">
                                    <p className="text-lg font-bold uppercase tracking-[0.2em]">Zero Delta</p>
                                    <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mt-1">No file modifications detected in this view</p>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <DialogFooter className="p-4 border-t border-white/5 bg-zinc-900/50 shrink-0">
                        <Button variant="ghost" onClick={() => setIsDiffModalOpen(false)} className="text-zinc-400 hover:text-white font-bold uppercase tracking-widest text-[10px]">
                            Dismiss Inspector
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function StatCard({ title, value, icon, color }: { title: string, value: string | number, icon: React.ReactNode, color: string }) {
    const colorClasses: Record<string, string> = {
        blue: 'bg-blue-500/10 text-blue-500',
        amber: 'bg-amber-500/10 text-amber-500',
        green: 'bg-green-500/10 text-green-500',
        primary: 'bg-primary/10 text-primary',
        red: 'bg-red-500/10 text-red-500',
        destructive: 'bg-red-500/10 text-red-500',
    }

    return (
        <div className="bg-background/40 border border-white/10 rounded-xl p-5 shadow-sm hover:border-white/20 transition-colors group text-left">
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

function FileTree({ items, level = 0, onExpand, onFileClick, activeFile }: { items: any[], level?: number, onExpand?: (path: string) => Promise<any[]>, onFileClick?: (path: string) => void, activeFile?: string | null }) {
    return (
        <div className="divide-y divide-white/5">
            {items.map((item, idx) => (
                <FileTreeNode key={`${item.path}-${idx}`} item={item} level={level} onExpand={onExpand} onFileClick={onFileClick} activeFile={activeFile} />
            ))}
        </div>
    )
}

function FileTreeNode({ item, level, onExpand, onFileClick, activeFile }: { item: any, level: number, onExpand?: (path: string) => Promise<any[]>, onFileClick?: (path: string) => void, activeFile?: string | null }) {
    const [isOpen, setIsOpen] = useState(false)
    const [children, setChildren] = useState<any[]>(item.children || [])
    const [loading, setLoading] = useState(false)

    const hasChildren = item.is_dir
    const isActive = activeFile === item.path

    const handleToggle = async () => {
        if (item.is_dir) {
            if (!isOpen && children.length === 0 && onExpand) {
                setLoading(true)
                try {
                    const newChildren = await onExpand(item.path)
                    setChildren(newChildren)
                } finally {
                    setLoading(false)
                }
            }
            setIsOpen(!isOpen)
        } else if (onFileClick) {
            onFileClick(item.path)
        }
    }

    return (
        <>
            <div
                style={{ paddingLeft: `${level * 16 + 12}px` }}
                className={`py-2 hover:bg-white/5 flex items-center gap-3 group cursor-pointer transition-colors ${isActive ? 'bg-primary/10 text-primary' : ''}`}
                onClick={handleToggle}
            >
                {item.is_dir ? (
                    <>
                        {loading ? (
                            <RefreshCcw size={14} className="text-primary/40 animate-spin" />
                        ) : (
                            <ChevronRight
                                size={14}
                                className={`text-muted-foreground/40 group-hover:text-primary transition-all duration-200 ${isOpen ? 'rotate-90' : ''}`}
                            />
                        )}
                        <FolderIcon size={16} className="text-primary/60" />
                        <span className="text-sm font-medium">{item.name}</span>
                    </>
                ) : (
                    <>
                        <div className="w-[14px]" />
                        <File size={16} className={`shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground/60'}`} />
                        <span className={`text-sm transition-colors ${isActive ? 'font-bold' : 'text-muted-foreground group-hover:text-foreground'}`}>{item.name}</span>
                    </>
                )}
            </div>
            {isOpen && hasChildren && children.length > 0 && (
                <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                    <FileTree items={children} level={level + 1} onExpand={onExpand} onFileClick={onFileClick} activeFile={activeFile} />
                </div>
            )}
            {isOpen && hasChildren && children.length === 0 && !loading && (
                <div style={{ paddingLeft: `${(level + 1) * 16 + 12}px` }} className="py-2 opacity-40 italic text-[10px]">
                    Empty directory
                </div>
            )}
        </>
    )
}
