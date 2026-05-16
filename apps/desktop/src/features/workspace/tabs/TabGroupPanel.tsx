import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  File,
  Globe,
  Terminal,
  X,
  Plus,
  FileText,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Settings,
} from 'lucide-react'
import { useAppStore } from '@core/store'
import { getAgentIcon } from '@layout/shared/controls'
import type { TabGroup, TabRef, WorkspaceContextID } from '@core/store/types'
import { EditorContent } from '../editor/EditorContent'
import { BrowserContent } from '../browser/BrowserContent'
import { TerminalView } from '@features/terminal/TerminalView'
import { TabContextMenu } from './TabContextMenu'
import { ORCHESTRA_FILE_MIME, shellQuote } from '../file-explorer/FileTreeRow'

interface TabGroupPanelProps {
  projectId: WorkspaceContextID
  group: TabGroup
  isFocused: boolean
  /** Existing groupIds in the project — used for "Move to" submenu (future). */
  siblingGroupIds: string[]
}

export function TabGroupPanel({ projectId, group, isFocused, siblingGroupIds }: TabGroupPanelProps) {
  const openFiles = useAppStore((s) => s.openFiles)
  const browserTabs = useAppStore((s) => s.browserTabs)
  const openTerminals = useAppStore((s) => s.openTerminals)
  const config = useAppStore((s) => s.config)
  const explorerRoot = useAppStore((s) => s.explorerRoot)

  const activateTabInGroup = useAppStore((s) => s.activateTabInGroup)
  const removeTabFromGroup = useAppStore((s) => s.removeTabFromGroup)
  const addTabToGroup = useAppStore((s) => s.addTabToGroup)
  const splitGroup = useAppStore((s) => s.splitGroup)
  const closeGroup = useAppStore((s) => s.closeGroup)
  const setFocusedGroup = useAppStore((s) => s.setFocusedGroup)
  const closeFile = useAppStore((s) => s.closeFile)
  const closeBrowserTab = useAppStore((s) => s.closeBrowserTab)
  const setOpenTerminals = useAppStore((s) => s.setOpenTerminals)
  const openFile = useAppStore((s) => s.openFile)
  const openBrowserTab = useAppStore((s) => s.openBrowserTab)
  const setActiveSection = useAppStore((s) => s.setActiveSection)
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
  const [splitAnchor, setSplitAnchor] = useState<{ right: number; top: number } | null>(null)

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
        setPlusOpen(false)
        setSplitOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [plusOpen, splitOpen])

  const closeTab = useCallback(
    (ref: TabRef) => {
      // Remove from group's tab list first
      removeTabFromGroup(projectId, ref.id)
      // Then dispose the underlying resource
      if (ref.type === 'editor') closeFile(ref.id)
      if (ref.type === 'browser') closeBrowserTab(ref.id)
      if (ref.type === 'terminal') {
        setOpenTerminals(openTerminals.filter((t) => t.id !== ref.id))
      }
    },
    [projectId, removeTabFromGroup, closeFile, closeBrowserTab, setOpenTerminals, openTerminals],
  )

  // Render content for the active tab
  const activeRef = group.tabs.find((t) => t.id === group.activeTabId)
  const activeContent: ReactNode = (() => {
    if (!activeRef) return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground/40 p-8">
        <Plus size={28} strokeWidth={1.4} />
        <p className="text-xs">Open a tab in this group via the + button.</p>
      </div>
    )
    if (activeRef.type === 'editor') {
      const file = openFiles.find((f) => f.id === activeRef.id)
      return file ? <EditorContent file={file} /> : null
    }
    if (activeRef.type === 'browser') {
      const tab = browserTabs.find((t) => t.id === activeRef.id)
      return tab ? <BrowserContent tab={tab} /> : null
    }
    if (activeRef.type === 'terminal') {
      const term = openTerminals.find((t) => t.id === activeRef.id)
      if (!term || !config) return null
      return (
        <TerminalView
          sessionId={term.id}
          projectId={term.projectId}
          cwd={term.cwd}
          baseUrl={config.baseUrl}
          apiToken={config.apiToken}
          initialCommand={term.initialCommand}
        />
      )
    }
    return null
  })()

  const titleFor = (ref: TabRef): { title: string; isDirty?: boolean } => {
    if (ref.type === 'editor') {
      const f = openFiles.find((x) => x.id === ref.id)
      return { title: f?.relativePath.split('/').pop() ?? 'Untitled', isDirty: f?.isDirty }
    }
    if (ref.type === 'browser') {
      const t = browserTabs.find((x) => x.id === ref.id)
      return { title: t?.title || 'New Tab' }
    }
    if (ref.type === 'terminal') {
      const t = openTerminals.find((x) => x.id === ref.id)
      return { title: t?.title || 'Shell' }
    }
    return { title: '' }
  }

  const iconFor = (ref: TabRef, isActive: boolean) => {
    const cls = isActive ? 'text-primary' : 'text-muted-foreground/50'
    if (ref.type === 'editor') return <File size={11} className={cls} />
    if (ref.type === 'browser') return <Globe size={11} className={cls} />
    return <Terminal size={11} className={cls} />
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 min-w-0 bg-background relative"
      onMouseDownCapture={() => {
        if (!isFocused) setFocusedGroup(projectId, group.id)
      }}
    >
      {/* Tab strip */}
      <div className="flex items-center border-b border-border/30 shrink-0 h-11">
        <div className="flex-1 flex items-center overflow-x-auto min-w-0">
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
                className="relative inline-flex shrink-0"
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
                  onClick={() => activateTabInGroup(projectId, ref.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ x: e.clientX, y: e.clientY, tab: ref })
                  }}
                  className={`group relative inline-flex items-center gap-1.5 px-3 h-11 transition-colors shrink-0 ${
                    isDragging ? 'cursor-grabbing opacity-40' : 'cursor-grab'
                  } ${
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.03]'
                  }`}
                  title={title}
                >
                  {isActive && (
                    <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />
                  )}
                  {iconFor(ref, isActive)}
                  {isDirty && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
                  <span className="text-[12px] font-medium tracking-tight truncate max-w-[160px]">{title}</span>
                  <span
                    role="button"
                    tabIndex={0}
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
                    className="inline-flex items-center justify-center size-4 -mr-1 rounded text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-foreground/[0.06] transition-all"
                  >
                    <X size={11} />
                  </span>
                </button>
              </div>
            )
          })}

          {/* + button — pinned right after the last tab */}
          <button
            ref={plusRef}
            onClick={() => {
              if (!plusOpen && plusRef.current) {
                const r = plusRef.current.getBoundingClientRect()
                setPlusAnchor({ left: r.left, top: r.bottom + 4 })
              }
              setPlusOpen((v) => !v)
            }}
            className={`inline-flex items-center justify-center size-11 transition-colors shrink-0 ${
              plusOpen
                ? 'text-foreground bg-foreground/[0.04]'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.03]'
            }`}
            title="New…"
          >
            <Plus size={13} strokeWidth={2.25} />
          </button>
        </div>

        {/* Split + close-group menu — far right */}
        <div className="flex items-center shrink-0">
          <button
            ref={splitRef}
            onClick={() => {
              if (!splitOpen && splitRef.current) {
                const r = splitRef.current.getBoundingClientRect()
                setSplitAnchor({ right: window.innerWidth - r.right, top: r.bottom + 4 })
              }
              setSplitOpen((v) => !v)
            }}
            className={`flex items-center justify-center size-7 my-1 mx-0.5 rounded-md transition-colors ${
              splitOpen
                ? 'bg-accent/60 text-foreground'
                : 'text-muted-foreground/50 hover:text-foreground hover:bg-muted/40'
            }`}
            title="Split"
          >
            <SplitSquareHorizontal size={13} />
          </button>
          {siblingGroupIds.length > 1 && (
            <button
              onClick={() => closeGroup(projectId, group.id)}
              className="flex items-center justify-center size-7 my-1 mx-0.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors"
              title="Close group"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

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
            const w = 240, h = 380, m = 8
            const left = Math.min(Math.max(m, plusAnchor.left), window.innerWidth - w - m)
            const top = plusAnchor.top + h + m > window.innerHeight ? Math.max(m, plusAnchor.top - h - 12) : plusAnchor.top
            return { left, top }
          })()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <PlusMenuItem
            icon={<Terminal size={13} />}
            label="New Terminal"
            shortcut="Ctrl+T"
            onClick={() => {
              setPlusOpen(false)
              setFocusedGroup(projectId, group.id)
              const id = `shell-${Date.now()}`
              const proj = useAppStore.getState().projects.find((p) => p.id === projectId)
              const cwd = proj?.root_path
              const initialCommand = cwd ? `cd ${shellQuote(cwd)} && clear` : undefined
              const title = proj ? `${proj.name} Shell` : 'Shell'
              setOpenTerminals([
                ...useAppStore.getState().openTerminals,
                { id, title, projectId: proj ? projectId : undefined, cwd, initialCommand },
              ])
              addTabToGroup(projectId, { type: 'terminal', id }, group.id)
            }}
          />
          <PlusMenuItem
            icon={<Globe size={13} />}
            label="New Browser Tab"
            shortcut="Ctrl+Shift+B"
            onClick={() => {
              setPlusOpen(false)
              setFocusedGroup(projectId, group.id)
              openBrowserTab()
            }}
          />
          <PlusMenuItem
            icon={<FileText size={13} />}
            label="New Markdown"
            shortcut="Ctrl+Shift+M"
            onClick={async () => {
              setPlusOpen(false)
              setFocusedGroup(projectId, group.id)
              const proj = useAppStore.getState().projects.find((p) => p.id === projectId)
              const root = proj?.root_path || explorerRoot
              if (!root) {
                alert('Cannot create markdown: no project root available. Open a project first.')
                return
              }
              if (!config?.baseUrl) {
                alert('Cannot create markdown: backend not connected.')
                return
              }
              const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
              const filename = `Untitled-${stamp}.md`
              const absPath = `${root.replace(/\/$/, '')}/${filename}`
              const initial = `# Untitled\n\n`
              try {
                const url = `${config.baseUrl}/api/v1/workspace/file?path=${encodeURIComponent(absPath)}`
                const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
                if (config.apiToken) headers['Authorization'] = `Bearer ${config.apiToken}`
                const res = await fetch(url, { method: 'PUT', headers, body: initial })
                if (!res.ok) {
                  const errText = await res.text().catch(() => '')
                  alert(`Failed to create file: HTTP ${res.status} ${errText.slice(0, 200)}`)
                  return
                }
                openFile(absPath, filename, undefined, projectId)
              } catch (err) {
                alert(`Failed to create file: ${(err as Error).message}`)
              }
            }}
          />
          <div className="my-1 h-px bg-border/60" />
          {(['claude', 'codex', 'opencode', 'gemini', '8gent'] as const).map((agent) => (
            <PlusMenuItem
              key={agent}
              icon={getAgentIcon(agent, 13)}
              label={agentLabel(agent)}
              onClick={() => {
                setPlusOpen(false)
                setFocusedGroup(projectId, group.id)
                const id = `shell-${Date.now()}`
                const proj = useAppStore.getState().projects.find((p) => p.id === projectId)
                const cwd = proj?.root_path
                // `~` must stay unquoted so the shell expands it; any concrete
                // path goes through shellQuote to defuse spaces / quotes / $.
                const cdArg = cwd ? shellQuote(cwd) : '~'
                const cmd = `cd ${cdArg} && clear && ${agent}`
                const title = `${agentLabel(agent)}${proj ? ` · ${proj.name}` : ''}`
                setOpenTerminals([
                  ...useAppStore.getState().openTerminals,
                  { id, title, projectId: proj ? projectId : undefined, cwd, initialCommand: cmd },
                ])
                addTabToGroup(projectId, { type: 'terminal', id }, group.id)
              }}
            />
          ))}
          <div className="my-1 h-px bg-border/60" />
          <PlusMenuItem
            icon={<Settings size={13} className="text-muted-foreground" />}
            label="Agent settings…"
            onClick={() => {
              setPlusOpen(false)
              setActiveSection('AGENTS')
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
            onClick={() => { splitGroup(projectId, group.id, 'horizontal'); setSplitOpen(false) }}
            className="flex items-center gap-2.5 w-full px-3 py-1.5 text-[12px] font-medium text-foreground/90 hover:text-foreground hover:bg-accent/60 text-left transition-colors"
          >
            <SplitSquareHorizontal size={11} /> Split right
          </button>
          <button
            onClick={() => { splitGroup(projectId, group.id, 'vertical'); setSplitOpen(false) }}
            className="flex items-center gap-2.5 w-full px-3 py-1.5 text-[12px] font-medium text-foreground/90 hover:text-foreground hover:bg-accent/60 text-left transition-colors"
          >
            <SplitSquareVertical size={11} /> Split down
          </button>
          <div className="my-1 h-px bg-border/40" />
          <button
            onClick={() => { closeGroup(projectId, group.id); setSplitOpen(false) }}
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

function agentLabel(id: 'claude' | 'codex' | 'opencode' | 'gemini' | '8gent'): string {
  switch (id) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    case 'opencode':
      return 'OpenCode'
    case 'gemini':
      return 'Gemini'
    case '8gent':
      return '8gent'
  }
}
