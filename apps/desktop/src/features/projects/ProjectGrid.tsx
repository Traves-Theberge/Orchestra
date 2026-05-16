import React, { useState, useMemo, useCallback } from 'react'
import {
  Folder, GitBranch, Search, Plus, Trash2,
  ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import type { Project, ProjectStats } from '@core/api/types'
import { Skeleton } from '@ui/skeleton'
import { Button } from '@ui/button'
import { useNow } from '@/hooks'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog'

const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6'] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function relativeTime(iso: string, now: number): string {
  if (!iso) return '—'
  if (!now) return ''
  const diff = now - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Sortable list view
// ---------------------------------------------------------------------------

type SortKey = 'name' | 'path' | 'sessions' | 'tokens' | 'active'
type SortDir = 'asc' | 'desc'

function SortHeader({ label, sortKey, currentKey, currentDir, onSort }: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  currentDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const active = currentKey === sortKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-[10px] font-bold tracking-tight transition-colors ${
        active ? 'text-foreground' : 'text-muted-foreground/50 hover:text-foreground'
      }`}
    >
      {label}
      {active ? (
        currentDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-0 group-hover/header:opacity-50" />
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

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
  onDeleteProject,
}) => {
  const [search, setSearch] = useState('')
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const now = useNow()

  const handleSort = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }, [sortKey])

  const sorted = useMemo(() => {
    const filtered = projects.filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.root_path.toLowerCase().includes(search.toLowerCase())
    )
    const dir = sortDir === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      const sa = stats[a.id]
      const sb = stats[b.id]
      switch (sortKey) {
        case 'name': return dir * a.name.localeCompare(b.name)
        case 'path': return dir * a.root_path.localeCompare(b.root_path)
        case 'sessions': return dir * ((sa?.total_sessions || 0) - (sb?.total_sessions || 0))
        case 'tokens': {
          const ta = (sa?.total_input || 0) + (sa?.total_output || 0)
          const tb = (sb?.total_input || 0) + (sb?.total_output || 0)
          return dir * (ta - tb)
        }
        case 'active': {
          const da = sa?.last_active ? new Date(sa.last_active).getTime() : 0
          const db = sb?.last_active ? new Date(sb.last_active).getTime() : 0
          return dir * (da - db)
        }
        default: return 0
      }
    })
    return filtered
  }, [projects, stats, search, sortKey, sortDir])

  const handleDeleteConfirm = () => {
    if (projectToDelete && onDeleteProject) {
      onDeleteProject(projectToDelete.id)
      setProjectToDelete(null)
    }
  }

  if (loading && projects.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-5">
        {SKELETON_KEYS.map((k) => (
          <div key={k} className="flex items-center gap-3 p-3 rounded-lg animate-pulse">
            <Skeleton className="size-8 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-8 pt-10 pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {sorted.length} {sorted.length === 1 ? 'project' : 'projects'}
        </p>
      </div>

      {/* Toolbar */}
      <div className="px-8 pb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 bg-muted/30 rounded-md text-[12px] font-medium placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all"
          />
        </div>
        <button
          onClick={onAddProject}
          className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[12px] font-semibold tracking-tight transition-colors"
        >
          <Plus size={13} />
          Add Project
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Folder size={28} className="text-muted-foreground/40 mb-3" strokeWidth={1.5} />
            <h2 className="text-base font-semibold tracking-tight mb-1">{search ? 'No matches' : 'No projects yet'}</h2>
            <p className="text-muted-foreground/60 max-w-xs text-xs">
              {search ? `Nothing matched "${search}"` : 'Add a local repository to get started.'}
            </p>
          </div>
        ) : (
          <div className="px-5">
            {/* Table header */}
            <div className="group/header flex items-center gap-3 px-3 h-8 text-muted-foreground/50">
              <div className="w-6" />
              <div className="flex-1 min-w-0">
                <SortHeader label="Name" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </div>
              <div className="w-48 hidden lg:block">
                <SortHeader label="Path" sortKey="path" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </div>
              <div className="w-20 text-right">
                <SortHeader label="Sessions" sortKey="sessions" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </div>
              <div className="w-20 text-right">
                <SortHeader label="Tokens" sortKey="tokens" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </div>
              <div className="w-20 text-right">
                <SortHeader label="Active" sortKey="active" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </div>
              <div className="w-7" />
            </div>

            {/* Rows */}
            <div className="flex flex-col">
              {sorted.map((project) => {
                const s = stats[project.id]
                const totalTokens = (s?.total_input || 0) + (s?.total_output || 0)
                const hasGit = !!project.remote_url
                return (
                  <div
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onProjectClick(project.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onProjectClick(project.id)
                      }
                    }}
                    className="group flex items-center gap-3 px-3 h-12 rounded-md cursor-pointer border border-border/30 bg-card/40 transition-colors hover:bg-foreground/[0.03] hover:border-border/60"
                  >
                    <Folder className="size-[15px] shrink-0 text-muted-foreground/60 group-hover:text-foreground transition-colors" strokeWidth={1.75} />

                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-[13px] font-semibold tracking-tight truncate text-foreground/90 group-hover:text-foreground">{project.name}</span>
                      {hasGit && <GitBranch className="size-3 shrink-0 text-muted-foreground/40" />}
                      {project.github_token ? (
                        <span className="text-[10px] font-medium text-primary/80">GitHub</span>
                      ) : project.github_owner ? (
                        <span className="text-[10px] font-medium text-amber-500/80">GitHub Detected</span>
                      ) : null}
                    </div>

                    <div className="w-48 hidden lg:block">
                      <span className="text-[11px] font-mono text-muted-foreground/50 truncate block">{project.root_path}</span>
                    </div>

                    <div className="w-20 text-right">
                      <span className="text-[12px] font-medium tabular-nums text-muted-foreground/70">{s?.total_sessions || 0}</span>
                    </div>

                    <div className="w-20 text-right">
                      <span className="text-[12px] font-medium tabular-nums text-muted-foreground/70">{formatTokens(totalTokens)}</span>
                    </div>

                    <div className="w-20 text-right">
                      <span className="text-[11px] text-muted-foreground/50">{relativeTime(s?.last_active || '', now)}</span>
                    </div>

                    <div className="w-7 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        className="size-6 grid place-items-center rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        data-testid="project-delete-btn"
                        onClick={(e) => { e.stopPropagation(); setProjectToDelete(project) }}
                        title="Remove project"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <DialogContent className="sm:max-w-lg bg-popover border-border p-8">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-foreground text-center">
              Remove Project
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-3 text-center text-sm leading-relaxed">
              Are you sure you want to remove <span className="text-foreground font-bold">{projectToDelete?.name}</span> from your workspace?
              <span className="block text-xs text-muted-foreground/50 mt-1">This will not delete any files on disk.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/20 border border-border/30 px-4 py-3 rounded-xl mt-4 font-mono text-xs text-muted-foreground/60 break-all">
            {projectToDelete?.root_path}
          </div>
          <DialogFooter className="mt-6 flex gap-3 sm:gap-3">
            <Button variant="ghost" onClick={() => setProjectToDelete(null)} className="flex-1 text-muted-foreground hover:text-foreground text-sm h-10">
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold text-sm h-10">
              Remove Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
