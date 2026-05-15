import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Bell,
  Cable,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  Folder,
  FolderOpen,
  Globe,
  Keyboard,
  Loader2,
  Paintbrush,
  Plus,
  RefreshCcw,
  Search,
  Terminal,
  Type,
} from 'lucide-react'
import type { IssueListItem } from '@core/api/client'
import { usePlatform } from '@/hooks/use-platform'
import type { SidebarItem } from '@layout/types'
import type { Project, DocItem } from '@core/api/types'
import { useAppStore } from '@core/store'
import { FileExplorer } from '@features/workspace/file-explorer/FileExplorer'
import { WorkspaceSearch } from '@features/workspace/panels/WorkspaceSearch'
import { ProjectSwitcher } from '@features/workspace/file-explorer/ProjectSwitcher'
import type { LucideIcon } from 'lucide-react'
import { getAgentIcon, CustomDropdown } from '@layout/shared/controls'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { PROVIDERS } from '@features/agents/constants'

type SidebarView = 'primary' | 'settings' | 'projects' | 'console' | 'agents' | 'docs'

const DRILLDOWN_SECTIONS: ReadonlySet<string> = new Set(['SETTINGS', 'PROJECTS', 'CONSOLE', 'AGENTS', 'DOCS'])

const SETTINGS_SECTIONS = [
  { id: 'connections', label: 'Connections', icon: Database },
  { id: 'agents', label: 'Maestro', icon: Cpu },
  { id: 'integrations', label: 'Integrations', icon: Cable },
  { id: 'appearance', label: 'Appearance', icon: Paintbrush },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'editor', label: 'Editor', icon: Type },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'experimental', label: 'Experimental', icon: FlaskConical },
] as const


const DOC_SECTION_ORDER: Record<string, number> = {
  'index.md': 0,
  'architecture': 1,
  'api': 2,
  'backend': 3,
  'frontend': 4,
  'guides': 5,
  'operations': 6,
  'enums.md': 7,
}

const DOC_SUB_SECTION_ORDER: Record<string, Record<string, number>> = {
  'architecture': { 'overview.md': 0, 'backend.md': 1, 'desktop.md': 2, 'tui.md': 3, 'data-flow.md': 4 },
  'api': { 'reference.md': 0, 'schemas.md': 1, 'sse-events.md': 2 },
  'backend': { 'orchestrator.md': 0, 'agents.md': 1, 'tracker.md': 2, 'workspace.md': 3, 'database.md': 4, 'config.md': 5, 'mcp.md': 6, 'tools.md': 7, 'telemetry.md': 8 },
  'frontend': { 'components.md': 0, 'views.md': 1, 'client.md': 2, 'state-management.md': 3, 'electron.md': 4 },
  'guides': { 'getting-started.md': 0, 'configuration.md': 1, 'development.md': 2 },
  'operations': { 'deployment.md': 0, 'docker.md': 1, 'ci-cd.md': 2 },
}

function sortDocItems(items: DocItem[], parentDir?: string): DocItem[] {
  return items.toSorted((a, b) => {
    if (a.name === 'index.md') return -1
    if (b.name === 'index.md') return 1
    if (a.is_folder && !b.is_folder) return -1
    if (!a.is_folder && b.is_folder) return 1
    const orderMap = parentDir ? DOC_SUB_SECTION_ORDER[parentDir] : DOC_SECTION_ORDER
    const aOrder = orderMap?.[a.name] ?? 999
    const bOrder = orderMap?.[b.name] ?? 999
    if (aOrder !== bOrder) return aOrder - bOrder
    return a.name.localeCompare(b.name)
  })
}


const MIN_WIDTH = 180
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 224

function sectionToView(section: string): SidebarView {
  switch (section) {
    case 'SETTINGS': return 'settings'
    case 'PROJECTS': return 'projects'
    case 'CONSOLE': return 'console'
    case 'AGENTS': return 'agents'
    case 'DOCS': return 'docs'
    default: return 'primary'
  }
}

interface AppSidebarProps {
  items: SidebarItem[]
  activeSection: string
  onSectionChange: (section: string) => void
  projects: Project[]
  selectedProjectID: string | null
  onSelectProject: (id: string) => void
  onCreateProject: () => void
  onSearch?: (query: string) => Promise<IssueListItem[]>
  onResultClick?: (issueIdentifier: string) => void
}

export function AppSidebar({
  items,
  activeSection,
  onSectionChange,
  projects,
  selectedProjectID,
  onSelectProject,
  onCreateProject,
  onSearch,
  onResultClick,
}: AppSidebarProps) {
  const [view, setView] = useState<SidebarView>(() => sectionToView(activeSection))
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  // eslint-disable-next-line react-doctor/rerender-state-only-in-handlers -- read in JSX at line 175
  const [collapsed, setCollapsed] = useState(false)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(DEFAULT_WIDTH)
  const sidebarRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (DRILLDOWN_SECTIONS.has(activeSection)) {
      setView(sectionToView(activeSection))
    }
  }, [activeSection])

  const handleItemClick = (id: string) => {
    onSectionChange(id)
    if (DRILLDOWN_SECTIONS.has(id)) {
      setView(sectionToView(id))
    } else {
      setView('primary')
    }
  }

  const handleBack = useCallback(() => setView('primary'), [])

  // Drag-to-resize
  const onDragMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = width

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = ev.clientX - startX.current
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta))
      setWidth(next)
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (collapsed) {
    return (
      <aside className="h-full shrink-0 bg-background border-r border-border/40 flex flex-col items-center py-3 gap-1" style={{ width: 64 }}>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="size-8 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
          title="Expand sidebar"
        >
          <ChevronRight size={15} strokeWidth={2} />
        </button>
        {items.map((item) => {
          const Icon = item.icon
          const active = activeSection === item.id
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => handleItemClick(item.id)}
              className={`size-9 rounded-lg flex items-center justify-center transition-colors ${
                active ? 'bg-foreground/[0.08] text-primary' : 'text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.06]'
              }`}
            >
              <Icon className="size-[15px]" strokeWidth={active ? 2.2 : 1.8} />
            </button>
          )
        })}
      </aside>
    )
  }

  return (
    <aside
      ref={sidebarRef}
      className="h-full shrink-0 bg-background border-r border-border/40 flex flex-col overflow-hidden relative"
      style={{ width }}
    >
      {/* Header */}
      <div className="shrink-0 border-b border-border/30">
        <div className="h-20 flex items-center gap-3 px-3">
          <img src="/Orchesta.png" alt="Orchestra" className="size-16 dark:invert shrink-0" aria-hidden="true" />
          <span className="text-[20px] font-bold text-foreground tracking-tight flex-1 truncate">Orchestra</span>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="size-6 rounded flex items-center justify-center text-muted-foreground/30 hover:text-foreground hover:bg-foreground/[0.06] transition-colors shrink-0"
            title="Collapse sidebar"
          >
            <ChevronLeft size={13} strokeWidth={2} />
          </button>
        </div>
        <SidebarSearch onSearch={onSearch} onResultClick={onResultClick} />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === 'primary' && (
          <PrimaryNav items={items} activeSection={activeSection} onItemClick={handleItemClick} />
        )}
        {view === 'settings' && (
          <SettingsSubNav onBack={handleBack} />
        )}
        {view === 'projects' && (
          <ProjectsSubNav
            projects={projects}
            selectedId={selectedProjectID}
            onSelect={onSelectProject}
            onCreateProject={onCreateProject}
            onBack={handleBack}
          />
        )}
        {view === 'console' && (
          <ConsoleSubNav onBack={handleBack} />
        )}
        {view === 'agents' && (
          <AgentsSubNav onBack={handleBack} />
        )}
        {view === 'docs' && (
          <DocsSubNav onBack={handleBack} />
        )}
      </div>

      {/* Drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={onDragMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
      />
    </aside>
  )
}

function SidebarSearch({
  onSearch,
  onResultClick,
}: {
  onSearch?: (query: string) => Promise<IssueListItem[]>
  onResultClick?: (id: string) => void
}) {
  const { isMac } = usePlatform()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IssueListItem[]>([])
  const [pending, setPending] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (containerRef.current?.contains(t) || dropdownRef.current?.contains(t)) return
      setShowResults(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const id = setTimeout(async () => {
      if (query.trim().length >= 2 && onSearch) {
        setPending(true)
        try {
          const res = await onSearch(query)
          setResults(res)
          setShowResults(true)
        } catch { setResults([]) }
        finally { setPending(false) }
      } else {
        setResults([])
        setShowResults(false)
      }
    }, 300)
    return () => clearTimeout(id)
  }, [query, onSearch])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', down, true)
    return () => document.removeEventListener('keydown', down, true)
  }, [])

  return (
    <div className="px-2 pb-2.5" ref={containerRef}>
      <div className="group relative flex h-8 items-center gap-2 rounded-lg bg-muted/40 border border-border/30 px-2.5 focus-within:bg-background focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
        {pending
          ? <Loader2 size={13} className="shrink-0 text-primary animate-spin" />
          : <Search size={13} className="shrink-0 text-muted-foreground/50 group-focus-within:text-primary transition-colors" />
        }
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setShowResults(true)}
          placeholder="Search…"
          className="flex-1 min-w-0 bg-transparent text-[11.5px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
        />
        <kbd className="pointer-events-none inline-flex h-4 select-none items-center gap-0.5 rounded bg-muted/60 border border-border/40 px-1 font-mono text-[9px] text-muted-foreground/50 shrink-0">
          {isMac ? '⌘' : '⌃'}K
        </kbd>
      </div>

      {showResults && results.length > 0 && createPortal(
        <div
          ref={dropdownRef}
          className="fixed overflow-hidden rounded-xl border border-border bg-popover text-foreground shadow-2xl animate-in fade-in zoom-in-95 duration-100 z-[99999]"
          style={{
            top: (containerRef.current?.getBoundingClientRect().bottom ?? 80) + 4,
            left: containerRef.current?.getBoundingClientRect().left ?? 0,
            width: containerRef.current?.getBoundingClientRect().width ?? 240,
          }}
        >
          <div className="px-3 py-1.5 border-b border-border/40">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{results.length} result{results.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="max-h-[320px] overflow-auto">
            {results.map((r, i) => (
              <button
                key={r.id ?? r.issue_id ?? r.identifier ?? r.issue_identifier ?? `r-${i}`}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-foreground/[0.04] transition-colors border-b border-border/20 last:border-0"
                onClick={() => {
                  const id = r.identifier ?? r.issue_identifier
                  if (id) onResultClick?.(id)
                  setShowResults(false)
                  setQuery('')
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold text-primary shrink-0">{r.identifier ?? r.issue_identifier ?? '—'}</span>
                  <span className="truncate text-[11.5px] font-medium text-foreground">{r.title ?? 'Untitled'}</span>
                </div>
                {r.state && <span className="text-[10px] text-muted-foreground/50">{r.state}</span>}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function NavItem({ item, activeSection, onItemClick }: {
  item: SidebarItem
  activeSection: string
  onItemClick: (id: string) => void
}) {
  const Icon = item.icon
  const active = activeSection === item.id
  const hasDrilldown = DRILLDOWN_SECTIONS.has(item.id)
  return (
    <button
      type="button"
      onClick={() => onItemClick(item.id)}
      aria-current={active ? 'page' : undefined}
      data-testid={`sidebar-nav-${item.id}`}
      className={`w-full flex items-center gap-3 h-11 px-3 rounded-lg text-left transition-colors relative ${
        active
          ? 'bg-foreground/[0.08] text-foreground'
          : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04]'
      }`}
    >
      {active && <span className="absolute left-0 w-[2px] h-6 rounded-r-full bg-primary" />}
      <Icon
        className={`size-[17px] shrink-0 ${active ? 'text-primary' : ''}`}
        strokeWidth={active ? 2.2 : 1.8}
      />
      <span className={`text-[13.5px] truncate flex-1 ${active ? 'font-semibold' : 'font-medium'}`}>
        {item.label}
      </span>
      {hasDrilldown && (
        <ChevronRight size={13} className="shrink-0 text-muted-foreground/30" strokeWidth={2} />
      )}
    </button>
  )
}

function PrimaryNav({
  items,
  activeSection,
  onItemClick,
}: {
  items: SidebarItem[]
  activeSection: string
  onItemClick: (id: string) => void
}) {
  const config = useAppStore(s => s.config)
  const mainItems = items.filter(i => i.id !== 'SETTINGS' && i.id !== 'DOCS')
  const docsItem = items.find(i => i.id === 'DOCS')
  const settingsItem = items.find(i => i.id === 'SETTINGS')

  const openSwagger = () => {
    if (!config) return
    const url = `${config.baseUrl}/api/docs`
    const bridge = (window as { orchestraDesktop?: { openExternal?: (u: string) => void } }).orchestraDesktop
    if (bridge?.openExternal) bridge.openExternal(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <nav className="flex flex-col h-full py-2 px-2" aria-label="Primary navigation">
      <div className="flex-1 overflow-y-auto space-y-0.5">
        {mainItems.map((item) => (
          <NavItem key={item.id} item={item} activeSection={activeSection} onItemClick={onItemClick} />
        ))}
      </div>

      <div className="shrink-0 pt-2 mt-2 border-t border-border/20 space-y-0.5">
        {docsItem && (
          <NavItem item={docsItem} activeSection={activeSection} onItemClick={onItemClick} />
        )}
        {config && (
          <button
            type="button"
            onClick={openSwagger}
            className="w-full flex items-center gap-3 h-11 px-3 rounded-lg text-left text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
          >
            <Globe className="size-[17px] shrink-0" strokeWidth={1.8} />
            <span className="text-[13.5px] font-medium truncate flex-1">API Docs</span>
            <ChevronRight size={13} className="shrink-0 text-muted-foreground/30" strokeWidth={2} />
          </button>
        )}
        {settingsItem && (
          <NavItem item={settingsItem} activeSection={activeSection} onItemClick={onItemClick} />
        )}
      </div>
    </nav>
  )
}

function SubNavHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-2 pb-1.5 shrink-0 border-b border-border/20 mb-1">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 h-8 px-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.06] transition-colors w-full"
      >
        <ChevronLeft size={14} strokeWidth={2} className="shrink-0" />
        <span className="text-[12.5px] font-semibold">{label}</span>
      </button>
    </div>
  )
}

function SubNavList<T extends { id: string; label: string; icon?: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }>({
  items,
  activeId,
  onSelect,
}: {
  items: readonly T[]
  activeId: string | null | undefined
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon
        const active = activeId === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-left transition-colors relative ${
              active
                ? 'bg-foreground/[0.08] text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04]'
            }`}
          >
            {active && <span className="absolute left-0 w-[2px] h-5 rounded-r-full bg-primary" />}
            {Icon && (
              <Icon size={14} strokeWidth={active ? 2.2 : 1.8} className={`shrink-0 ${active ? 'text-primary' : ''}`} />
            )}
            <span className={`text-[12.5px] truncate ${active ? 'font-semibold' : 'font-medium'}`}>
              {item.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function SettingsSubNav({ onBack }: { onBack: () => void }) {
  const activeId = useAppStore(s => s.activeSettingsSection)
  const scrollTo = useAppStore(s => s.scrollToSettingsSection)

  return (
    <div className="flex flex-col h-full">
      <SubNavHeader label="Settings" onBack={onBack} />
      <SubNavList
        items={SETTINGS_SECTIONS}
        activeId={activeId}
        onSelect={(id) => scrollTo?.(id)}
      />
    </div>
  )
}

function ProjectsSubNav({
  projects, selectedId, onSelect, onCreateProject, onBack,
}: {
  projects: Project[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreateProject: () => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      <SubNavHeader label="Projects" onBack={onBack} />
      <div className="px-2 pb-1.5 shrink-0">
        <button
          type="button"
          onClick={onCreateProject}
          className="w-full flex items-center gap-2 h-8 px-2.5 rounded-lg text-left text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04] transition-colors border border-dashed border-border/50 hover:border-border"
        >
          <Plus size={13} strokeWidth={2} className="shrink-0" />
          <span className="text-[12px] font-medium">New project</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {projects.length === 0 && (
          <p className="text-[11.5px] text-muted-foreground/40 p-2">No projects yet</p>
        )}
        {projects.map((p) => {
          const active = p.id === selectedId
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className={`w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-left transition-colors relative ${
                active
                  ? 'bg-foreground/[0.08] text-foreground'
                  : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04]'
              }`}
            >
              {active && <span className="absolute left-0 w-[2px] h-5 rounded-r-full bg-primary" />}
              {active
                ? <FolderOpen size={14} strokeWidth={2.2} className="text-primary shrink-0" />
                : <Folder size={14} strokeWidth={1.8} className="shrink-0" />
              }
              <span className={`text-[12.5px] truncate flex-1 ${active ? 'font-semibold' : 'font-medium'}`}>
                {p.name}
              </span>
              {p.issue_source_type && (
                <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">{p.issue_source_type}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ConsoleSubNav({ onBack }: { onBack: () => void }) {
  const activePanel = useAppStore(s => s.activeLeftPanel)
  const setActivePanel = useAppStore(s => s.setActiveLeftPanel)
  const projects = useAppStore(s => s.projects)

  return (
    <div className="flex flex-col h-full">
      {/* Back + panel switcher row */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1.5 shrink-0 border-b border-border/20">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 h-8 px-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
        >
          <ChevronLeft size={14} strokeWidth={2} className="shrink-0" />
        </button>
        <button
          type="button"
          onClick={() => setActivePanel('explorer')}
          className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium transition-colors ${
            activePanel === 'explorer' ? 'bg-foreground/[0.08] text-foreground' : 'text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04]'
          }`}
        >
          <Folder size={13} strokeWidth={activePanel === 'explorer' ? 2.2 : 1.8} />
          Explorer
        </button>
        <button
          type="button"
          onClick={() => setActivePanel('search')}
          className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium transition-colors ${
            activePanel === 'search' ? 'bg-foreground/[0.08] text-foreground' : 'text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04]'
          }`}
        >
          <Search size={13} strokeWidth={activePanel === 'search' ? 2.2 : 1.8} />
          Search
        </button>
      </div>

      {/* Project switcher */}
      <div className="px-2 py-1.5 border-b border-border/20 shrink-0">
        <ProjectSwitcher projects={projects} />
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activePanel === 'explorer' && <FileExplorer />}
        {activePanel === 'search' && <WorkspaceSearch />}
      </div>
    </div>
  )
}

function AgentsSubNav({ onBack }: { onBack: () => void }) {
  const activeProvider = useAppStore(s => s.activeAgentProvider)
  const setActiveProvider = useAppStore(s => s.setActiveAgentProvider)
  const activeCategory = useAppStore(s => s.activeAgentCategory)
  const setActiveCategory = useAppStore(s => s.setActiveAgentCategory)
  const requestAgentHubNav = useAppStore(s => s.requestAgentHubNav)
  const agentCategories = useAppStore(s => s.agentCategories)
  const agentCategoryCounts = useAppStore(s => s.agentCategoryCounts)
  const scope = useAppStore(s => s.activeAgentScope)
  const projectId = useAppStore(s => s.activeAgentProjectId)
  const projects = useAppStore(s => s.projects)
  const setScope = (s: 'GLOBAL' | 'PROJECT', pid = '') =>
    useAppStore.getState().setActiveAgentScope(s, pid)

  const scopeOptions = [
    { label: 'Global', value: 'GLOBAL' },
    ...projects.map(p => ({ label: p.name, value: p.id })),
  ]

  return (
    <div className="flex flex-col h-full">
      <SubNavHeader label="Agents" onBack={onBack} />

      {/* Provider icon tabs */}
      <div className="px-2 pb-2 shrink-0 flex items-center gap-1 flex-wrap">
        {PROVIDERS.map(({ id, label, description }) => {
          const active = activeProvider === id
          return (
            <AppTooltip
              key={id}
              content={<div className="flex flex-col gap-0.5"><span>{label}</span><span className="text-[8px] font-bold text-muted-foreground/70 normal-case tracking-normal">{description}</span></div>}
              side="right"
            >
              <button
                type="button"
                onClick={() => setActiveProvider(id)}
                className={`flex items-center justify-center size-9 rounded-lg transition-all ${
                  active
                    ? 'bg-primary/15 border border-primary/30'
                    : 'border border-transparent hover:bg-muted/30 hover:border-border/20'
                }`}
                aria-label={label}
                aria-pressed={active}
              >
                {getAgentIcon(id, 20)}
              </button>
            </AppTooltip>
          )
        })}
      </div>

      {/* Scope selector */}
      <div className="px-2 pb-2 shrink-0">
        <CustomDropdown
          value={scope === 'GLOBAL' ? 'GLOBAL' : projectId}
          options={scopeOptions}
          onChange={(val) => {
            if (val === 'GLOBAL') setScope('GLOBAL', '')
            else setScope('PROJECT', val)
          }}
          placeholder="Scope"
        />
      </div>

      <div className="h-px bg-border/20 mx-2 mb-1 shrink-0" />

      {/* Category list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {agentCategories.map((cat) => {
          const Icon = cat.icon as LucideIcon | undefined
          const active = activeCategory === cat.id
          const count = agentCategoryCounts[cat.id] ?? 0
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => requestAgentHubNav(() => setActiveCategory(cat.id))}
              className={`w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-left transition-colors relative ${
                active
                  ? 'bg-foreground/[0.08] text-foreground'
                  : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04]'
              }`}
            >
              {active && <span className="absolute left-0 w-[2px] h-5 rounded-r-full bg-primary" />}
              {Icon && typeof Icon !== 'string' && (
                <Icon size={14} strokeWidth={active ? 2.2 : 1.8} className={`shrink-0 ${active ? 'text-primary' : ''}`} />
              )}
              <span className={`text-[12.5px] truncate flex-1 ${active ? 'font-semibold' : 'font-medium'}`}>
                {cat.label}
              </span>
              {count > 0 && (
                <span className="text-[10px] font-bold text-muted-foreground/40 tabular-nums shrink-0">{count}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DocsSubNav({ onBack }: { onBack: () => void }) {
  const docTree = useAppStore(s => s.docTree)
  const activeDocPath = useAppStore(s => s.activeDocPath)
  const setActiveDocPath = useAppStore(s => s.setActiveDocPath)
  const expandedDocFolders = useAppStore(s => s.expandedDocFolders)
  const toggleDocFolder = useAppStore(s => s.toggleDocFolder)
  const [searchQuery, setSearchQuery] = useState('')

  const filterTree = (items: DocItem[], query: string): DocItem[] => {
    if (!query) return items
    return items.reduce<DocItem[]>((acc, item) => {
      if (item.is_folder) {
        const children = filterTree(item.children ?? [], query)
        if (children.length) acc.push({ ...item, children })
      } else if (item.name.toLowerCase().includes(query.toLowerCase())) {
        acc.push(item)
      }
      return acc
    }, [])
  }

  const displayName = (item: DocItem) =>
    item.name === 'index.md' ? 'Overview' : item.name.replace('.md', '').replace(/[-_]/g, ' ')

  const renderTree = (items: DocItem[], level = 0, parentDir?: string): React.ReactNode =>
    sortDocItems(items, parentDir).map((item) => {
      if (item.is_folder) {
        const expanded = expandedDocFolders.has(item.path)
        return (
          <div key={item.path}>
            <button
              type="button"
              onClick={() => toggleDocFolder(item.path)}
              className="group w-full flex items-center gap-2 h-8 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04] transition-colors text-left"
              style={{ paddingLeft: `${level * 10 + 8}px`, paddingRight: '8px' }}
            >
              {expanded
                ? <FolderOpen size={13} strokeWidth={1.75} className="shrink-0" />
                : <Folder size={13} strokeWidth={1.75} className="shrink-0" />
              }
              <span className="flex-1 truncate text-[12px] font-medium capitalize">{displayName(item)}</span>
              <ChevronRight size={11} className={`shrink-0 transition-transform text-muted-foreground/30 ${expanded ? 'rotate-90' : ''}`} />
            </button>
            {expanded && item.children && renderTree(item.children, level + 1, item.name)}
          </div>
        )
      }
      const active = activeDocPath === item.path
      return (
        <button
          key={item.path}
          type="button"
          onClick={() => setActiveDocPath(item.path)}
          className={`group relative w-full flex items-center gap-2 h-8 rounded-md transition-colors text-left ${
            active ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04]'
          }`}
          style={{ paddingLeft: `${level * 10 + 8}px`, paddingRight: '8px' }}
        >
          {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />}
          <FileText size={13} strokeWidth={active ? 2.25 : 1.75} className={`shrink-0 ${active ? 'text-primary' : ''}`} />
          <span className={`flex-1 truncate text-[12px] capitalize ${active ? 'font-semibold' : 'font-medium'}`}>
            {displayName(item)}
          </span>
        </button>
      )
    })

  const filtered = sortDocItems(filterTree(docTree, searchQuery))

  return (
    <div className="flex flex-col h-full">
      <SubNavHeader label="Documentation" onBack={onBack} />
      <div className="px-2 pb-2 shrink-0 flex items-center gap-1">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
          <input
            type="text"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-7 pl-7 pr-2 bg-muted/30 rounded-md text-[11.5px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <button
          type="button"
          onClick={() => useAppStore.getState().setDocTree([])}
          title="Refresh"
          className="size-7 shrink-0 grid place-items-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
        >
          <RefreshCcw size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4 flex flex-col gap-0.5">
        {docTree.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/40 px-2 py-3 text-center">No documentation loaded</p>
        ) : renderTree(filtered)}
      </div>
    </div>
  )
}
