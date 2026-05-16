import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  GitBranch,
  Trash2,
  GitMerge,
  Plus,
  Search,
  RefreshCcw,
  ArrowUp,
  ArrowDown,
  Check,
  X,
  Star,
  Cloud,
} from 'lucide-react'
import type { BackendConfig, BranchDetail } from '@core/api/client'
import {
  fetchProjectGitBranchesDetail,
  gitCreateBranch,
  gitDeleteBranch,
  gitCheckout,
  gitMerge,
  gitFetch,
} from '@core/api/client'
import { useNow } from '@/hooks'

interface BranchManagerViewProps {
  config: BackendConfig
  projectId: string
}

type FilterMode = 'all' | 'local' | 'remote' | 'stale'

function relativeTime(dateStr: string, now: number): string {
  if (!dateStr || !now) return ''
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  if (diffMs < 0) return 'just now'
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function ageDays(dateStr: string, now: number): number {
  if (!dateStr || !now) return 0
  return (now - new Date(dateStr).getTime()) / 86400000
}

export function BranchManagerView({ config, projectId }: BranchManagerViewProps) {
  const [branches, setBranches] = useState<BranchDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('local')
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [mergeConfirm, setMergeConfirm] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [currentBranch, setCurrentBranch] = useState('')
  const now = useNow()

  const loadBranches = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await fetchProjectGitBranchesDetail(config, projectId)
      setBranches(data.branches || [])
      setCurrentBranch(data.current || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load branches')
      setTimeout(() => setError(''), 5000)
    } finally { setLoading(false) }
  }, [config, projectId])

  useEffect(() => { loadBranches() }, [loadBranches])

  const handleFetch = useCallback(async () => {
    setLoading(true); setError('')
    try { await gitFetch(config, projectId); await loadBranches() }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed')
      setTimeout(() => setError(''), 5000)
    } finally { setLoading(false) }
  }, [config, projectId, loadBranches])

  const handleCheckout = useCallback(async (branch: string) => {
    setLoading(true); setError('')
    try { await gitCheckout(config, projectId, branch); await loadBranches() }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setTimeout(() => setError(''), 5000)
    } finally { setLoading(false) }
  }, [config, projectId, loadBranches])

  const handleDelete = useCallback(async (branch: string) => {
    setDeleteConfirm(null); setLoading(true); setError('')
    try { await gitDeleteBranch(config, projectId, branch); await loadBranches() }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setTimeout(() => setError(''), 5000)
    } finally { setLoading(false) }
  }, [config, projectId, loadBranches])

  const handleMerge = useCallback(async (branch: string) => {
    setMergeConfirm(null); setLoading(true); setError('')
    try { await gitMerge(config, projectId, branch); await loadBranches() }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed')
      setTimeout(() => setError(''), 5000)
    } finally { setLoading(false) }
  }, [config, projectId, loadBranches])

  const handleCreate = useCallback(async () => {
    const name = newBranchName.trim()
    if (!name) return
    setLoading(true); setError('')
    try {
      if (baseBranch && baseBranch !== currentBranch) {
        await gitCheckout(config, projectId, baseBranch)
      }
      await gitCreateBranch(config, projectId, name)
      setCreateOpen(false); setNewBranchName(''); setBaseBranch('')
      await loadBranches()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create branch failed')
      setTimeout(() => setError(''), 5000)
    } finally { setLoading(false) }
  }, [config, projectId, newBranchName, baseBranch, currentBranch, loadBranches])

  const current = useMemo(() => branches.find((b) => b.is_current) ?? null, [branches])
  const localBranches = useMemo(() => branches.filter((b) => !b.is_remote), [branches])
  const remoteBranches = useMemo(() => branches.filter((b) => b.is_remote), [branches])
  const staleBranches = useMemo(
    () => branches.filter((b) => !b.is_remote && !b.is_current && !b.is_default && ageDays(b.last_commit_date, now) > 30),
    [branches, now],
  )

  const localBranchNames = useMemo(() => localBranches.map((b) => b.name), [localBranches])

  const filtered = useMemo(() => {
    let pool: BranchDetail[]
    switch (filter) {
      case 'local': pool = localBranches.filter((b) => !b.is_current); break
      case 'remote': pool = remoteBranches; break
      case 'stale': pool = staleBranches; break
      case 'all':
      default: pool = branches.filter((b) => !b.is_current); break
    }
    pool = pool.toSorted((a, b) => {
      const da = new Date(a.last_commit_date).getTime() || 0
      const db = new Date(b.last_commit_date).getTime() || 0
      return db - da
    })
    if (!search) return pool
    const q = search.toLowerCase()
    return pool.filter((b) => b.name.toLowerCase().includes(q) || (b.last_commit_message ?? '').toLowerCase().includes(q))
  }, [filter, branches, localBranches, remoteBranches, staleBranches, search])

  const filterCounts: Record<FilterMode, number> = {
    all: branches.filter((b) => !b.is_current).length,
    local: localBranches.filter((b) => !b.is_current).length,
    remote: remoteBranches.length,
    stale: staleBranches.length,
  }

  const filterTabs: { id: FilterMode; label: string }[] = [
    { id: 'local', label: 'Local' },
    { id: 'remote', label: 'Remote' },
    { id: 'stale', label: 'Stale' },
    { id: 'all', label: 'All' },
  ]

  return (
    <Shell>
      {error && (
        <div className="mb-6 px-3 py-2 rounded-md bg-destructive/[0.06] border border-destructive/20 text-[11.5px] text-destructive flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-destructive/70 hover:text-destructive">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="space-y-12">
        {/* Hero — current branch */}
        {current && (
          <header className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">On branch</p>
            <h1 className="text-4xl font-semibold tracking-tight font-mono truncate">{current.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground/70">
              {current.is_default && (
                <span className="inline-flex items-center gap-1 text-primary font-medium">
                  <Star size={10} strokeWidth={2.5} />
                  default
                </span>
              )}
              {(current.ahead > 0 || current.behind > 0) ? (
                <>
                  {current.ahead > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-500 font-medium tabular-nums">
                      <ArrowUp size={10} strokeWidth={2.5} />
                      {current.ahead} ahead
                    </span>
                  )}
                  {current.behind > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-amber-500 font-medium tabular-nums">
                      <ArrowDown size={10} strokeWidth={2.5} />
                      {current.behind} behind
                    </span>
                  )}
                </>
              ) : (
                <span>Up to date</span>
              )}
              {current.last_commit_date && (
                <span className="tabular-nums">{relativeTime(current.last_commit_date, now)}</span>
              )}
            </div>
            {current.last_commit_message && (
              <p className="text-[12.5px] text-muted-foreground/80 truncate" title={current.last_commit_message}>
                {current.last_commit_message}
              </p>
            )}
          </header>
        )}

        {/* Toolbar */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter branches…"
                className="w-full h-8 pl-8 pr-3 rounded-md bg-muted/30 text-[12.5px] font-medium tracking-tight placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 transition-all"
              />
            </div>
            <button
              onClick={handleFetch}
              disabled={loading}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11.5px] font-medium tracking-tight text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] disabled:opacity-40 transition-colors"
              title="Fetch from remote"
            >
              <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} />
              Fetch
            </button>
            <button
              onClick={() => {
                setCreateOpen((v) => !v)
                if (!createOpen && !baseBranch) setBaseBranch(currentBranch)
              }}
              disabled={loading}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium tracking-tight bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 transition-colors"
            >
              <Plus size={12} strokeWidth={2.5} />
              New branch
            </button>
          </div>

          <div className="flex items-center gap-1 px-1">
            {filterTabs.map((t) => {
              const isActive = filter === t.id
              const count = filterCounts[t.id]
              return (
                <button
                  key={t.id}
                  onClick={() => setFilter(t.id)}
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium tracking-tight transition-colors ${
                    isActive
                      ? 'bg-foreground/[0.06] text-foreground'
                      : 'text-muted-foreground/65 hover:text-foreground hover:bg-foreground/[0.03]'
                  }`}
                >
                  {t.label}
                  <span className={`text-[10.5px] tabular-nums ${isActive ? 'text-muted-foreground/65' : 'text-muted-foreground/45'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {createOpen && (
            <div className="p-3 rounded-md bg-foreground/[0.02] border border-border/40">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') { setCreateOpen(false); setNewBranchName('') }
                  }}
                  placeholder="branch-name"
                  className="flex-1 min-w-[160px] h-8 px-3 rounded-md bg-background font-mono text-[12.5px] placeholder:text-muted-foreground/50 outline-none ring-1 ring-border/60 focus:ring-primary/50 transition-all"
                />
                <span className="text-[11.5px] text-muted-foreground/60">from</span>
                <select
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="h-8 px-2.5 rounded-md bg-background font-mono text-[11.5px] outline-none ring-1 ring-border/60 focus:ring-primary/50 transition-all"
                >
                  {localBranchNames.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <button
                  onClick={handleCreate}
                  disabled={loading || !newBranchName.trim()}
                  className="inline-flex items-center h-8 px-3 rounded-md text-[11.5px] font-medium tracking-tight bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 transition-colors"
                >
                  Create
                </button>
                <button
                  onClick={() => { setCreateOpen(false); setNewBranchName(''); setBaseBranch('') }}
                  className="inline-flex items-center h-8 px-2.5 rounded-md text-[11.5px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Branch list */}
        <List label={`${filter === 'all' ? 'Branches' : filter === 'stale' ? 'Stale' : filter === 'remote' ? 'Remote' : 'Local'} · ${filtered.length}`}>
          {filtered.length > 0 ? (
            filtered.map((branch) => (
              <BranchRow
                key={`${branch.is_remote ? 'r' : 'l'}-${branch.name}`}
                branch={branch}
                currentBranch={currentBranch}
                deleteConfirm={deleteConfirm}
                mergeConfirm={mergeConfirm}
                loading={loading}
                now={now}
                onCheckout={handleCheckout}
                onDelete={handleDelete}
                onMerge={handleMerge}
                onDeleteConfirm={setDeleteConfirm}
                onMergeConfirm={setMergeConfirm}
              />
            ))
          ) : (
            <p className="px-2 py-4 text-[12px] text-muted-foreground/55">
              {search ? 'No branches match your filter.' : `No ${filter === 'all' ? 'other' : filter} branches.`}
            </p>
          )}
        </List>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-auto bg-background">
      <div className="min-h-full px-10 py-16">
        <div className="w-full max-w-xl mx-auto">{children}</div>
      </div>
    </div>
  )
}

function List({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 px-1">{label}</p>
      <div className="-mx-2">{children}</div>
    </section>
  )
}

function BranchRow({
  branch,
  currentBranch,
  deleteConfirm,
  mergeConfirm,
  loading,
  now,
  onCheckout,
  onDelete,
  onMerge,
  onDeleteConfirm,
  onMergeConfirm,
}: {
  branch: BranchDetail
  currentBranch: string
  deleteConfirm: string | null
  mergeConfirm: string | null
  loading: boolean
  now: number
  onCheckout: (name: string) => void
  onDelete: (name: string) => void
  onMerge: (name: string) => void
  onDeleteConfirm: (name: string | null) => void
  onMergeConfirm: (name: string | null) => void
}) {
  const isDefault = branch.is_default
  const canDelete = !branch.is_current && !isDefault
  const isStale = !branch.is_remote && !branch.is_current && !isDefault && ageDays(branch.last_commit_date, now) > 30

  if (deleteConfirm === branch.name) {
    return (
      <div className="mx-2 px-3 py-2.5 rounded-md bg-destructive/[0.06] flex items-center gap-2">
        <span className="text-[12px] text-foreground/85 flex-1">
          Delete <span className="font-mono font-semibold">{branch.name}</span>?
        </span>
        <button
          onClick={() => onDelete(branch.name)}
          disabled={loading}
          className="inline-flex items-center h-7 px-2.5 rounded-md text-[11px] font-medium tracking-tight bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
        >
          Delete
        </button>
        <button
          onClick={() => onDeleteConfirm(null)}
          className="inline-flex items-center h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  if (mergeConfirm === branch.name) {
    return (
      <div className="mx-2 px-3 py-2.5 rounded-md bg-primary/[0.06] flex items-center gap-2">
        <span className="text-[12px] text-foreground/85 flex-1">
          Merge <span className="font-mono font-semibold">{branch.name}</span> into <span className="font-mono font-semibold">{currentBranch}</span>?
        </span>
        <button
          onClick={() => onMerge(branch.name)}
          disabled={loading}
          className="inline-flex items-center h-7 px-2.5 rounded-md text-[11px] font-medium tracking-tight bg-foreground text-background hover:bg-foreground/90 transition-colors"
        >
          Merge
        </button>
        <button
          onClick={() => onMergeConfirm(null)}
          className="inline-flex items-center h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  const Icon = branch.is_remote ? Cloud : GitBranch

  return (
    <div
      role="button"
      tabIndex={0}
      onDoubleClick={() => !branch.is_current && onCheckout(branch.name)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !branch.is_current) {
          e.preventDefault()
          onCheckout(branch.name)
        }
      }}
      className="group flex items-center gap-3 w-full px-2 py-2.5 rounded-md hover:bg-accent/50 transition-colors text-left cursor-pointer"
    >
      <span className={`shrink-0 transition-colors ${
        isStale ? 'text-amber-500/80' : 'text-muted-foreground/70 group-hover:text-foreground'
      }`}>
        <Icon size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="block text-[13px] font-semibold truncate font-mono text-foreground">{branch.name}</span>
          {isDefault && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary shrink-0">
              <Star size={9} strokeWidth={2.5} />
              default
            </span>
          )}
          {!branch.is_remote && (branch.ahead > 0 || branch.behind > 0) && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tabular-nums shrink-0">
              {branch.ahead > 0 && (
                <span className="inline-flex items-center gap-0.5 text-emerald-500">
                  <ArrowUp size={9} strokeWidth={2.5} />
                  {branch.ahead}
                </span>
              )}
              {branch.behind > 0 && (
                <span className="inline-flex items-center gap-0.5 text-amber-500">
                  <ArrowDown size={9} strokeWidth={2.5} />
                  {branch.behind}
                </span>
              )}
            </span>
          )}
        </span>
        {branch.last_commit_message && (
          <span className="block text-[10.5px] text-muted-foreground/55 truncate mt-0.5">
            {branch.last_commit_message}
            {branch.last_commit_date && (
              <span className="text-muted-foreground/40 tabular-nums"> · {relativeTime(branch.last_commit_date, now)}</span>
            )}
          </span>
        )}
      </span>

      <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onCheckout(branch.name) }}
          className="inline-flex items-center size-6 justify-center rounded text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors"
          title="Checkout"
        >
          <Check size={12} strokeWidth={2.5} />
        </button>
        {!branch.is_current && !branch.is_remote && (
          <button
            onClick={(e) => { e.stopPropagation(); onMergeConfirm(branch.name) }}
            className="inline-flex items-center size-6 justify-center rounded text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors"
            title={`Merge into ${currentBranch}`}
          >
            <GitMerge size={12} strokeWidth={2.5} />
          </button>
        )}
        {canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteConfirm(branch.name) }}
            className="inline-flex items-center size-6 justify-center rounded text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Delete branch"
          >
            <Trash2 size={12} strokeWidth={2.25} />
          </button>
        )}
      </span>
    </div>
  )
}
