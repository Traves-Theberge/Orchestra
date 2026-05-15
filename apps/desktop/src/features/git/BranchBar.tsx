import { useState, useRef, useEffect } from 'react'
import { GitBranch, ChevronDown, Archive, ArrowDownToLine, ArrowDown, ArrowUp, RefreshCcw, Plus } from 'lucide-react'
import type { BackendConfig, StashEntry } from '@core/api/client'
import { gitCheckout, gitCreateBranch, gitStash, gitStashPop } from '@core/api/client'
import { StashPanel } from './StashPanel'
import { AppTooltip } from '@ui/tooltip-wrapper'

interface BranchBarProps {
  projectId: string
  config: BackendConfig
  currentBranch: string
  branches: string[]
  remoteBranches?: string[]
  aheadBehind?: { ahead: number; behind: number }
  onBranchChange: () => void
  onPush?: () => void
  onPull?: () => void
  onFetch?: () => void
  onMerge?: (branch: string) => void
  onDeleteBranch?: (branch: string) => void
  stashes?: StashEntry[]
  onStashApply?: (ref: string) => void
  onStashDrop?: (ref: string) => void
}

export function BranchBar({
  projectId,
  config,
  currentBranch,
  branches,
  remoteBranches,
  aheadBehind,
  onBranchChange,
  onPush,
  onPull,
  onFetch,
  onMerge,
  onDeleteBranch,
  stashes,
  onStashApply,
  onStashDrop,
}: BranchBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [stashOpen, setStashOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmAction, setConfirmAction] = useState<{ type: 'delete' | 'merge'; branch: string } | null>(null)
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stashRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setCreating(false)
        setNewName('')
        setConfirmAction(null)
      }
      if (stashRef.current && !stashRef.current.contains(e.target as Node)) {
        setStashOpen(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDropdownOpen(false)
        setStashOpen(false)
        setCreating(false)
        setNewName('')
        setConfirmAction(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  async function handleCheckout(branch: string) {
    if (branch === currentBranch || loading) return
    setLoading(true)
    setError('')
    try {
      await gitCheckout(config, projectId, branch)
      setDropdownOpen(false)
      onBranchChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setTimeout(() => setError(''), 4000)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    const name = newName.trim()
    if (!name || loading) return
    setLoading(true)
    setError('')
    try {
      await gitCreateBranch(config, projectId, name)
      setCreating(false)
      setNewName('')
      setDropdownOpen(false)
      onBranchChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create branch failed')
      setTimeout(() => setError(''), 4000)
    } finally {
      setLoading(false)
    }
  }

  async function handleStash() {
    setStashOpen(false)
    setLoading(true)
    try {
      await gitStash(config, projectId)
      onBranchChange()
    } catch (err) {
      console.error('stash failed', err)
    } finally {
      setLoading(false)
    }
  }

  async function _handleStashPop() {
    setStashOpen(false)
    setLoading(true)
    try {
      await gitStashPop(config, projectId)
      onBranchChange()
    } catch (err) {
      console.error('stash pop failed', err)
    } finally {
      setLoading(false)
    }
  }

  function handleDeleteConfirm(branch: string) {
    setConfirmAction(null)
    onDeleteBranch?.(branch)
  }

  function handleMergeConfirm(branch: string) {
    setConfirmAction(null)
    onMerge?.(branch)
  }

  const iconBtn = 'inline-flex items-center justify-center size-7 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-40 relative'

  return (
    <div className="flex items-center gap-1 px-2 shrink-0 relative">
      {error && (
        <div className="absolute top-full left-0 right-0 z-10 px-3 py-1.5 bg-destructive/10 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {/* Branch dropdown trigger */}
      <div className="relative" ref={dropdownRef}>
        <button
          data-testid="branch-trigger"
          onClick={() => setDropdownOpen((v) => !v)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md hover:bg-foreground/[0.04] text-[11.5px] font-medium tracking-tight transition-colors"
          title={currentBranch}
        >
          <GitBranch size={12} className="text-primary shrink-0" strokeWidth={2.25} />
          <span className="font-mono text-foreground/90 truncate max-w-[180px]">{currentBranch || '…'}</span>
          {aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
            <span className="inline-flex items-center gap-1 ml-0.5 tabular-nums text-[10.5px] font-medium">
              {aheadBehind.ahead > 0 && (
                <span className="inline-flex items-center gap-px text-emerald-500">
                  <ArrowUp size={9} strokeWidth={2.5} />
                  {aheadBehind.ahead}
                </span>
              )}
              {aheadBehind.behind > 0 && (
                <span className="inline-flex items-center gap-px text-amber-500">
                  <ArrowDown size={9} strokeWidth={2.5} />
                  {aheadBehind.behind}
                </span>
              )}
            </span>
          )}
          <ChevronDown size={11} className="text-muted-foreground/55" />
        </button>

        {dropdownOpen && (
          <div className="absolute left-0 top-full mt-1.5 bg-popover border border-border/60 rounded-lg shadow-xl py-2 z-50 min-w-[280px] max-h-[360px] overflow-y-auto">
            {/* Local */}
            <div className="px-3 pb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">Local</span>
              <span className="ml-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/40">{branches.length}</span>
            </div>
            <div className="px-1">
              {branches.map((branch) =>
                confirmAction?.branch === branch ? (
                  <div key={branch} data-testid={`branch-row-${branch}`} className="px-3 py-2 rounded-md bg-foreground/[0.04] flex items-center gap-2">
                    <span className="text-[12px] text-foreground/85 truncate flex-1">
                      {confirmAction.type === 'delete'
                        ? <>Delete <span className="font-mono font-semibold">{branch}</span>?</>
                        : <>Merge <span className="font-mono font-semibold">{branch}</span> → <span className="font-mono font-semibold">{currentBranch}</span>?</>}
                    </span>
                    <button
                      onClick={() => confirmAction.type === 'delete' ? handleDeleteConfirm(branch) : handleMergeConfirm(branch)}
                      className={`inline-flex items-center h-6 px-2 rounded text-[10.5px] font-medium tracking-tight transition-colors ${
                        confirmAction.type === 'delete'
                          ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                          : 'bg-foreground text-background hover:bg-foreground/90'
                      }`}
                    >
                      {confirmAction.type === 'delete' ? 'Delete' : 'Merge'}
                    </button>
                    <button
                      onClick={() => setConfirmAction(null)}
                      className="inline-flex items-center h-6 px-2 rounded text-[10.5px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div
                    key={branch}
                    data-testid={`branch-row-${branch}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleCheckout(branch)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCheckout(branch) } }}
                    onMouseEnter={() => setHoveredBranch(branch)}
                    onMouseLeave={() => setHoveredBranch(null)}
                    className={`group flex items-center gap-2 w-full px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                      branch === currentBranch ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]'
                    }`}
                  >
                    {branch === currentBranch ? (
                      <span data-testid="green-dot" className="inline-block size-1.5 rounded-full bg-emerald-500 shrink-0" />
                    ) : (
                      <span className="inline-block size-1.5 shrink-0" />
                    )}
                    <span className={`min-w-0 flex-1 font-mono text-[12.5px] truncate ${
                      branch === currentBranch ? 'text-foreground font-semibold' : 'text-foreground/85'
                    }`}>
                      {branch}
                    </span>
                    {branch !== currentBranch && hoveredBranch === branch && (
                      <span className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'merge', branch }) }}
                          className="inline-flex items-center h-6 px-1.5 rounded text-[10.5px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
                          title="Merge into current"
                        >
                          Merge
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', branch }) }}
                          className="inline-flex items-center h-6 px-1.5 rounded text-[10.5px] font-medium text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete branch"
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </div>
                )
              )}
              {branches.length === 0 && (
                <p className="px-2 py-1.5 text-[11.5px] text-muted-foreground/45">No local branches.</p>
              )}
            </div>

            {/* Remote */}
            {remoteBranches && remoteBranches.length > 0 && (
              <>
                <div className="px-3 pt-3 pb-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">Remote</span>
                  <span className="ml-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/40">{remoteBranches.length}</span>
                </div>
                <div className="px-1">
                  {remoteBranches.map((branch) => (
                    <div
                      key={branch}
                      data-testid={`remote-branch-row-${branch}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleCheckout(branch.replace(/^origin\//, ''))}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCheckout(branch.replace(/^origin\//, '')) } }}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md cursor-pointer text-muted-foreground/75 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                    >
                      <span className="inline-block size-1.5 shrink-0" />
                      <span className="font-mono text-[12.5px] truncate">{branch}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Create */}
            <div className="mt-2 pt-2 border-t border-border/40 px-1">
              {creating ? (
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') { setCreating(false); setNewName('') }
                  }}
                  placeholder="branch-name"
                  className="w-full h-8 rounded-md px-2.5 text-[12.5px] font-mono bg-muted/30 text-foreground placeholder:text-muted-foreground/45 outline-none focus:ring-1 focus:ring-primary/40 transition-all"
                />
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="group flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-foreground/[0.04] transition-colors text-left"
                >
                  <span className="text-muted-foreground/55 group-hover:text-foreground transition-colors">
                    <Plus size={12} strokeWidth={2.5} />
                  </span>
                  <span className="text-[12.5px] font-medium text-muted-foreground/75 group-hover:text-foreground transition-colors">
                    New branch
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Compact icon actions */}
      <div className="flex items-center">
        {onFetch && (
          <AppTooltip content="Fetch">
            <button onClick={onFetch} disabled={loading} aria-label="Fetch" className={iconBtn}>
              <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </AppTooltip>
        )}
        {onPull && (
          <AppTooltip content={`Pull${aheadBehind && aheadBehind.behind > 0 ? ` (${aheadBehind.behind} behind)` : ''}`}>
            <button onClick={onPull} disabled={loading} aria-label="Pull" className={iconBtn}>
              <ArrowDownToLine size={12} />
              {aheadBehind && aheadBehind.behind > 0 && (
                <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-amber-500 text-[8.5px] font-bold tabular-nums text-background">
                  {aheadBehind.behind}
                </span>
              )}
            </button>
          </AppTooltip>
        )}
        {onPush && (
          <AppTooltip content={`Push${aheadBehind && aheadBehind.ahead > 0 ? ` (${aheadBehind.ahead} ahead)` : ''}`}>
            <button onClick={onPush} disabled={loading} aria-label="Push" className={iconBtn}>
              <ArrowUp size={12} />
              {aheadBehind && aheadBehind.ahead > 0 && (
                <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-emerald-500 text-[8.5px] font-bold tabular-nums text-background">
                  {aheadBehind.ahead}
                </span>
              )}
            </button>
          </AppTooltip>
        )}

        <div className="relative shrink-0" ref={stashRef}>
          <AppTooltip content={`Stash${stashes && stashes.length > 0 ? ` (${stashes.length})` : ''}`}>
            <button onClick={() => setStashOpen((v) => !v)} disabled={loading} className={iconBtn}>
              <Archive size={12} />
              {stashes && stashes.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-muted-foreground/70 text-[8.5px] font-bold tabular-nums text-background">
                  {stashes.length}
                </span>
              )}
            </button>
          </AppTooltip>
          {stashOpen && (
            <StashPanel
              stashes={stashes ?? []}
              onStash={handleStash}
              onApply={(ref) => { setStashOpen(false); onStashApply?.(ref) }}
              onDrop={(ref) => { setStashOpen(false); onStashDrop?.(ref) }}
              onClose={() => setStashOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
