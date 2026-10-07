import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  Bot,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  GitBranch,
  Github,
  LogOut,
  MessageSquare,
  RefreshCw,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react'
import type { BackendConfig, ProjectWorktree } from '@core/api/client'
import type { Project } from '@core/api/types'
import type { SelectedProjectWorkspace } from '@core/store/types'
import { useAppStore } from '@core/store'
import { getAgentIcon } from '@/layout/shared/controls'
import type { WorkspaceAgentRow } from './workspace-agent-projection'

const MENU_W = 230
const ESTIMATED_H = 340

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeCopyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* clipboard fallback */ }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const success = document.execCommand('copy')
    document.body.removeChild(el)
    return success
  } catch {
    return false
  }
}

function resolveGitHubBranchURL(project: Project, branch: string): string | null {
  if (project.github_owner && project.github_repo && branch) {
    return `https://github.com/${encodeURIComponent(project.github_owner)}/${encodeURIComponent(project.github_repo)}/tree/${encodeURIComponent(branch)}`
  }
  if (project.remote_url && branch) {
    const match = project.remote_url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/)
    if (match) {
      return `https://github.com/${match[1]}/${match[2]}/tree/${encodeURIComponent(branch)}`
    }
  }
  return null
}

function openExternalUri(url: string) {
  if (window.orchestraDesktop?.openExternal) {
    void window.orchestraDesktop.openExternal(url)
  } else {
    window.open(url, '_blank')
  }
}

// ---------------------------------------------------------------------------
// WorktreeContextMenu
// ---------------------------------------------------------------------------

export type WorktreeContextMenuProps = {
  x: number
  y: number
  worktree: ProjectWorktree
  project: Project
  workspace: SelectedProjectWorkspace
  config: BackendConfig | null
  onClose: () => void
  onRefresh?: () => void
  onCloseWorkspace?: () => void
  onRequestRemove?: () => void
  requestId?: string
  retryAllowed?: boolean
}

export function WorktreeContextMenu({
  x,
  y,
  worktree,
  project,
  workspace,
  config: _config,
  onClose,
  onRefresh,
  onCloseWorkspace,
  onRequestRemove,
  requestId,
  retryAllowed,
}: WorktreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [openInSubmenu, setOpenInSubmenu] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Bounds
  const left = Math.min(Math.max(8, x), window.innerWidth - MENU_W - 12)
  const top = Math.min(Math.max(8, y), window.innerHeight - ESTIMATED_H - 12)
  const flipSubmenuLeft = left + MENU_W + 190 > window.innerWidth

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const copyBranch = useCallback(async () => {
    const val = worktree.branch || worktree.head
    if (val) {
      await safeCopyText(val)
      setCopiedKey('branch')
      setTimeout(() => onClose(), 350)
    }
  }, [worktree, onClose])

  const copyPath = useCallback(async () => {
    if (worktree.path) {
      await safeCopyText(worktree.path)
      setCopiedKey('path')
      setTimeout(() => onClose(), 350)
    }
  }, [worktree, onClose])

  const openTerminalHere = useCallback(() => {
    const store = useAppStore.getState()
    const id = `term-${Date.now()}`
    const title = `${worktree.branch || 'Worktree'} Shell`
    store.setOpenTerminals([
      ...store.openTerminals,
      { id, title, projectId: project.id, cwd: worktree.path },
    ])
    store.addTabToGroup(project.id, { type: 'terminal', id })
    store.selectProjectWorkspace(project.id, workspace)
    store.setActiveSection('PROJECTS')
    onClose()
  }, [worktree, project, workspace, onClose])

  const openInEditor = useCallback((scheme: 'vscode' | 'cursor') => {
    const uri = `${scheme}://file/${encodeURI(worktree.path)}`
    openExternalUri(uri)
    onClose()
  }, [worktree, onClose])

  const revealInFolder = useCallback(() => {
    if (window.orchestraDesktop?.openPath) {
      void window.orchestraDesktop.openPath(worktree.path)
    } else {
      openExternalUri(`file://${encodeURI(worktree.path)}`)
    }
    onClose()
  }, [worktree, onClose])

  const githubUrl = resolveGitHubBranchURL(project, worktree.branch || '')

  const canRemove = !worktree.primary && !worktree.is_main_worktree && !worktree.locked && !worktree.prunable
  const removalUnavailableReason = worktree.primary || worktree.is_main_worktree
    ? 'The primary workspace is protected from checkout removal.'
    : worktree.locked
      ? 'This workspace is locked and cannot be removed.'
      : worktree.prunable
        ? 'This checkout is missing and cannot be removed here.'
        : ''

  const isCheckingStatus = Boolean(requestId && !retryAllowed)
  const removalLabel = isCheckingStatus ? 'Check removal status' : 'Remove worktree'
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-portal-menu="open"
      aria-label={`${project.name} ${worktree.branch || 'workspace'} actions`}
      className="fixed z-[9999] min-w-[220px] rounded-xl border border-border/80 bg-popover/95 p-1.5 text-foreground shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-2.5 py-1.5 border-b border-border/40 mb-1">
        <div className="flex items-center gap-1.5">
          <GitBranch size={13} className="shrink-0 text-muted-foreground" />
          <span className="font-semibold text-xs truncate max-w-[150px]">
            {worktree.branch || worktree.head.slice(0, 8) || 'Detached'}
          </span>
          {worktree.is_main_worktree && (
            <span className="ml-auto rounded border border-border px-1 py-px text-[9.5px] leading-none text-muted-foreground uppercase font-mono">
              main
            </span>
          )}
          {worktree.locked && (
            <span className="ml-auto rounded bg-amber-500/10 border border-amber-500/30 px-1 py-px text-[9.5px] leading-none text-amber-500 uppercase font-mono">
              locked
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground/60 truncate mt-0.5">
          {worktree.path}
        </div>
      </div>

      {/* Primary Actions */}
      <MenuItem
        icon={<Bot size={13} />}
        label="New Agent in Workspace…"
        disabled={worktree.prunable}
        onClick={() => {
          useAppStore.getState().selectProjectWorkspace(project.id, workspace)
          useAppStore.getState().openCreateAgentDialog(workspace)
          onClose()
        }}
      />
      <MenuItem
        icon={<Terminal size={13} />}
        label="Open Terminal Here"
        disabled={worktree.prunable}
        onClick={openTerminalHere}
      />

      {/* Open In Submenu */}
      <div
        className="relative"
        onMouseEnter={() => setOpenInSubmenu(true)}
        onMouseLeave={() => setOpenInSubmenu(false)}
      >
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:bg-accent/60"
        >
          <FolderOpen size={13} className="shrink-0" />
          <span className="flex-1 truncate">Open in…</span>
          <ChevronRight size={12} className="shrink-0 text-muted-foreground/60" />
        </button>

        {openInSubmenu && (
          <div
            role="menu"
            className={`absolute top-0 z-[10000] min-w-[170px] rounded-xl border border-border/80 bg-popover/95 p-1.5 text-foreground shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-75 ${
              flipSubmenuLeft ? 'right-full mr-1' : 'left-full ml-1'
            }`}
          >
            <MenuItem
              icon={<FolderOpen size={13} />}
              label="File Explorer"
              onClick={revealInFolder}
            />
            <MenuItem
              icon={<ExternalLink size={13} />}
              label="VS Code"
              onClick={() => openInEditor('vscode')}
            />
            <MenuItem
              icon={<ExternalLink size={13} />}
              label="Cursor"
              onClick={() => openInEditor('cursor')}
            />
          </div>
        )}
      </div>

      <div className="my-1 h-px bg-border/40" />

      {/* Copy Actions */}
      <MenuItem
        icon={<Copy size={13} />}
        label={copiedKey === 'path' ? 'Copied Path!' : 'Copy Path'}
        onClick={copyPath}
      />
      <MenuItem
        icon={<GitBranch size={13} />}
        label={copiedKey === 'branch' ? 'Copied Branch!' : 'Copy Branch Name'}
        onClick={copyBranch}
      />

      {githubUrl && (
        <MenuItem
          icon={<Github size={13} />}
          label="View on GitHub"
          onClick={() => {
            openExternalUri(githubUrl)
            onClose()
          }}
        />
      )}

      <div className="my-1 h-px bg-border/40" />

      {/* Lifecycle Actions */}
      {onRefresh && (
        <MenuItem
          icon={<RefreshCw size={13} />}
          label="Refresh Worktree"
          onClick={() => {
            onRefresh()
            onClose()
          }}
        />
      )}

      {onCloseWorkspace && (
        <MenuItem
          icon={<LogOut size={13} />}
          label="Close Workspace View"
          ariaLabel="Close workspace view"
          onClick={() => {
            onCloseWorkspace()
            onClose()
          }}
        />
      )}

      {/* Remove Worktree */}
      {onRequestRemove && (
        <>
          <div className="my-1 h-px bg-border/40" />
          <MenuItem
            icon={<Trash2 size={13} className="text-destructive" />}
            label={isCheckingStatus ? 'Check removal status' : 'Remove Worktree…'}
            ariaLabel={!canRemove ? `Remove worktree unavailable: ${removalUnavailableReason}` : removalLabel}
            disabled={!canRemove}
            badge={!canRemove ? removalUnavailableReason : undefined}
            onClick={() => {
              onRequestRemove()
              onClose()
            }}
          />
        </>
      )}
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// AgentContextMenu
// ---------------------------------------------------------------------------

export type AgentContextMenuProps = {
  x: number
  y: number
  row: WorkspaceAgentRow
  workspace: SelectedProjectWorkspace
  onClose: () => void
  onInspectTask?: (row: WorkspaceAgentRow) => void
  onStopTurn?: (row: WorkspaceAgentRow) => void
  onRequestArchive?: (row: WorkspaceAgentRow) => void
}

export function AgentContextMenu({
  x,
  y,
  row,
  workspace,
  onClose,
  onInspectTask,
  onStopTurn,
  onRequestArchive,
}: AgentContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const left = Math.min(Math.max(8, x), window.innerWidth - MENU_W - 12)
  const top = Math.min(Math.max(8, y), window.innerHeight - 260 - 12)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const copyId = useCallback(async () => {
    const val = row.sessionId || row.taskId || row.key
    if (val) {
      await safeCopyText(val)
      setCopied(true)
      setTimeout(() => onClose(), 350)
    }
  }, [row, onClose])

  const isActive = ['running', 'starting'].includes(row.status)

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-portal-menu="open"
      aria-label={`${row.title} agent actions`}
      className="fixed z-[9999] min-w-[210px] rounded-xl border border-border/80 bg-popover/95 p-1.5 text-foreground shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-2.5 py-1.5 border-b border-border/40 mb-1">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0">{getAgentIcon(row.provider, 14)}</span>
          <span className="font-semibold text-xs truncate max-w-[140px]">
            {row.title}
          </span>
          <span
            className={`ml-auto size-2 rounded-full shrink-0 ${
              isActive
                ? 'bg-emerald-500 animate-pulse'
                : row.status === 'failed'
                  ? 'bg-destructive'
                  : row.status === 'interrupted'
                    ? 'bg-amber-500'
                    : 'bg-muted-foreground/40'
            }`}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 mt-0.5 font-mono">
          <span className="capitalize">{row.source}</span>
          {row.model && <span className="truncate max-w-[100px]">{row.model}</span>}
        </div>
      </div>

      {/* Focus / Open Action */}
      {row.source === 'runtime' && onInspectTask ? (
        <MenuItem
          icon={<FileText size={13} />}
          label="Inspect Running Task"
          onClick={() => {
            useAppStore.getState().selectProjectWorkspace(workspace.projectId, workspace)
            onInspectTask(row)
            onClose()
          }}
        />
      ) : (
        <MenuItem
          icon={<MessageSquare size={13} />}
          label="Open Conversation"
          onClick={() => {
            useAppStore.getState().selectProjectWorkspace(workspace.projectId, workspace)
            if (row.sessionId) {
              useAppStore.getState().requestWorkspaceConversation(workspace.projectId, row.sessionId, workspace)
            }
            onClose()
          }}
        />
      )}

      {/* Stop Active Turn */}
      {isActive && onStopTurn && (
        <MenuItem
          icon={<Square size={13} className="text-amber-500" />}
          label="Stop Agent Turn"
          onClick={() => {
            onStopTurn(row)
            onClose()
          }}
        />
      )}

      {/* Copy Identifier */}
      <MenuItem
        icon={<Copy size={13} />}
        label={copied ? 'Copied ID!' : 'Copy Session ID'}
        onClick={copyId}
      />

      {/* Archive Flow */}
      {row.session && onRequestArchive && (
        <>
          <div className="my-1 h-px bg-border/40" />
          <MenuItem
            icon={<Archive size={13} />}
            label="Archive Conversation…"
            onClick={() => {
              onRequestArchive(row)
              onClose()
            }}
          />
        </>
      )}
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ConversationContextMenu — Maestro conversations, styled like AgentContextMenu
// ---------------------------------------------------------------------------

export interface ConversationContextMenuProps {
  x: number
  y: number
  title: string
  provider: string
  status: string
  mode?: string
  sessionId: string
  onClose: () => void
  onOpen: () => void
  onStopTurn?: () => void
  onRequestDelete: () => void
}

export function ConversationContextMenu({ x, y, title, provider, status, mode, sessionId, onClose, onOpen, onStopTurn, onRequestDelete }: ConversationContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const left = Math.min(Math.max(8, x), window.innerWidth - MENU_W - 12)
  const top = Math.min(Math.max(8, y), window.innerHeight - 220 - 12)
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])
  const isActive = status === 'running' || status === 'stopping'
  return createPortal(
    <div ref={menuRef} role="menu" data-portal-menu="open" aria-label={`${title} conversation actions`}
      className="fixed z-[9999] min-w-[210px] rounded-xl border border-border/80 bg-popover/95 p-1.5 text-foreground shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
      style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="px-2.5 py-1.5 border-b border-border/40 mb-1">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0">{getAgentIcon(provider, 14)}</span>
          <span className="font-semibold text-xs truncate max-w-[140px]">{title}</span>
          <span className={`ml-auto size-2 rounded-full shrink-0 ${isActive ? 'bg-emerald-500 animate-pulse' : status === 'failed' ? 'bg-destructive' : status === 'interrupted' ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
        </div>
        {mode && <div className="mt-0.5 text-[10px] font-mono text-muted-foreground/60">{mode}</div>}
      </div>
      <MenuItem icon={<MessageSquare size={13} />} label="Open Conversation" onClick={() => { onOpen(); onClose() }} />
      {isActive && onStopTurn && <MenuItem icon={<Square size={13} className="text-amber-500" />} label="Stop Agent Turn" onClick={() => { onStopTurn(); onClose() }} />}
      <MenuItem icon={<Copy size={13} />} label={copied ? 'Copied ID!' : 'Copy Session ID'} onClick={async () => { await safeCopyText(sessionId); setCopied(true); setTimeout(() => onClose(), 350) }} />
      <div className="my-1 h-px bg-border/40" />
      <MenuItem icon={<Trash2 size={13} />} label="Delete Conversation…" destructive disabled={isActive} onClick={() => { onRequestDelete(); onClose() }} />
    </div>,
    document.body,
  )
}

function MenuItem({
  icon,
  label,
  ariaLabel,
  badge,
  disabled,
  destructive,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  ariaLabel?: string
  badge?: string
  disabled?: boolean
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={ariaLabel || label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onClick()
      }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
        disabled
          ? 'cursor-not-allowed opacity-45'
          : destructive
            ? 'text-destructive hover:bg-destructive/10'
            : 'text-foreground hover:bg-accent/60'
      }`}
    >
      <span className="inline-flex size-4 items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <span className="text-[9.5px] text-muted-foreground/70 truncate max-w-[120px] font-normal">
          {badge}
        </span>
      )}
    </button>
  )
}

