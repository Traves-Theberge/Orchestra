import React, { useState } from 'react'
import { Folder, Globe, History, Search, Zap, Plus, Trash2 } from 'lucide-react'
import type { Project, ProjectStats } from '@/lib/orchestra-types'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { AppTooltip } from '../ui/tooltip-wrapper'

interface ProjectCardProps {
    project: Project
    stats?: ProjectStats
    loading?: boolean
    onClick: (id: string) => void
    onDelete?: (id: string) => void
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, stats, loading, onClick, onDelete }) => {
    if (loading) {
        return (
            <div className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl p-6 h-44 animate-pulse">
                <Skeleton className="h-6 w-3/4 mb-4" />
                <Skeleton className="h-4 w-1/2 mb-8" />
                <div className="flex gap-4">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-8 w-16" />
                </div>
            </div>
        )
    }

    return (
        <div
            onClick={() => onClick(project.id)}
            className="group relative overflow-hidden bg-background/40 backdrop-blur-md border border-white/10 rounded-xl p-6 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-primary/20 cursor-pointer h-44 flex flex-col justify-between shadow-sm"
        >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/50 to-transparent" />

            <div>
                <div className="flex items-start justify-between mb-2">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                        <Folder size={18} />
                    </div>
                    <div className="flex gap-1">
                        {project.remote_url && (
                            <AppTooltip content="Open Remote Repository">
                                <a
                                    href={project.remote_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-muted-foreground hover:text-primary transition-colors p-1"
                                >
                                    <Globe size={16} />
                                </a>
                            </AppTooltip>
                        )}
                        {onDelete && (
                            <AppTooltip content="Remove Project">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (confirm(`Remove project "${project.name}"?`)) {
                                            onDelete(project.id)
                                        }
                                    }}
                                    className="text-muted-foreground hover:text-red-500 transition-colors p-1"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </AppTooltip>
                        )}
                    </div>
                </div>

                <h3 className="text-lg font-bold mb-0.5 truncate group-hover:text-primary transition-colors">{project.name}</h3>
                <p className="text-[10px] text-muted-foreground mb-4 truncate font-mono opacity-60">{project.root_path}</p>
            </div>

            {stats && (
                <div className="grid grid-cols-2 gap-2 mt-auto pt-2 border-t border-white/5">
                    <div className="flex items-center gap-2">
                        <History size={12} className="text-primary/70" />
                        <span className="text-xs font-medium">{stats.total_sessions} Sessions</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Zap size={12} className="text-primary/70" />
                        <span className="text-xs font-medium">{((stats.total_input + stats.total_output) / 1000).toFixed(1)}k Tokens</span>
                    </div>
                </div>
            )}
        </div>
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

    const filtered = projects.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.root_path.toLowerCase().includes(search.toLowerCase())
    )

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
        <div className="flex flex-col h-full bg-background/20">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 sticky top-0 bg-background/60 backdrop-blur-xl z-20">
                <div className="relative w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                    <input
                        type="text"
                        placeholder="Search workspace..."
                        value={search}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 h-10 bg-black/40 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/40"
                    />
                </div>
                <AppTooltip content="Add Local Repository">
                    <Button variant="default" size="default" onClick={onAddProject} className="h-10 gap-2 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
                        <Plus size={18} />
                        <span className="font-semibold">Add Project</span>
                    </Button>
                </AppTooltip>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-32 text-center">
                        <div className="p-8 rounded-full bg-primary/5 mb-6 ring-1 ring-white/5">
                            <Folder size={64} className="text-muted-foreground/30" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2 tracking-tight">{search ? 'No matches found' : 'No Projects Discovered'}</h2>
                        <p className="text-muted-foreground/60 max-w-sm text-sm">
                            {search ? `We couldn't find any results for "${search}"` : 'Run an agent session in a Git repository to automatically populate your local Data Warehouse.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-6">
                        {filtered.map((project) => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                stats={stats[project.id]}
                                onClick={onProjectClick}
                                onDelete={onDeleteProject}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
