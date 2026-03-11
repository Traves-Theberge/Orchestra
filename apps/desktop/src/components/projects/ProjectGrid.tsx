import React, { useState } from 'react'
import { Folder, Globe, History, Search, Zap, Plus, Trash2, ChevronLeft, ChevronRight, LayoutGrid, List } from 'lucide-react'
import type { Project, ProjectStats } from '@/lib/orchestra-types'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppTooltip } from '../ui/tooltip-wrapper'

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

interface ProjectCardProps {
    project: Project
    stats?: ProjectStats
    loading?: boolean
    onClick: (id: string) => void
    onDelete?: (project: Project) => void
}

const calculateReliabilityIndex = (stats?: ProjectStats): number => {
    if (!stats || stats.total_sessions === 0) return 100
    const finished = stats.success_count + stats.failure_count
    if (finished === 0) return 100
    return Math.round((stats.success_count / finished) * 100)
}

const ProjectListRow: React.FC<ProjectCardProps> = ({ project, stats, loading, onClick, onDelete }) => {
    if (loading) {
        return (
            <div className="flex items-center gap-4 p-4 bg-muted/20 border border-border/40 rounded-xl animate-pulse h-16">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/4" />
                    <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
            </div>
        )
    }

    const reliability = calculateReliabilityIndex(stats)

    return (
        <div
            onClick={() => onClick(project.id)}
            className="group flex items-center gap-4 p-3 rounded-xl border border-border/40 bg-card/20 hover:bg-primary/5 hover:border-primary/30 transition-all cursor-pointer"
        >
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                <Folder className="w-5 h-5 text-primary/60" />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold truncate group-hover:text-primary transition-colors">{project.name}</h3>
                    <span className="text-[10px] text-muted-foreground/40 font-mono truncate">{project.root_path}</span>
                </div>
                <div className="flex items-center gap-4 mt-0.5">
                    <div className="flex items-center gap-1.5">
                        <History size={10} className="text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground font-medium">{stats?.total_sessions || 0} Sessions</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Zap size={10} className="text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground font-medium">{(((stats?.total_input || 0) + (stats?.total_output || 0)) / 1000).toFixed(1)}k Tokens</span>
                    </div>
                </div>
            </div>

            <div className="w-48 flex flex-col gap-1 px-4">
                <div className="flex items-center justify-between text-[8px] uppercase font-black tracking-widest text-muted-foreground/40">
                    <span>Reliability Index</span>
                    <span className={reliability > 80 ? 'text-emerald-500' : reliability > 50 ? 'text-amber-500' : 'text-red-500'}>{reliability}%</span>
                </div>
                <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-1000 ${reliability > 80 ? 'bg-emerald-500' : reliability > 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${reliability}%` }}
                    />
                </div>
            </div>

            <div className="pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 text-muted-foreground hover:text-red-500"
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete?.(project)
                    }}
                >
                    <Trash2 size={14} />
                </Button>
            </div>
        </div>
    )
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, stats, loading, onClick, onDelete }) => {
    if (loading) {
        return (
            <Card className="h-40 bg-muted/50 border border-border/50 animate-pulse">
                <CardHeader className="pb-2">
                    <Skeleton className="h-4 w-3/4 mb-1" />
                    <Skeleton className="h-3 w-1/2" />
                </CardHeader>
                <CardContent className="space-y-3 pt-3 border-t border-border/40">
                    <Skeleton className="h-2 w-full" />
                    <div className="grid grid-cols-2 gap-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-full" />
                    </div>
                </CardContent>
            </Card>
        );
    }
    const reliability = calculateReliabilityIndex(stats)

    return (
        <Card
            onClick={() => onClick(project.id)}
            className="group relative overflow-hidden bg-gradient-to-br from-card/40 via-card/30 to-card/20 backdrop-blur-md border border-border/50 transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl hover:shadow-primary/20 cursor-pointer h-40 flex flex-col justify-between shadow-lg hover:ring-1 hover:ring-primary/30 text-left"
        >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/50 to-transparent" />

            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete?.(project)
                    }}
                >
                    <Trash2 size={14} />
                </Button>
            </div>

            <CardHeader className="pb-2 text-left">
                <div className="flex items-center gap-2">
                    <Folder className="w-4 h-4 text-primary/60 shrink-0" />
                    <CardTitle className="text-sm font-bold truncate group-hover:text-primary transition-colors text-left">{project.name}</CardTitle>
                </div>
                <CardDescription className="text-[9px] text-muted-foreground truncate font-mono opacity-50 ml-6 text-left">{project.root_path}</CardDescription>
            </CardHeader>

            {stats && (
                <CardContent className="space-y-3 mt-auto pt-3 border-t border-border/40 flex-1 text-left">
                    <div className="space-y-1">
                        <div className="flex items-center justify-between text-[9px] uppercase font-black tracking-widest text-muted-foreground/60">
                            <span>Reliability Index</span>
                            <span className={reliability > 80 ? 'text-emerald-500' : reliability > 50 ? 'text-amber-500' : 'text-red-500'}>
                                {reliability}%
                            </span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-1000 ${reliability > 80 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' :
                                    reliability > 50 ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]' :
                                        'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'
                                    }`}
                                style={{ width: `${reliability}%` }}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-left">
                        <div className="flex items-center gap-2">
                            <History size={12} className="text-primary/70" />
                            <span className="text-xs font-medium">{stats.total_sessions} Sessions</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Zap size={12} className="text-primary/70" />
                            <span className="text-xs font-medium">{((stats.total_input + stats.total_output) / 1000).toFixed(1)}k Tokens</span>
                        </div>
                    </div>
                </CardContent>
            )}
        </Card>
    )
}

interface ProjectGridProps {
    projects: Project[]
    stats: Record<string, ProjectStats>
    loading: boolean
    onProjectClick: (id: string) => void
    onAddProject?: () => void
    onDeleteProject?: (id: string) => void
}

export const ProjectGrid: React.FC<ProjectGridProps> = ({
    projects,
    stats,
    loading,
    onProjectClick,
    onAddProject,
    onDeleteProject
}) => {
    const [search, setSearch] = useState('')
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [currentPage, setCurrentPage] = useState(1)
    const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
    const ITEMS_PER_PAGE = 12

    const filtered = projects.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.root_path.toLowerCase().includes(search.toLowerCase())
    )

    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
    const currentItems = filtered.slice(startIndex, startIndex + ITEMS_PER_PAGE)

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearch(e.target.value)
        setCurrentPage(1)
    }

    const handleDeleteConfirm = () => {
        if (projectToDelete && onDeleteProject) {
            onDeleteProject(projectToDelete.id)
            setProjectToDelete(null)
        }
    }

    if (loading && projects.length === 0) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <ProjectCard key={i} project={{} as any} loading onClick={() => { }} />
                ))}
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-transparent">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-background/80 backdrop-blur-xl z-20">
                <div className="flex items-center gap-4">
                    <div className="relative w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                        <input
                            type="text"
                            placeholder="Search workspace..."
                            value={search}
                            onChange={handleSearchChange}
                            className="w-full pl-10 pr-4 h-10 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/60"
                        />
                    </div>

                    <div className="flex items-center bg-muted/30 p-1 rounded-xl border border-border/50 shadow-inner">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 w-8 p-0 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                            onClick={() => setViewMode('grid')}
                            tooltip="Grid View"
                        >
                            <LayoutGrid size={16} />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 w-8 p-0 rounded-lg transition-all ${viewMode === 'list' ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                            onClick={() => setViewMode('list')}
                            tooltip="List View"
                        >
                            <List size={16} />
                        </Button>
                    </div>
                </div>

                <AppTooltip content="Add Local Repository">
                    <Button variant="default" size="default" onClick={onAddProject} className="h-9 gap-2 bg-primary text-xs hover:bg-primary/90 shadow-lg shadow-primary/20">
                        <Plus size={16} />
                        <span className="font-bold uppercase tracking-widest text-[10px]">Add Project</span>
                    </Button>
                </AppTooltip>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden min-h-0 custom-scrollbar">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-32 text-center">
                        <div className="p-8 rounded-full bg-primary/10 mb-6 ring-1 ring-border/50">
                            <Folder size={64} className="text-muted-foreground/30" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2 tracking-tight">{search ? 'No matches found' : 'No Projects Discovered'}</h2>
                        <p className="text-muted-foreground/60 max-w-sm text-sm">
                            {search ? `We couldn't find any results for "${search}"` : 'Run an agent session in a Git repository to automatically populate your local Data Warehouse.'}
                        </p>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col justify-between">
                        {viewMode === 'grid' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-3">
                                {currentItems.map((project) => (
                                    <ProjectCard
                                        key={project.id}
                                        project={project}
                                        stats={stats[project.id]}
                                        onClick={onProjectClick}
                                        onDelete={setProjectToDelete}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2 p-3">
                                {currentItems.map((project) => (
                                    <ProjectListRow
                                        key={project.id}
                                        project={project}
                                        stats={stats[project.id]}
                                        onClick={onProjectClick}
                                        onDelete={setProjectToDelete}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {totalPages > 1 && filtered.length > 0 && (
                <div className="flex items-center justify-between px-8 py-3 border-t border-border/50 bg-background/5">
                    <div className="text-sm text-muted-foreground/80 font-medium">
                        Showing <span className="font-mono text-foreground">{startIndex + 1}</span>–<span className="font-mono text-foreground">{Math.min(startIndex + ITEMS_PER_PAGE, filtered.length)}</span> <span className="opacity-40 mx-1">/</span> <span className="font-mono text-foreground">{filtered.length}</span> projects
                    </div>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="h-9 w-9 p-0 border-border/40 hover:bg-primary/10 hover:text-primary transition-all duration-300 disabled:opacity-30"
                        >
                            <ChevronLeft size={18} />
                        </Button>

                        <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-full bg-muted/30 border border-border/20">
                            {[...Array(totalPages)].map((_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setCurrentPage(i + 1)}
                                    className={`h-8 min-w-[32px] px-2 rounded-full text-xs font-bold transition-all duration-300 ${currentPage === i + 1
                                        ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/25 scale-105'
                                        : 'hover:bg-primary/10 text-muted-foreground hover:text-primary'
                                        }`}
                                >
                                    {i + 1}
                                </button>
                            ))}
                        </div>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="h-9 w-9 p-0 border-border/40 hover:bg-primary/10 hover:text-primary transition-all duration-300 disabled:opacity-30"
                        >
                            <ChevronRight size={18} />
                        </Button>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
                <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
                            <Trash2 className="text-red-500" size={20} />
                            Remove Project
                        </DialogTitle>
                        <DialogDescription className="text-zinc-400 pt-2 text-left">
                            Are you sure you want to remove <span className="text-white font-bold">{projectToDelete?.name}</span> from your workspace?
                            <br /><br />
                            <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">Project Path</span>
                            <div className="bg-black/40 border border-white/5 p-2 rounded mt-1 font-mono text-[10px] text-zinc-300 truncate">
                                {projectToDelete?.root_path}
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-6">
                        <Button
                            variant="ghost"
                            onClick={() => setProjectToDelete(null)}
                            className="text-zinc-400 hover:text-white"
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDeleteConfirm}
                            className="bg-red-600 hover:bg-red-500 text-white font-bold"
                        >
                            Remove Project
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
