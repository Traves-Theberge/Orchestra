import { useState, useRef, useEffect, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Plus,
  SplitSquareHorizontal,
  SplitSquareVertical,
  GitBranch,
  Folder,
  PanelRight,
} from 'lucide-react'
import { useAppStore } from '@core/store'
import { isSideTab } from '@core/store/group-helpers'
import type { TabGroup, TabRef, WorkspaceContextID } from '@core/store/types'
import { WorkspaceEmptyTools } from '../WorkspaceEmptyTools'
import { TabContextMenu } from './TabContextMenu'
import { ToolbarTabSlotContext } from './toolbar-tab-slot'
import { ORCHESTRA_FILE_MIME } from '../file-explorer/FileTreeRow'
import { TabContent, TabIcon } from './TabContent'
import { closeWorkspaceTab, tabTitle } from './tab-actions'

interface TabGroupPanelProps {
  projectId: WorkspaceContextID
  group: TabGroup
  isFocused: boolean
  /** Existing groupIds in the project — used for "Move to" submenu (future). */
  siblingGroupIds: string[]
  onInspectTask?: (identifier: string) => void
  onToggleTools?: () => void
}

/**
 * A tab group in the right tools panel. Only Files and Git tabs live here;
 * terminals, browsers, editors and conversations are center tabs.
 */
export function TabGroupPanel({ projectId, group: rawGroup, isFocused, siblingGroupIds, onInspectTask, onToggleTools }: TabGroupPanelProps) {
  // Legacy groups may still hold center-type refs until the store migrates
  // them; never render those here.
  const sideTabs = rawGroup.tabs.filter(isSideTab)
  const group = { ...rawGroup, tabs: sideTabs, activeTabId: sideTabs.some(t => t.id === rawGroup.activeTabId) ? rawGroup.activeTabId : null }
  const openFiles = useAppStore((s) => s.openFiles)
  const browserTabs = useAppStore((s) => s.browserTabs)
  const openTerminals = useAppStore((s) => s.openTerminals)

  const activateTabInGroup = useAppStore((s) => s.activateTabInGroup)
  const addTabToGroup = useAppStore((s) => s.addTabToGroup)
  const splitGroup = useAppStore((s) => s.splitGroup)
  const closeGroup = useAppStore((s) => s.closeGroup)
  const setFocusedGroup = useAppStore((s) => s.setFocusedGroup)
  const openFile = useAppStore((s) => s.openFile)
  const reorderTabsInGroup = useAppStore((s) => s.reorderTabsInGroup)

  const [plusOpen, setPlusOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tab: TabRef } | null>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ index: number; side: 'before' | 'after' } | null>(null)
  const plusRef = useRef<HTMLButtonElement>(null)
  const splitRef = useRef<HTMLButtonElement>(null)
  const [plusAnchor, setPlusAnchor] = useState<{ left: number; top: number } | null>(null)
  const [splitAnchor] = useState<{ right: number; top: number } | null>(null)

  // Close popovers on outside click / Esc
  useEffect(() => {
    if (!plusOpen && !splitOpen) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        plusRef.current && !plusRef.current.contains(target) &&
        splitRef.current && !splitRef.current.contains(target) &&
        !document.querySelector('[data-portal-menu="open"]')?.contains(target)
      ) {
        setPlusOpen(false)
        setSplitOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const focusTarget = plusOpen ? plusRef.current : splitRef.current
        setPlusOpen(false)
        setSplitOpen(false)
        focusTarget?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [plusOpen, splitOpen])

  const closePlusMenu = () => {
    setPlusOpen(false)
    plusRef.current?.focus()
  }
  const closeSplitMenu = () => {
    setSplitOpen(false)
    splitRef.current?.focus()
  }

  const closeTab = (ref: TabRef) => closeWorkspaceTab(projectId, ref)

  // Render content for the active tab
  const activeRef = group.tabs.find((t) => t.id === group.activeTabId)
  const activeContent: ReactNode = activeRef
    ? <TabContent projectId={projectId} tabRef={activeRef} onInspectTask={onInspectTask} />
    : <WorkspaceEmptyTools projectId={projectId} />

  const titleFor = (ref: TabRef) => tabTitle(ref, { openFiles, browserTabs, openTerminals })
  const iconFor = (ref: TabRef, isActive: boolean) => <TabIcon tabRef={ref} active={isActive} size={inToolbar ? 13 : 11} />

  const toolbarSlot = useContext(ToolbarTabSlotContext)
  const inToolbar = Boolean(toolbarSlot) && siblingGroupIds.length <= 1
  const placeStrip = (strip: ReactNode) => (inToolbar && toolbarSlot ? createPortal(strip, toolbarSlot) : strip)

  return (
    <div
      data-group-id={group.id}
      data-active-tab-id={group.activeTabId}
      className="flex flex-col h-full min-h-0 min-w-0 bg-background relative"
      onMouseDownCapture={() => {
        if (!isFocused) setFocusedGroup(projectId, group.id)
      }}
    >
      {/* Tab strip: in the tool toolbar when this is the only group */}
      {placeStrip(<div className={inToolbar ? 'flex h-full min-w-0 flex-1 items-center select-none' : 'flex items-center border-b border-border/40 bg-muted/20 shrink-0 h-9 select-none'}>
        <div role="tablist" aria-label="Workspace tool tabs" className="flex-1 flex items-center overflow-x-auto min-w-0 h-full">
          {group.tabs.map((ref, index) => {
            const isActive = group.activeTabId === ref.id
            const isDragging = draggingTabId === ref.id
            const showIndicatorBefore = dropIndicator?.index === index && dropIndicator.side === 'before'
            const showIndicatorAfter =
              dropIndicator?.side === 'after' &&
              dropIndicator.index === index &&
              index === group.tabs.length - 1
            const { title, isDirty } = titleFor(ref)
            return (
              <div
                key={`${ref.type}-${ref.id}`}
                className={inToolbar ? 'relative inline-flex shrink-0 h-7' : 'relative inline-flex shrink-0 h-9 border-r border-border/30'}
                draggable
                onDragStart={(e) => {
                  setDraggingTabId(ref.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData(
                    'application/x-orchestra-tab',
                    JSON.stringify({ groupId: group.id, tabId: ref.id, index }),
                  )
                  e.dataTransfer.setData('text/plain', title)
                }}
                onDragEnd={() => {
                  setDraggingTabId(null)
                  setDropIndicator(null)
                }}
                onDragOver={(e) => {
                  if (!Array.from(e.dataTransfer.types).includes('application/x-orchestra-tab')) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const rect = e.currentTarget.getBoundingClientRect()
                  const isLast = index === group.tabs.length - 1
                  const past = e.clientX > rect.left + rect.width / 2
                  if (isLast && past) {
                    setDropIndicator({ index, side: 'after' })
                  } else {
                    setDropIndicator({ index, side: 'before' })
                  }
                }}
                onDrop={(e) => {
                  const raw = e.dataTransfer.getData('application/x-orchestra-tab')
                  if (!raw) return
                  e.preventDefault()
                  e.stopPropagation()
                  try {
                    const { groupId: srcGroupId, index: fromIndex } = JSON.parse(raw) as {
                      groupId: string
                      tabId: string
                      index: number
                    }
                    if (srcGroupId !== group.id) return // cross-group not handled here
                    const indicator = dropIndicator
                    let toIndex = index
                    if (indicator?.side === 'after') toIndex = index + 1
                    reorderTabsInGroup(projectId, group.id, fromIndex, toIndex)
                  } catch (err) {
                    console.warn('[tab-reorder] parse failed', err)
                  } finally {
                    setDraggingTabId(null)
                    setDropIndicator(null)
                  }
                }}
              >
                {showIndicatorBefore && (
                  <span className="pointer-events-none absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-primary" />
                )}
                {showIndicatorAfter && (
                  <span className="pointer-events-none absolute right-0 top-1 bottom-1 w-[2px] rounded-full bg-primary" />
                )}
                <button
                  role="tab"
                  aria-selected={isActive}
                  data-active-tab={isActive}
                  onClick={() => activateTabInGroup(projectId, ref.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ x: e.clientX, y: e.clientY, tab: ref })
                  }}
                  className={`group relative inline-flex items-center gap-1.5 transition-colors shrink-0 text-left ${
                    isDragging ? 'cursor-grabbing opacity-40' : 'cursor-grab'
                  } ${
                    inToolbar
                      ? `h-7 rounded-md pl-2.5 pr-1.5 text-[13px] ${isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`
                      : `px-3 h-9 ${isActive
                        ? 'bg-background text-foreground font-medium shadow-xs border-t-2 border-t-primary -mt-px'
                        : 'bg-transparent text-muted-foreground/75 hover:text-foreground hover:bg-muted/30'}`
                  }`}
                  title={title}
                >
                  {iconFor(ref, isActive)}
                  {isDirty && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
                  <span className={inToolbar ? 'max-w-[160px] truncate' : 'text-[12px] font-medium tracking-tight truncate max-w-[160px]'}>{title}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Close ${title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(ref)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        closeTab(ref)
                      }
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventDefault()}
                    className={inToolbar
                      // Same close affordance as the center tabs, so both read as one strip.
                      ? `inline-flex size-4 shrink-0 items-center justify-center rounded-sm ${isActive ? 'text-muted-foreground hover:bg-background/60 hover:text-foreground' : 'text-transparent group-hover:text-muted-foreground hover:!bg-muted hover:!text-foreground focus-visible:text-foreground'}`
                      : `inline-flex items-center justify-center size-4 -mr-1 rounded hover:bg-muted transition-all ${
                      isActive
                        ? 'text-muted-foreground/70 opacity-70 group-hover:opacity-100 hover:text-foreground'
                        : 'text-muted-foreground/50 opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:text-foreground'
                    }`}
                  >
                    <X size={11} />
                  </span>
                </button>
              </div>
            )
          })}

          {/* + button — pinned right after the last tab. In the shared strip the single center "+" covers it. */}
          {!inToolbar && <button
            ref={plusRef}
            aria-label="Add tab"
            aria-haspopup="menu"
            aria-expanded={plusOpen}
            onClick={() => {
              if (!plusOpen && plusRef.current) {
                const r = plusRef.current.getBoundingClientRect()
                setPlusAnchor({ left: r.left, top: r.bottom + 4 })
              }
              setPlusOpen((v) => !v)
            }}
            className={`inline-flex items-center justify-center ${inToolbar ? 'size-7 rounded-md' : 'size-9'} transition-colors shrink-0 ${
              plusOpen
                ? 'text-foreground bg-muted/50'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/30'
            }`}
            title="New tab…"
          >
            <Plus size={13} strokeWidth={2.25} />
          </button>}
        </div>

        {/* Split + close-group menu + controls — far right */}
        <div className="flex items-center shrink-0 pr-1 gap-0.5">
          {siblingGroupIds.length > 1 && (
            <button
              onClick={() => closeGroup(projectId, group.id)}
              className="flex items-center justify-center size-7 my-1 mx-0.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors"
              title="Close group"
            >
              <X size={13} />
            </button>
          )}
          {onToggleTools && !inToolbar && (
            <button
              onClick={onToggleTools}
              aria-label="Hide workspace tools"
              title="Hide workspace tools"
              className="flex items-center justify-center size-7 my-1 mx-0.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <PanelRight size={13} />
            </button>
          )}
        </div>
      </div>)}

      {/* Content area */}
      <div
        className={`flex-1 min-h-0 min-w-0 relative ${
          isDropTarget ? 'outline outline-2 outline-primary/60 outline-offset-[-4px]' : ''
        }`}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes(ORCHESTRA_FILE_MIME)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            if (!isDropTarget) setIsDropTarget(true)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDropTarget(false)
        }}
        onDrop={(e) => {
          setIsDropTarget(false)
          const raw = e.dataTransfer.getData(ORCHESTRA_FILE_MIME)
          if (!raw) return
          e.preventDefault()
          try {
            const { path, relativePath, isDirectory } = JSON.parse(raw) as {
              path: string
              relativePath: string
              isDirectory?: boolean
            }
            if (isDirectory) return // directories aren't openable in the editor
            setFocusedGroup(projectId, group.id)
            openFile(path, relativePath, undefined, projectId)
          } catch (err) {
            console.warn('[drop] failed to parse file payload', err)
          }
        }}
      >
        {activeContent}
      </div>

      {/* Portaled menus */}
      {plusOpen && plusAnchor && createPortal(
        <div
          role="menu"
          data-portal-menu="open"
          className="fixed z-[9999] bg-popover border border-border/60 rounded-lg shadow-xl py-1 min-w-[240px] backdrop-blur-sm text-foreground"
          style={(() => {
            const w = 240, h = 120, m = 8
            const left = Math.min(Math.max(m, plusAnchor.left), window.innerWidth - w - m)
            const top = plusAnchor.top + h + m > window.innerHeight ? Math.max(m, plusAnchor.top - h - 12) : plusAnchor.top
            return { left, top }
          })()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <PlusMenuItem
            icon={<Folder size={13} />}
            label="Files"
            onClick={() => {
              closePlusMenu()
              setFocusedGroup(projectId, group.id)
              addTabToGroup(projectId, { type: 'files', id: 'files' }, group.id)
            }}
          />
          <PlusMenuItem
            icon={<GitBranch size={13} />}
            label="Git & pull requests"
            onClick={() => {
              closePlusMenu()
              setFocusedGroup(projectId, group.id)
              addTabToGroup(projectId, { type: 'git', id: 'git' }, group.id)
            }}
          />
        </div>,
        document.body,
      )}

      {splitOpen && splitAnchor && createPortal(
        <div
          role="menu"
          data-portal-menu="open"
          className="fixed z-[9999] bg-popover border border-border/60 rounded-lg shadow-xl py-1.5 min-w-[180px] backdrop-blur-sm"
          style={(() => {
            const w = 200, h = 140, m = 8
            const right = Math.max(m, Math.min(splitAnchor.right, window.innerWidth - w - m))
            const top = splitAnchor.top + h + m > window.innerHeight ? Math.max(m, splitAnchor.top - h - 12) : splitAnchor.top
            return { right, top }
          })()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            aria-label="Split right"
            onClick={() => { splitGroup(projectId, group.id, 'horizontal'); closeSplitMenu() }}
            className="flex items-center gap-2.5 w-full px-3 py-1.5 text-[12px] font-medium text-foreground/90 hover:text-foreground hover:bg-accent/60 text-left transition-colors"
          >
            <SplitSquareHorizontal size={11} /> Split right
          </button>
          <button
            role="menuitem"
            aria-label="Split down"
            onClick={() => { splitGroup(projectId, group.id, 'vertical'); closeSplitMenu() }}
            className="flex items-center gap-2.5 w-full px-3 py-1.5 text-[12px] font-medium text-foreground/90 hover:text-foreground hover:bg-accent/60 text-left transition-colors"
          >
            <SplitSquareVertical size={11} /> Split down
          </button>
          <div className="my-1 h-px bg-border/40" />
          <button
            role="menuitem"
            aria-label="Close group"
            onClick={() => { closeGroup(projectId, group.id); closeSplitMenu() }}
            className="flex items-center gap-2.5 w-full px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 text-left transition-colors"
          >
            <X size={11} /> Close group
          </button>
        </div>,
        document.body,
      )}

      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onCloseTab={() => closeTab(contextMenu.tab)}
        />
      )}
    </div>
  )
}

function PlusMenuItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: ReactNode
  label: string
  shortcut?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={label}
      onClick={onClick}
      className="flex items-center gap-2.5 w-full px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-accent/60 text-left transition-colors"
    >
      <span className="inline-flex size-4 items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="text-[10.5px] tabular-nums text-muted-foreground/70 font-mono">{shortcut}</span>
      )}
    </button>
  )
}
