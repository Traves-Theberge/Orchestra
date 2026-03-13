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
            <Card className="h-44 bg-muted/50 border border-border/50 animate-pulse rounded-2xl">
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
    return (
        <Card
            onClick={() => onClick(project.id)}
            className="group relative overflow-hidden bg-card/40 backdrop-blur-md border border-border/50 transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl hover:shadow-primary/10 cursor-pointer h-44 flex flex-col justify-between shadow-lg hover:border-primary/30 rounded-2xl"
        >
            {/* Animated primary bar */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/50 via-primary to-transparent opacity-30 transition-opacity group-hover:opacity-100" />

            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 z-10 translate-y-1 group-hover:translate-y-0 flex gap-1">
                <AppTooltip content="Project Settings">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 bg-background/80 backdrop-blur border border-border/50 text-muted-foreground hover:text-foreground shadow-sm"
                        onClick={(e) => {
                            e.stopPropagation()
                            // Logic for settings could go here
                        }}
                    >
                        <Globe size={12} />
                    </Button>
                </AppTooltip>
                <AppTooltip content="Remove from workspace">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 bg-background/80 backdrop-blur border border-border/50 text-muted-foreground hover:text-destructive shadow-sm"
                        onClick={(e) => {
                            e.stopPropagation()
                            onDelete?.(project)
                        }}
                    >
                        <Trash2 size={12} />
                    </Button>
                </AppTooltip>
            </div>

            <CardHeader className="pb-2 text-left space-y-1">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-500 shadow-inner group-hover:shadow-primary/20">
                        <Folder className="w-4 h-4" strokeWidth={2.5} />
                    </div>
                    <CardTitle className="text-sm font-black tracking-tight group-hover:text-primary transition-colors text-left truncate">{project.name}</CardTitle>
                </div>
                <CardDescription className="text-[9px] text-muted-foreground/60 truncate font-mono ml-11 text-left">{project.root_path}</CardDescription>
            </CardHeader>

            {stats && (
                <CardContent className="space-y-3 mt-auto pt-3 border-t border-border/40 flex-1 text-left bg-muted/5 group-hover:bg-muted/10 transition-colors">
                    <div className="grid grid-cols-2 gap-4 text-left">
                        <div className="flex items-center gap-2 group/stat">
                            <div className="p-1 rounded bg-background border border-border/50 text-primary/70 group-hover/stat:text-primary transition-colors shadow-sm">
                                <History size={10} strokeWidth={3} />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black tabular-nums leading-none">{stats.total_sessions}</span>
                                <span className="text-[7px] uppercase font-bold text-muted-foreground/40 tracking-wider">Sessions</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 group/stat">
                            <div className="p-1 rounded bg-background border border-border/50 text-primary/70 group-hover/stat:text-primary transition-colors shadow-sm">
                                <Zap size={10} strokeWidth={3} />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black tabular-nums leading-none">{((stats.total_input + stats.total_output) / 1000).toFixed(1)}k</span>
                                <span className="text-[7px] uppercase font-bold text-muted-foreground/40 tracking-wider">Tokens</span>
                            </div>
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

const LOADING_PROJECT_PLACEHOLDER: Project = {
    id: '__loading__',
    name: 'Loading',
    root_path: '',
    remote_url: '',
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
                    <ProjectCard key={i} project={LOADING_PROJECT_PLACEHOLDER} loading onClick={() => { }} />
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
                <DialogContent className="sm:max-w-md bg-popover border-border">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
                            <Trash2 className="text-red-500" size={20} />
                            Remove Project
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground pt-2 text-left">
                            Are you sure you want to remove <span className="text-foreground font-bold">{projectToDelete?.name}</span> from your workspace?
                            <br /><br />
                            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/60">Project Path</span>
                            <div className="bg-muted/10 border border-border/40 p-2 rounded mt-1 font-mono text-[10px] text-muted-foreground truncate">
                                {projectToDelete?.root_path}
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-6">
                        <Button
                            variant="ghost"
                            onClick={() => setProjectToDelete(null)}
                            className="text-muted-foreground hover:text-foreground"
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
