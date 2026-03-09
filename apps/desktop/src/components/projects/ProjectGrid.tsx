import React, { useState } from 'react'
import { Folder, Globe, History, Search, Zap, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Project, ProjectStats } from '@/lib/orchestra-types'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppTooltip } from '../ui/tooltip-wrapper'

interface ProjectCardProps {
    project: Project
    stats?: ProjectStats
    loading?: boolean
    onClick: (id: string) => void
    onDelete?: (id: string) => void
}

const calculateStabilityScore = (stats?: ProjectStats): number => {
    if (!stats || stats.total_sessions === 0) return 100
    const finished = stats.success_count + stats.failure_count
    if (finished === 0) return 100
    return Math.round((stats.success_count / finished) * 100)
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
    const stability = calculateStabilityScore(stats)

    return (
        <Card
            onClick={() => onClick(project.id)}
            className="group relative overflow-hidden bg-gradient-to-br from-card/40 via-card/30 to-card/20 backdrop-blur-md border border-border/50 transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl hover:shadow-primary/20 cursor-pointer h-40 flex flex-col justify-between shadow-lg hover:ring-1 hover:ring-primary/30"
        >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/50 to-transparent" />

            <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                    <Folder className="w-4 h-4 text-primary/60 shrink-0" />
                    <CardTitle className="text-sm font-bold truncate group-hover:text-primary transition-colors">{project.name}</CardTitle>
                </div>
                <CardDescription className="text-[9px] text-muted-foreground truncate font-mono opacity-50 ml-6">{project.root_path}</CardDescription>
            </CardHeader>

            {stats && (
                <CardContent className="space-y-3 mt-auto pt-3 border-t border-border/40 flex-1">
                    <div className="space-y-1">
                        <div className="flex items-center justify-between text-[9px] uppercase font-black tracking-widest text-muted-foreground/60">
                            <span>Stability</span>
                            <span className={stability > 80 ? 'text-emerald-500' : stability > 50 ? 'text-amber-500' : 'text-red-500'}>
                                {stability}%
                            </span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-1000 ${stability > 80 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' :
                                    stability > 50 ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]' :
                                        'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'
                                    }`}
                                style={{ width: `${stability}%` }}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
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
    const [currentPage, setCurrentPage] = useState(1)
    const ITEMS_PER_PAGE = 8

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
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-3">
                            {currentItems.map((project) => (
                                <ProjectCard
                                    key={project.id}
                                    project={project}
                                    stats={stats[project.id]}
                                    onClick={onProjectClick}
                                    onDelete={onDeleteProject}
                                />
                            ))}
                        </div>
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
        </div>
    )
}
