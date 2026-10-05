import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, MoreHorizontal, Trash2 } from 'lucide-react'
import type { BackendConfig } from '@core/api/client'
import { getProjectWorktreeRemoval, removeProjectWorktree } from '@core/api/client'
import type { ProjectWorktree } from '@core/api/client'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@ui/dialog'

type Props = {
  config: BackendConfig | null
  projectId: string
  projectName: string
  worktree: ProjectWorktree
  onRemoved: () => void
  onCloseWorkspace?: () => void
}

export function WorktreeRemovalControls({ config, projectId, projectName, worktree, onRemoved, onCloseWorkspace }: Props) {
  const trigger = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [message, setMessage] = useState('')
  const [retryAllowed, setRetryAllowed] = useState(false)

  const branchLabel = worktree.branch || 'Detached'
  const canRemove = !worktree.primary && !worktree.is_main_worktree && !worktree.locked && !worktree.prunable
  const removalUnavailableReason = worktree.primary || worktree.is_main_worktree
    ? 'The primary workspace is protected from checkout removal.'
    : worktree.locked
      ? 'This workspace is locked and cannot be removed.'
      : worktree.prunable
        ? 'This checkout is missing and cannot be removed here.'
        : !config
          ? 'Connect to a backend to remove this checkout.'
          : ''

  const focusMenuItem = (position: 'first' | 'last' | 'next' | 'previous') => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
    if (!items.length) return
    if (position === 'first') return items[0].focus()
    if (position === 'last') return items[items.length - 1].focus()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0) return (position === 'next' ? items[0] : items[items.length - 1]).focus()
    const offset = position === 'next' ? 1 : -1
    items[(current + offset + items.length) % items.length].focus()
  }

  useEffect(() => {
    if (!menu) return
    const closeOutside = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Node && !menuRef.current?.contains(target) && !trigger.current?.contains(target)) setMenu(null)
    }
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null)
        trigger.current?.focus()
      }
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    focusMenuItem('first')
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [menu])

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 196
    const height = 92
    setMenu({
      left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)),
      top: Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom + 4)),
    })
  }

  const reconcile = async (id: string) => {
    if (!config) return
    setRequestId(id)
    const receipt = await getProjectWorktreeRemoval(config, projectId, id)
    if (receipt.status === 'completed') {
      setRetryAllowed(false)
      setMessage('Checkout removed. The local branch and conversation history remain available.')
      setDialogOpen(false)
      onRemoved()
    } else if (receipt.status === 'rejected') {
      setRetryAllowed(true)
      setMessage(receipt.message || 'The checkout remains. Review it before submitting another removal request.')
    } else {
      setRetryAllowed(false)
      setMessage(receipt.message || 'The outcome is still unknown. Refresh the workspace list and check this receipt again before retrying.')
    }
  }

  const remove = async () => {
    if (!config || busy) return
    setBusy(true)
    setMessage('')
    setRetryAllowed(false)
    const id = crypto.randomUUID()
    setRequestId(id)
    try {
      const receipt = await removeProjectWorktree(config, projectId, worktree.id, id)
      if (receipt.status === 'completed') {
        setDialogOpen(false)
        onRemoved()
      } else if (receipt.status === 'rejected') {
        setRetryAllowed(true)
        setMessage(receipt.message || 'The checkout remains. Review it before submitting another removal request.')
      } else {
        await reconcile(receipt.request_id || id)
      }
    } catch (error) {
      try {
        // Reconcile the same durable request. Never issue a second DELETE after an uncertain reply.
        await reconcile(id)
      } catch {
        setMessage(`${error instanceof Error ? error.message : 'Removal could not be confirmed.'} The request may still be running. Check its status before trying again.`)
      }
    } finally {
      setBusy(false)
    }
  }

  const checkStatus = async () => {
    if (!requestId || !config || busy) return
    setBusy(true)
    try {
      await reconcile(requestId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Removal status is unavailable. Try checking again later.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <button
      ref={trigger}
      type="button"
      aria-label={`Workspace actions for ${projectName} workspace ${branchLabel}`}
      aria-haspopup="menu"
      aria-expanded={menu !== null}
      onClick={openMenu}
      onKeyDown={event => event.stopPropagation()}
      className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
      title="Workspace actions"
    ><MoreHorizontal size={14} /></button>
    {menu && createPortal(
      <div
        ref={menuRef}
        role="menu"
        aria-label={`${projectName} workspace actions`}
        data-portal-menu="open"
        className="fixed z-[9999] min-w-[196px] rounded-lg border border-border bg-popover p-1 text-foreground shadow-xl"
        style={{ left: menu.left, top: menu.top }}
        onMouseDown={event => event.stopPropagation()}
        onKeyDown={event => {
          const positions: Record<string, 'first' | 'last' | 'next' | 'previous'> = {
            ArrowDown: 'next', ArrowUp: 'previous', Home: 'first', End: 'last',
          }
          const position = positions[event.key]
          if (!position) return
          event.preventDefault()
          focusMenuItem(position)
        }}
      >
        <button
          type="button"
          role="menuitem"
          aria-label="Close workspace view"
          disabled={!onCloseWorkspace}
          onClick={event => {
            event.stopPropagation()
            setMenu(null)
            onCloseWorkspace?.()
          }}
          className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
        ><LogOut size={13} /><span>Close workspace view</span></button>
        <button
          type="button"
          role="menuitem"
          aria-label={canRemove && (!requestId || retryAllowed) ? 'Remove worktree' : canRemove ? 'Check removal status' : `Remove worktree unavailable: ${removalUnavailableReason}`}
          disabled={!canRemove || !config}
          onClick={event => {
            event.stopPropagation()
            setMenu(null)
            if (!requestId || retryAllowed) {
              setRequestId('')
              setMessage('')
              setRetryAllowed(false)
            }
            setDialogOpen(true)
          }}
          className="flex w-full items-start gap-2 rounded px-2.5 py-2 text-left text-xs text-destructive hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        ><Trash2 size={13} className="mt-0.5 shrink-0" /><span className="min-w-0">{!canRemove ? <><span className="block">Remove worktree</span><span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">{removalUnavailableReason}</span></> : requestId && !retryAllowed ? 'Check removal status' : 'Remove worktree'}</span></button>
      </div>,
      document.body,
    )}
    <Dialog open={dialogOpen} onOpenChange={open => { if (!busy) setDialogOpen(open) }}>
      <DialogContent
        role="alertdialog"
        srTitle="Remove worktree?"
        showCloseButton={!busy}
        className="max-w-lg"
      >
        <div className="space-y-2">
          <DialogTitle>Remove worktree?</DialogTitle>
          <DialogDescription>
            This removes the checkout directory. The local branch and agent conversation history are retained. Git must confirm the checkout has no tracked edits, untracked files, or ignored files.
          </DialogDescription>
          <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p><span className="text-muted-foreground">Branch:</span> <span className="font-mono">{branchLabel}</span></p>
            <p className="break-all"><span className="text-muted-foreground">Path:</span> <code>{worktree.path}</code></p>
          </div>
        </div>
        {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
        <DialogFooter className="gap-2">
          {requestId && <button type="button" disabled={busy} onClick={() => void checkStatus()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">Check status</button>}
          <button type="button" disabled={busy} onClick={() => setDialogOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">Cancel</button>
          <button type="button" data-testid="remove-worktree-confirm" disabled={!config || busy || (!!requestId && !retryAllowed)} onClick={() => void remove()} className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50">{busy ? 'Checking…' : 'Remove worktree'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
