import React, { useState, useEffect, useMemo } from 'react'
import {
    ArrowLeft, Globe, ExternalLink,
    GitBranch, RefreshCcw, Trash2, Github,
    FileText, Layers, ChevronRight, File, Folder as FolderIcon, FolderOpen, AlertCircle, Search, X
} from 'lucide-react'
import type { Project, ProjectStats, SnapshotPayload } from '@core/api/types'
import { Button } from '@ui/button'
import { KanbanBoard } from '@layout/panels'
import { GitTab } from '@features/git'
import {
    fetchProjectTree,
    refreshProject,
    disconnectProjectGitHub,
    fetchProjectGitHubIssues,
    listTrackerConfigs,
    setProjectTracker,
    type BackendConfig,
    type GitHubIssue,
    type IssueListItem,
    type IssueUpdatePayload,
    type ProjectTreeNode,
} from '@core/api/client'
import type { TrackerConfig } from '@/entities/tracker/types'
import { EditorContent } from '@features/workspace/editor/EditorContent'
import { useAppStore } from '@core/store'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { Skeleton } from '@ui/skeleton'

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@ui/dialog'

/** Convert git SSH URLs to HTTPS so browsers can open them. */
function sshToHttps(url: string): string {
    if (url.startsWith('git@')) {
        // git@github.com:owner/repo.git → https://github.com/owner/repo
        return url.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '')
    }
    return url.replace(/\.git$/, '')
}

/** Props for the {@link ProjectDetailView} component. */
interface ProjectDetailViewProps {
    project: Project
    stats?: ProjectStats
    config: BackendConfig | null
    snapshot: SnapshotPayload | null
    boardIssues: IssueListItem[]
    availableAgents: string[]
    loadingState: boolean
    onBack: () => void
    onInspectIssue: (id: string) => Promise<void>
    onJumpToTerminal?: (id: string) => void
    onIssueUpdate: (id: string, updates: IssueUpdatePayload) => Promise<void>
    onIssueDelete?: (id: string) => Promise<void>
    onStopSession?: (id: string) => Promise<void>
    onCreateIssue: (state: string) => void
    onDeleteProject: (id: string) => Promise<void>
    onRefreshProjects: () => Promise<void>
}

type ProjectTab = 'overview' | 'files' | 'git'

export const ProjectDetailView: React.FC<ProjectDetailViewProps> = ({
    project,
    config,
    snapshot,
    boardIssues,
    availableAgents,
    loadingState,
    onBack,
    onInspectIssue,
    onJumpToTerminal,
    onIssueUpdate,
    onIssueDelete,
    onStopSession,
    onCreateIssue,
    onDeleteProject,
    onRefreshProjects,
}) => {
    const [activeTab, setActiveTab] = useState<ProjectTab>('overview')
    const [fileTree, setFileTree] = useState<ProjectTreeNode[]>([])
    const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({})
    const [folderLoadPending, setFolderLoadPending] = useState<Record<string, boolean>>({})
    const [fileQuery, setFileQuery] = useState('')
    const [focusedPath, setFocusedPath] = useState<string | null>(null)
    const [showHiddenFiles, setShowHiddenFiles] = useState(false)
    const [selectedFile, setSelectedFile] = useState<string | null>(null)
    const [loadingTab, setLoadingTab] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [githubPending, setGithubPending] = useState(false)
    const [githubError, setGithubError] = useState('')
    const [tabError, setTabError] = useState<string | null>(null)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [deletePending, setDeletePending] = useState(false)
    const [deleteError, setDeleteError] = useState('')
    const [githubIssues, setGithubIssues] = useState<GitHubIssue[]>([])
    const [trackerConfigs, setTrackerConfigs] = useState<TrackerConfig[]>([])
    const [activeTrackerConfigId, setActiveTrackerConfigId] = useState<string>('')
    const [trackerSaving, setTrackerSaving] = useState(false)

    const pathExists = project.path_exists !== false
    const isGitHub = !!project.github_owner && !!project.github_repo
    const isConnected = !!project.github_token

    // Fetch GitHub issues on mount; cancel on project change so stale results
    // never overwrite the freshly-selected project.
    useEffect(() => {
        if (!config || !isConnected) return
        let cancelled = false
        fetchProjectGitHubIssues(config, project.id, 'open')
            .then((data) => { if (!cancelled) setGithubIssues(data?.issues ?? []) })
            .catch(() => { if (!cancelled) setGithubIssues([]) })
        return () => { cancelled = true }
    }, [config, project.id, isConnected])

    // Poll GitHub issues every 60s on overview tab; pause when window is hidden
    // to avoid background polling, and bail on responses that arrive after change.
    useEffect(() => {
        if (!config || !isConnected || activeTab !== 'overview') return
        let cancelled = false
        const tick = () => {
            if (document.hidden) return
            fetchProjectGitHubIssues(config, project.id, 'open')
                .then((data) => { if (!cancelled) setGithubIssues(data?.issues ?? []) })
                .catch(() => {})
        }
        const interval = setInterval(tick, 60000)
        return () => { cancelled = true; clearInterval(interval) }
    }, [config, project.id, isConnected, activeTab])

    // Reset state on project change
    useEffect(() => {
        setFileQuery('')
        setExpandedPaths({})
        setFocusedPath(null)
        setSelectedFile(null)
        setGithubError('')
    }, [project.id])

    // Load available tracker configs when the component mounts or config changes
    useEffect(() => {
        if (!config) return
        let cancelled = false
        const run = async () => {
            try {
                const data = await listTrackerConfigs(config)
                if (cancelled) return
                setTrackerConfigs(data)
            } catch {
                // Non-fatal — leave the list empty so the dropdown shows None only.
            }
        }
        void run()
        return () => { cancelled = true }
    }, [config])

    useEffect(() => {
        setActiveTrackerConfigId(project.tracker_config_id ?? '')
    }, [project])

    // Subscribe to the global editor store so the file shows up in the
    // Development workspace too, and we get save/revert/jump-to-line for free.
    const openFileInStore = useAppStore((s) => s.openFile)
    const openFiles = useAppStore((s) => s.openFiles)
    const activeOpenFile = useMemo(() => {
        if (!selectedFile) return null
        const abs = `${project.root_path.replace(/\/$/, '')}/${selectedFile}`
        return openFiles.find((f) => f.filePath === abs) ?? null
    }, [openFiles, selectedFile, project.root_path])

    // Load tab data
    useEffect(() => {
        setTabError(null)
        if (!config || !project.id || activeTab === 'overview' || !pathExists) return
        const load = async () => {
            setLoadingTab(true)
            try {
                if (activeTab === 'files') {
                    const tree = await fetchProjectTree(config, project.id)
                    setFileTree(tree)
                    setExpandedPaths({})
                    setFocusedPath(null)
                }
            } catch (err) {
                setTabError(err instanceof Error ? err.message : String(err))
            } finally {
                setLoadingTab(false)
            }
        }
        void load()
    }, [activeTab, config, project.id, pathExists])

    const handleRefresh = async () => {
        if (!config) return
        setRefreshing(true)
        try {
            await refreshProject(config, project.id)
            await onRefreshProjects()
            if (activeTab === 'files') {
                const tree = await fetchProjectTree(config, project.id)
                setFileTree(tree)
                setExpandedPaths({})
                setFocusedPath(null)
            }
        } finally {
            setRefreshing(false)
        }
    }

    const openExternal = async (url: string) => {
        const bridge = window.orchestraDesktop
        if (bridge?.openExternal) {
            await bridge.openExternal(url)
            return
        }
        window.open(url, '_blank', 'noopener,noreferrer')
    }

    const handleConnectGitHub = async () => {
        if (!config || !project.id) return
        setGithubError('')
        setGithubPending(true)
        try {
            const loginUrl = `${config.baseUrl}/api/v1/github/login?project_id=${project.id}`
            await openExternal(loginUrl)
            // SSE GITHUB_CONNECTED event will trigger project refresh automatically
        } catch (err) {
            setGithubError(err instanceof Error ? err.message : 'Failed to start GitHub authentication')
        } finally {
            setGithubPending(false)
        }
    }

    const handleDisconnectGitHub = async () => {
        if (!config || !project.id) return
        if (!window.confirm(`Disconnect GitHub from ${project.github_owner}/${project.github_repo}?`)) return
        setGithubError('')
        setGithubPending(true)
        try {
            await disconnectProjectGitHub(config, project.id)
            // SSE GITHUB_DISCONNECTED event will trigger project refresh automatically
        } catch (err) {
            setGithubError(err instanceof Error ? err.message : 'Failed to disconnect GitHub')
        } finally {
            setGithubPending(false)
        }
    }

    const handleTrackerChange = async (configId: string) => {
        if (!config) return
        setActiveTrackerConfigId(configId)
        setTrackerSaving(true)
        try {
            await setProjectTracker(config, project.id, configId)
        } catch (err) {
            setGithubError(err instanceof Error ? err.message : 'Failed to assign tracker')
            // Roll back so the UI doesn't lie
            setActiveTrackerConfigId(project.tracker_config_id ?? '')
        } finally {
            setTrackerSaving(false)
        }
    }

    const handleOpenFolder = async () => {
        const bridge = window.orchestraDesktop
        try {
            if (bridge?.openPath) { await bridge.openPath(project.root_path); return }
            if (bridge?.openExternal) { await bridge.openExternal(`file://${encodeURI(project.root_path)}`); return }
            window.open(`file://${encodeURI(project.root_path)}`, '_blank', 'noopener,noreferrer')
        } catch (err) {
            console.error('Failed to open project folder:', err)
        }
    }

    const handleDelete = async () => {
        setDeletePending(true)
        setDeleteError('')
        try {
            await onDeleteProject(project.id)
            setIsDeleteDialogOpen(false)
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : 'Failed to remove project')
        } finally {
            setDeletePending(false)
        }
    }

    // File tree handlers
    const handleLoadFolderChildren = async (path: string): Promise<ProjectTreeNode[]> => {
        if (!config) return []
        setFolderLoadPending((prev) => ({ ...prev, [path]: true }))
        try { return await fetchProjectTree(config, project.id, path) }
        catch { return [] }
        finally { setFolderLoadPending((prev) => ({ ...prev, [path]: false })) }
    }

    const handleFileClick = (path: string) => {
        setSelectedFile(path)
        setFocusedPath(path)
        const abs = `${project.root_path.replace(/\/$/, '')}/${path}`
        openFileInStore(abs, path)
    }

    const toggleFolder = async (node: ProjectTreeNode) => {
        const shouldOpen = !expandedPaths[node.path]
        if (shouldOpen && (!node.children || node.children.length === 0)) {
            const children = await handleLoadFolderChildren(node.path)
            setFileTree((prev) => injectTreeChildren(prev, node.path, children))
        }
        setExpandedPaths((prev) => ({ ...prev, [node.path]: shouldOpen }))
        setFocusedPath(node.path)
    }

    const filteredTree = useMemo(() => filterTreeNodes(fileTree, fileQuery, showHiddenFiles), [fileTree, fileQuery, showHiddenFiles])
    const visibleTreeNodes = useMemo(() => flattenVisibleTree(filteredTree, expandedPaths), [filteredTree, expandedPaths])

    const handleTreeKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (visibleTreeNodes.length === 0) return
        const currentPath = focusedPath || selectedFile || visibleTreeNodes[0]?.node.path || null
        const currentIndex = currentPath ? Math.max(visibleTreeNodes.findIndex((entry) => entry.node.path === currentPath), 0) : 0
        const current = visibleTreeNodes[currentIndex]
        if (!current) return

        if (event.key === 'ArrowDown') { event.preventDefault(); const next = visibleTreeNodes[Math.min(currentIndex + 1, visibleTreeNodes.length - 1)]; if (next) setFocusedPath(next.node.path); return }
        if (event.key === 'ArrowUp') { event.preventDefault(); const prev = visibleTreeNodes[Math.max(currentIndex - 1, 0)]; if (prev) setFocusedPath(prev.node.path); return }
        if (event.key === 'ArrowRight') {
            event.preventDefault()
            if (current.node.is_dir) {
                if (!expandedPaths[current.node.path]) { await toggleFolder(current.node) }
                else { const next = visibleTreeNodes[currentIndex + 1]; if (next) setFocusedPath(next.node.path) }
            }
            return
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault()
            if (current.node.is_dir && expandedPaths[current.node.path]) { setExpandedPaths((prev) => ({ ...prev, [current.node.path]: false })); return }
            if (current.parentPath) setFocusedPath(current.parentPath)
            return
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (current.node.is_dir) await toggleFolder(current.node)
            else await handleFileClick(current.node.path)
        }
    }

    const tabs = [
        { id: 'overview' as const, label: 'Tasks', icon: <Layers size={14} />, needsPath: false },
        { id: 'files' as const, label: 'Files', icon: <FileText size={14} />, needsPath: true },
        { id: 'git' as const, label: 'Git', icon: <GitBranch size={14} />, needsPath: true },
    ]

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            {/* Header — compact single row */}
            <div className="shrink-0 flex items-center gap-2 px-5 h-12 border-b border-border/30">
                <button
                    onClick={onBack}
                    className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors shrink-0"
                    title="Back to projects"
                >
                    <ArrowLeft size={14} />
                </button>

                <h1 className="text-[14px] font-bold tracking-tight truncate shrink-0">{project.name}</h1>

                <span className="text-[11px] font-mono text-muted-foreground/50 truncate min-w-0 hidden md:inline">
                    {project.root_path}
                </span>
                <AppTooltip content="Open folder">
                    <button
                        onClick={() => void handleOpenFolder()}
                        className="h-7 w-7 grid place-items-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.04] transition-colors shrink-0 hidden md:grid"
                    >
                        <ExternalLink size={11} />
                    </button>
                </AppTooltip>

                <div className="flex-1" />

                {isConnected ? (
                    <button
                        onClick={() => void handleDisconnectGitHub()}
                        disabled={githubPending}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors shrink-0"
                        title="Disconnect GitHub"
                    >
                        <Github size={11} className="text-primary" />
                        <span className="font-mono">{project.github_owner}/{project.github_repo}</span>
                    </button>
                ) : isGitHub ? (
                    <button
                        onClick={() => void handleConnectGitHub()}
                        disabled={githubPending}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[11px] font-semibold transition-colors disabled:opacity-50 shrink-0"
                    >
                        <Github size={11} />
                        {githubPending ? 'Connecting…' : 'Connect GitHub'}
                    </button>
                ) : project.remote_url ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60 shrink-0">
                        <GitBranch size={11} /> Git
                    </span>
                ) : null}

                {trackerConfigs.length > 0 && (
                    <select
                        value={activeTrackerConfigId}
                        onChange={(e) => void handleTrackerChange(e.target.value)}
                        disabled={trackerSaving}
                        title="Issue tracker for this project"
                        className="h-7 px-2 rounded-md text-[11px] font-medium bg-background border border-border/40 text-foreground/80 hover:text-foreground hover:border-border focus:outline-none focus:ring-1 focus:ring-ring transition-colors shrink-0 disabled:opacity-50"
                    >
                        <option value="">No tracker</option>
                        {trackerConfigs.map((cfg) => (
                            <option key={cfg.id} value={cfg.id}>{cfg.display_name}</option>
                        ))}
                    </select>
                )}

                <div className="flex items-center gap-0.5 shrink-0">
                    <AppTooltip content="Refresh project">
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="h-7 w-7 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-50"
                        >
                            <RefreshCcw size={12} className={refreshing ? 'animate-refresh-spin' : ''} />
                        </button>
                    </AppTooltip>
                    {project.remote_url && (
                        <AppTooltip content="Open repository in browser">
                            <button
                                onClick={() => void openExternal(sshToHttps(project.remote_url))}
                                className="h-7 w-7 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                            >
                                <Globe size={12} />
                            </button>
                        </AppTooltip>
                    )}
                    <AppTooltip content="Remove project">
                        <button
                            onClick={() => setIsDeleteDialogOpen(true)}
                            className="h-7 w-7 grid place-items-center rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                            <Trash2 size={12} />
                        </button>
                    </AppTooltip>
                </div>

            </div>

            {/* Tab strip — dedicated row, underline-style for visual hierarchy */}
            <div className="shrink-0 flex items-center gap-1 px-5 border-b border-border/30">
                {tabs.map((tab) => {
                    const disabled = tab.needsPath && !pathExists
                    const isActive = activeTab === tab.id
                    return (
                        <button
                            key={tab.id}
                            onClick={() => !disabled && setActiveTab(tab.id)}
                            disabled={disabled}
                            className={`relative inline-flex items-center gap-1.5 px-3 h-9 text-[12.5px] font-medium tracking-tight transition-colors ${
                                disabled
                                    ? 'text-muted-foreground/30 cursor-not-allowed'
                                    : isActive
                                        ? 'text-foreground'
                                        : 'text-muted-foreground/70 hover:text-foreground'
                            }`}
                        >
                            <span className={isActive ? 'text-primary' : ''}>{tab.icon}</span>
                            {tab.label}
                            {isActive && <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />}
                        </button>
                    )
                })}
            </div>

            {/* GitHub error banner */}
            {githubError && (
                <div className="mx-5 mt-2 px-3 py-2 rounded-md bg-destructive/10 text-[11px] text-destructive flex items-center justify-between">
                    <span>{githubError}</span>
                    <button onClick={() => setGithubError('')} className="ml-2 hover:opacity-70"><X size={12} /></button>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {activeTab === 'overview' && (
                    <div className="flex-1 flex flex-col min-h-0">
                        {!pathExists && (
                            <div className="mx-8 mt-4 flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 text-amber-500 text-[11px]">
                                <AlertCircle size={13} className="shrink-0" />
                                Path not found: <span className="font-mono">{project.root_path}</span>
                            </div>
                        )}
                        <div className="flex-1 flex flex-col min-h-0">
                            <KanbanBoard
                                loadingState={loadingState}
                                snapshot={snapshot}
                                boardIssues={(() => {
                                    const local = boardIssues.filter(i => i.project_id === project.id)
                                    const localTitles = new Set(local.map(i => i.title))
                                    const ghBacklog: IssueListItem[] = githubIssues
                                        .filter(gh => !localTitles.has(gh.title))
                                        .map(gh => ({
                                            id: `github-${gh.number}`, issue_id: `github-${gh.number}`,
                                            identifier: `GH-${gh.number}`, issue_identifier: `GH-${gh.number}`,
                                            title: gh.title, description: gh.body, state: 'Backlog',
                                            project_id: project.id, url: gh.html_url,
                                        }))
                                    return [...local, ...ghBacklog]
                                })()}
                                projects={[project]}
                                availableAgents={availableAgents}
                                onInspectIssue={onInspectIssue}
                                onJumpToTerminal={onJumpToTerminal}
                                onIssueUpdate={onIssueUpdate}
                                onIssueDelete={onIssueDelete}
                                onStopSession={onStopSession}
                                onCreateIssue={onCreateIssue}
                            />
                        </div>
                    </div>
                )}

                {activeTab === 'files' && (
                    <div className="flex-1 flex flex-col min-h-0">
                        {tabError ? (
                            <div className="m-8 flex flex-col items-center justify-center py-16 text-destructive">
                                <AlertCircle size={28} className="mb-3" strokeWidth={1.5} />
                                <p className="text-sm font-semibold">Failed to load files</p>
                                <p className="text-[11px] mt-1 font-mono opacity-60">{tabError}</p>
                            </div>
                        ) : loadingTab ? (
                            <div className="m-8 space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-9 w-full rounded-md" />)}</div>
                        ) : (
                            <div className="flex-1 flex min-h-0">
                                {/* File tree */}
                                <div className="w-72 border-r border-border/40 flex flex-col min-h-0">
                                    <div className="px-3 pt-3 pb-2 space-y-2">
                                        <div className="relative">
                                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                            <input
                                                type="text"
                                                value={fileQuery}
                                                onChange={(e) => setFileQuery(e.target.value)}
                                                placeholder="Search files…"
                                                className="h-8 w-full rounded-md bg-muted/30 pl-8 pr-7 text-[12px] font-medium placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all"
                                            />
                                            {fileQuery && (
                                                <button
                                                    onClick={() => setFileQuery('')}
                                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/50 hover:text-foreground"
                                                >
                                                    <X size={11} />
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between px-1">
                                            <button
                                                onClick={() => setExpandedPaths({})}
                                                className="text-[10.5px] text-muted-foreground/70 hover:text-foreground transition-colors"
                                            >
                                                Collapse all
                                            </button>
                                            <button
                                                onClick={() => setShowHiddenFiles(p => !p)}
                                                className={`text-[10.5px] transition-colors ${showHiddenFiles ? 'text-primary' : 'text-muted-foreground/70 hover:text-foreground'}`}
                                            >
                                                Dotfiles {showHiddenFiles ? 'on' : 'off'}
                                            </button>
                                        </div>
                                    </div>
                                    <div
                                        className="flex-1 overflow-auto custom-scrollbar focus:outline-none pb-4"
                                        tabIndex={0}
                                        onKeyDown={(e) => { void handleTreeKeyDown(e) }}
                                        onFocus={() => { if (!focusedPath && visibleTreeNodes[0]) setFocusedPath(visibleTreeNodes[0].node.path) }}
                                    >
                                        {filteredTree.length > 0 ? (
                                            <FileTree
                                                items={filteredTree}
                                                expandedPaths={expandedPaths}
                                                loadingPaths={folderLoadPending}
                                                onToggle={toggleFolder}
                                                onFileClick={(p) => { void handleFileClick(p) }}
                                                activeFile={selectedFile}
                                                focusedPath={focusedPath}
                                            />
                                        ) : (
                                            <div className="px-4 py-6 text-[11px] text-muted-foreground/50">No files match.</div>
                                        )}
                                    </div>
                                </div>

                                {/* Editor */}
                                <div className="flex-1 flex flex-col min-h-0">
                                    {activeOpenFile ? (
                                        <EditorContent file={activeOpenFile} />
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 gap-2">
                                            <FileText size={20} strokeWidth={1.5} />
                                            <p className="text-[12px] font-medium">Select a file</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'git' && (
                    <section className="flex-1 flex flex-col min-h-0">
                        <GitTab project={project} config={config} />
                    </section>
                )}
            </div>

            {/* Delete dialog */}
            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogContent className="sm:max-w-md bg-popover border-border p-6">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-bold text-center">Remove Project</DialogTitle>
                        <DialogDescription className="text-center text-sm pt-2">
                            Remove <span className="font-semibold text-foreground">{project.name}</span> from your workspace?
                            <span className="block text-xs text-muted-foreground/50 mt-1">Files on disk will not be deleted.</span>
                        </DialogDescription>
                    </DialogHeader>
                    {deleteError && (
                        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 mt-2">{deleteError}</div>
                    )}
                    <DialogFooter className="mt-4 flex gap-2 sm:gap-2">
                        <Button variant="ghost" onClick={() => setIsDeleteDialogOpen(false)} className="flex-1 h-9" disabled={deletePending}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDelete} className="flex-1 h-9 font-semibold" disabled={deletePending}>
                            {deletePending ? 'Removing...' : 'Remove'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}


// --- File tree helpers (kept in same file for co-location) ---

type VisibleTreeEntry = { node: ProjectTreeNode; level: number; parentPath: string | null }

function injectTreeChildren(nodes: ProjectTreeNode[], targetPath: string, children: ProjectTreeNode[]): ProjectTreeNode[] {
    return nodes.map((node) => {
        if (node.path === targetPath) return { ...node, children }
        if (node.children?.length) return { ...node, children: injectTreeChildren(node.children, targetPath, children) }
        return node
    })
}

function filterTreeNodes(nodes: ProjectTreeNode[], query: string, showHidden: boolean): ProjectTreeNode[] {
    const q = query.trim().toLowerCase()
    return nodes
        .filter((n) => showHidden || !n.name.startsWith('.'))
        .flatMap((n) => {
            const kids = n.children ? filterTreeNodes(n.children, query, showHidden) : []
            const match = !q || n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)
            if (n.is_dir) return (match || kids.length || !q) ? [{ ...n, children: kids }] : []
            return match ? [n] : []
        })
}

function flattenVisibleTree(nodes: ProjectTreeNode[], expanded: Record<string, boolean>, level = 0, parent: string | null = null): VisibleTreeEntry[] {
    const out: VisibleTreeEntry[] = []
    for (const node of nodes) {
        out.push({ node, level, parentPath: parent })
        if (node.is_dir && expanded[node.path] && node.children?.length)
            out.push(...flattenVisibleTree(node.children, expanded, level + 1, node.path))
    }
    return out
}

function getNodeIcon(node: ProjectTreeNode, isOpen: boolean, tone: 'active' | 'default') {
    const cls = tone === 'active' ? 'text-primary' : 'text-muted-foreground/60'
    if (node.is_dir) return isOpen ? <FolderOpen size={13} className={cls} strokeWidth={1.75} /> : <FolderIcon size={13} className={cls} strokeWidth={1.75} />
    return <File size={13} className={cls} strokeWidth={1.75} />
}

function FileTree({ items, level = 0, expandedPaths, loadingPaths, onToggle, onFileClick, activeFile, focusedPath }: {
    items: ProjectTreeNode[]; level?: number; expandedPaths: Record<string, boolean>; loadingPaths: Record<string, boolean>
    onToggle: (n: ProjectTreeNode) => void | Promise<void>; onFileClick?: (p: string) => void; activeFile?: string | null; focusedPath?: string | null
}) {
    return (
        <div className="flex flex-col">{items.map((item, i) => {
            const isOpen = !!expandedPaths[item.path]
            const isActive = activeFile === item.path
            const isFocused = focusedPath === item.path
            const loading = !!loadingPaths[item.path]
            return (
                <React.Fragment key={`${item.path}-${i}`}>
                    <div
                        style={{ paddingLeft: `${level * 12 + 12}px` }}
                        className={`group relative flex items-center gap-2 h-7 pr-3 cursor-pointer transition-colors ${
                            isActive
                                ? 'bg-foreground/[0.06] text-foreground'
                                : isFocused
                                    ? 'bg-foreground/[0.03] text-foreground'
                                    : 'text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.03]'
                        }`}
                        onClick={() => item.is_dir ? void onToggle(item) : onFileClick?.(item.path)}
                    >
                        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />}
                        {item.is_dir ? (
                            loading
                                ? <RefreshCcw size={11} className="text-muted-foreground/40 animate-refresh-spin shrink-0" />
                                : <ChevronRight size={11} className={`text-muted-foreground/40 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                        ) : <span className="w-[11px] shrink-0" />}
                        {getNodeIcon(item, isOpen, isActive ? 'active' : 'default')}
                        <span className="truncate text-[12px] font-medium tracking-tight">{item.name}</span>
                    </div>
                    {isOpen && item.children?.length ? (
                        <FileTree items={item.children} level={level + 1} expandedPaths={expandedPaths} loadingPaths={loadingPaths}
                            onToggle={onToggle} onFileClick={onFileClick} activeFile={activeFile} focusedPath={focusedPath} />
                    ) : null}
                    {isOpen && item.is_dir && !item.children?.length && !loading && (
                        <div
                            style={{ paddingLeft: `${(level + 1) * 12 + 12}px` }}
                            className="h-6 flex items-center text-[10px] text-muted-foreground/40"
                        >
                            empty
                        </div>
                    )}
                </React.Fragment>
            )
        })}</div>
    )
}
