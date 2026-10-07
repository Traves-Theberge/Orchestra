import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Folder, GitBranch, Globe, MessageSquare, Plus, Settings, SplitSquareHorizontal, Terminal, X } from 'lucide-react'
import { useAppStore } from '@core/store'
import { getAgentIcon } from '@layout/shared/controls'
import { MAX_TERMINAL_PANES, type CenterTabState, type TabRef, type WorkspaceContextID } from '@core/store/types'
import { terminalSplitFor } from '@core/store/group-helpers'
import { TabContextMenu } from './TabContextMenu'
import { TabContent, TabIcon } from './TabContent'
import { AGENT_LAUNCHERS, closeWorkspaceTab, createMarkdownDocument, openTerminalTab, tabTitle } from './tab-actions'

const CENTER_TAB_MIME = 'application/x-orchestra-center-tab'
const EMPTY_TABS: TabRef[] = []

/**
 * Closeable center tabs (terminal / browser / editor / conversations), rendered
 * as `role="tab"` items inside the strip's tablist after Workspace and Tasks.
 */
export function CenterTabs({ projectId }: { projectId: WorkspaceContextID }) {
  const tabs = useAppStore(s => s.projectCenterTabs[projectId]?.tabs ?? EMPTY_TABS)
  const selectedId = useAppStore(s => s.projectCenterTabs[projectId]?.selectedId)
  const openFiles = useAppStore(s => s.openFiles)
  const browserTabs = useAppStore(s => s.browserTabs)
  const openTerminals = useAppStore(s => s.openTerminals)
  const selectCenterTab = useAppStore(s => s.selectCenterTab)
  const reorderCenterTabs = useAppStore(s => s.reorderCenterTabs)
  const terminalSplits = useAppStore(s => s.projectCenterTabs[projectId]?.terminalSplits)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tab: TabRef } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ index: number; side: 'before' | 'after' } | null>(null)

  return <>
    {tabs.map((ref, index) => {
      const active = selectedId === ref.id
      // A split terminal tab is titled after its focused pane.
      const split = ref.type === 'terminal' ? terminalSplitFor({ tabs, selectedId: '', history: [], terminalSplits }, ref.id) : undefined
      const { title, isDirty } = tabTitle(split ? { type: 'terminal', id: split.focusedId } : ref, { openFiles, browserTabs, openTerminals })
      const canSplit = !!split && split.panes.length < MAX_TERMINAL_PANES
      return <div
        key={`${ref.type}-${ref.id}`}
        className="relative inline-flex h-7 shrink-0"
        draggable
        onDragStart={e => {
          setDraggingId(ref.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(CENTER_TAB_MIME, JSON.stringify({ projectId, index }))
          e.dataTransfer.setData('text/plain', title)
        }}
        onDragEnd={() => { setDraggingId(null); setDropIndicator(null) }}
        onDragOver={e => {
          if (!Array.from(e.dataTransfer.types).includes(CENTER_TAB_MIME)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const rect = e.currentTarget.getBoundingClientRect()
          const after = index === tabs.length - 1 && e.clientX > rect.left + rect.width / 2
          setDropIndicator({ index, side: after ? 'after' : 'before' })
        }}
        onDrop={e => {
          const raw = e.dataTransfer.getData(CENTER_TAB_MIME)
          if (!raw) return
          e.preventDefault()
          e.stopPropagation()
          try {
            const source = JSON.parse(raw) as { projectId: string; index: number }
            if (source.projectId === projectId) reorderCenterTabs(projectId, source.index, dropIndicator?.side === 'after' ? index + 1 : index)
          } catch (err) {
            console.warn('[center-tab-reorder] parse failed', err)
          } finally {
            setDraggingId(null)
            setDropIndicator(null)
          }
        }}
      >
        {dropIndicator?.index === index && <span className={`pointer-events-none absolute top-1 bottom-1 w-[2px] rounded-full bg-primary ${dropIndicator.side === 'before' ? 'left-0' : 'right-0'}`} />}
        <button
          type="button"
          role="tab"
          aria-selected={active}
          title={title}
          onClick={() => selectCenterTab(projectId, ref.id)}
          // Orca: middle-click closes; block the default autoscroll on press.
          onMouseDown={e => { if (e.button === 1) e.preventDefault() }}
          onAuxClick={e => { if (e.button === 1) { e.preventDefault(); closeWorkspaceTab(projectId, ref) } }}
          onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, tab: ref }) }}
          className={`group inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md pl-2.5 pr-1.5 text-[13px] transition-colors ${draggingId === ref.id ? 'opacity-40' : ''} ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
        >
          <TabIcon tabRef={ref} active={active} size={13} />
          {isDirty && <span aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-primary" />}
          <span className="max-w-[160px] truncate">{title}</span>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Close ${title}`}
            onClick={e => { e.stopPropagation(); closeWorkspaceTab(projectId, ref) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); closeWorkspaceTab(projectId, ref) } }}
            onMouseDown={e => e.stopPropagation()}
            onDragStart={e => e.preventDefault()}
            className={`inline-flex size-4 shrink-0 items-center justify-center rounded-sm ${active ? 'text-muted-foreground hover:bg-background/60 hover:text-foreground' : 'text-transparent group-hover:text-muted-foreground hover:!bg-muted hover:!text-foreground focus-visible:text-foreground'}`}
          >
            <X size={12} />
          </span>
        </button>
        {active && split && (
          <button
            type="button"
            aria-label="Split terminal"
            title={canSplit ? 'Split terminal' : `Split terminal (max ${MAX_TERMINAL_PANES} panes)`}
            disabled={!canSplit}
            draggable={false}
            onMouseDown={e => e.stopPropagation()}
            onClick={() => useAppStore.getState().splitTerminalTab(projectId, ref.id)}
            className="ml-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <SplitSquareHorizontal size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    })}
    {contextMenu && <TabContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} onCloseTab={() => closeWorkspaceTab(projectId, contextMenu.tab)} />}
  </>
}

/** The single "+" menu for the strip: center tabs (terminal, browser, markdown, conversations, agents) and the right panel's Files/Git. */
export function CenterNewTabMenu({ projectId }: { projectId: WorkspaceContextID }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const [error, setError] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const run = (action: () => void) => () => { setOpen(false); triggerRef.current?.focus(); action() }
  const state = () => useAppStore.getState()

  return <>
    <button
      ref={triggerRef}
      type="button"
      aria-label="New tab"
      aria-haspopup="menu"
      aria-expanded={open}
      title="New tab"
      onClick={() => {
        if (!open && triggerRef.current) {
          const r = triggerRef.current.getBoundingClientRect()
          setAnchor({ left: r.left, top: r.bottom + 4 })
        }
        setError('')
        setOpen(v => !v)
      }}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors ${open ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
    >
      <Plus size={14} strokeWidth={2} />
    </button>
    {error && <span role="alert" className="max-w-56 truncate px-1 text-[12px] text-destructive" title={error}>{error}</span>}
    {open && anchor && createPortal(
      <div
        ref={menuRef}
        role="menu"
        aria-label="New tab"
        data-portal-menu="open"
        className="fixed z-[9999] min-w-[220px] rounded-lg border border-border/60 bg-popover p-1 text-foreground shadow-xl"
        style={{ left: Math.min(Math.max(8, anchor.left), window.innerWidth - 228), top: anchor.top }}
        onMouseDown={e => e.stopPropagation()}
      >
        <MenuItem icon={<Terminal size={14} />} label="New Terminal" shortcut="Ctrl+T" onClick={run(() => openTerminalTab(projectId))} />
        <MenuItem icon={<Globe size={14} />} label="New Browser Tab" shortcut="Ctrl+Shift+B" onClick={run(() => state().openBrowserTab(undefined, projectId))} />
        <MenuItem icon={<FileText size={14} />} label="New Markdown" shortcut="Ctrl+Shift+M" onClick={run(() => { createMarkdownDocument(projectId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Failed to create document')) })} />
        <MenuItem icon={<MessageSquare size={14} />} label="Conversations" onClick={run(() => state().addTabToGroup(projectId, { type: 'conversations', id: 'conversations' }))} />
        <div className="my-1 h-px bg-border/60" />
        <MenuItem icon={<Folder size={14} />} label="Files" onClick={run(() => state().addTabToGroup(projectId, { type: 'files', id: 'files' }))} />
        <MenuItem icon={<GitBranch size={14} />} label="Git" onClick={run(() => state().addTabToGroup(projectId, { type: 'git', id: 'git' }))} />
        <div className="my-1 h-px bg-border/60" />
        {AGENT_LAUNCHERS.map(agent => <MenuItem key={agent.id} icon={getAgentIcon(agent.id, 14)} label={agent.label} onClick={run(() => openTerminalTab(projectId, agent))} />)}
        <div className="my-1 h-px bg-border/60" />
        <MenuItem icon={<Settings size={14} className="text-muted-foreground" />} label="Agent settings…" onClick={run(() => state().setActiveSection('AGENTS'))} />
      </div>,
      document.body,
    )}
  </>
}

function MenuItem({ icon, label, shortcut, onClick }: { icon: ReactNode; label: string; shortcut?: string; onClick: () => void }) {
  return <button type="button" role="menuitem" aria-label={label} onClick={onClick} className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12px] font-medium leading-5 hover:bg-accent/60">
    <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
    <span className="flex-1 truncate">{label}</span>
    {shortcut && <span className="font-mono text-[10.5px] text-muted-foreground/70">{shortcut}</span>}
  </button>
}

const EMPTY_CENTER: Record<string, CenterTabState> = {}

/**
 * Content of every center tab in every context. All stay mounted and only the
 * selected one in the active context is shown, so switching tabs (or
 * workspaces) never kills a shell, reloads a browser or drops editor state.
 */
export function CenterTabPanels({ contextId, onInspectTask }: { contextId: WorkspaceContextID; onInspectTask?: (identifier: string) => void }) {
  const centers = useAppStore(s => s.projectCenterTabs ?? EMPTY_CENTER)
  return <>
    {Object.entries(centers).flatMap(([ctx, center]) => center.tabs.map(ref => {
      const visible = ctx === contextId && center.selectedId === ref.id
      return <div key={`${ctx}:${ref.type}:${ref.id}`} role="tabpanel" aria-label={`${ref.type} tab`} data-center-tab={ref.id} hidden={!visible} className={visible ? 'absolute inset-0 flex min-h-0 min-w-0 flex-col' : 'hidden'}>
        <TabContent projectId={ctx} tabRef={ref} onInspectTask={onInspectTask} />
      </div>
    }))}
  </>
}
