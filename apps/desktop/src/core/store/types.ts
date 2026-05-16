/**
 * Zustand store slice type definitions.
 *
 * Each slice owns a vertical domain of application state.
 * Implementations live in ./slices/<name>.ts (created in Tasks 2-5).
 */

import type { SectionID } from '@layout/sections'
import type {
  SnapshotPayload,
  GlobalStats,
  Project,
  ProjectStats,
  BackendConfig,
  BridgeProfilesPayload,
  DocItem,
} from '@core/api/types'
import type { TimelineItem } from '@layout/types'
import type { IssueListItem } from '@core/api/client'
import type { TerminalNode } from '@features/terminal/TerminalMultiplexer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type TreeNode = {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  depth: number
}

type DirCache = {
  children: TreeNode[]
  loading: boolean
}

type ToolSummary = {
  name: string
  description?: string
}

type AgentConfig = {
  commands: Record<string, string>
  agent_provider: string
  max_turns: number
}

type SettingsTab = 'agents' | 'backend' | 'integrations' | 'shortcuts' | 'notifications'

/** Initial column/state for the create-task dialog. The dialog reads `state`
 * to preselect the column the new task lands in. Add fields here only when
 * the dialog actually consumes them. */
type CreateTaskInitialState = {
  state: string
}

type SearchMatch = { line: number; text: string }
export type SearchResultGroup = { file: string; relativePath: string; matches: SearchMatch[] }

// ---------------------------------------------------------------------------
// Tab groups (Orca-style split layouts)
// ---------------------------------------------------------------------------

/** A reference to a tab — points at an editor file, browser tab, or terminal. */
export type TabRef =
  | { type: 'editor'; id: string }
  | { type: 'browser'; id: string }
  | { type: 'terminal'; id: string }

/** A single tab group: its own tab strip + active tab. */
export interface TabGroup {
  id: string
  tabs: TabRef[]
  activeTabId: string | null
}

/** Recursive layout tree — leaves point at group IDs, branches are splits. */
export type TabGroupLayoutNode =
  | { kind: 'leaf'; groupId: string }
  | {
      kind: 'split'
      direction: 'horizontal' | 'vertical' // horizontal = side-by-side, vertical = stacked
      first: TabGroupLayoutNode
      second: TabGroupLayoutNode
      ratio: number // 0..1, share of the first child
    }

/**
 * Special workspace context ID for tabs not tied to a specific project.
 * Acts as the "Global" project tab — terminals/browsers/files opened
 * outside any project end up here.
 */
export const GLOBAL_PROJECT_ID = '__global__'

/**
 * A workspace context — either a real project (id matches a Project.id)
 * or the global context.
 */
export type WorkspaceContextID = string

// ---------------------------------------------------------------------------
// UI Slice
// ---------------------------------------------------------------------------

export interface UISlice {
  // State
  activeSection: SectionID
  sidebarCollapsed: boolean
  theme: 'light' | 'dark'
  activePeriod: 'Today' | 'Week' | 'Month'
  paletteOpen: boolean
  inspectDialogOpen: boolean
  sessionInspectDialogOpen: boolean
  createTaskDialogOpen: boolean
  createTaskInitialState: CreateTaskInitialState | null
  createProjectDialogOpen: boolean
  settingsInitialTab: SettingsTab | undefined
  browserHomepage: string
  sidePanelOpen: boolean
  activeSettingsSection: string
  scrollToSettingsSection: ((id: string) => void) | null
  activeAgentProvider: 'claude' | 'codex' | 'gemini' | 'opencode' | '8gent'
  activeAgentScope: 'GLOBAL' | 'PROJECT'
  activeAgentProjectId: string
  activeAgentCategory: string
  agentCategories: Array<{ id: string; label: string; icon: unknown }>
  agentCategoryCounts: Record<string, number>
  activeDocPath: string | null
  docTree: DocItem[]
  expandedDocFolders: Set<string>
  agentHubProjectId: string | null
  agentHubScope: 'GLOBAL' | 'PROJECT'
  agentHubDirty: boolean
  agentHubPendingNav: (() => void) | null

  // Actions
  setActiveSection: (section: SectionID) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setTheme: (theme: 'light' | 'dark') => void
  setBrowserHomepage: (url: string) => void
  setActivePeriod: (period: 'Today' | 'Week' | 'Month') => void
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
  setInspectDialogOpen: (open: boolean) => void
  setSessionInspectDialogOpen: (open: boolean) => void
  openCreateTaskDialog: (initialState?: CreateTaskInitialState) => void
  closeCreateTaskDialog: () => void
  setCreateProjectDialogOpen: (open: boolean) => void
  setSettingsInitialTab: (tab: SettingsTab | undefined) => void
  setSidePanelOpen: (v: boolean) => void
  toggleSidePanel: () => void
  setActiveSettingsSection: (id: string) => void
  setScrollToSettingsSection: (fn: ((id: string) => void) | null) => void
  setActiveAgentProvider: (provider: 'claude' | 'codex' | 'gemini' | 'opencode' | '8gent') => void
  setActiveAgentScope: (scope: 'GLOBAL' | 'PROJECT', projectId?: string) => void
  setActiveAgentCategory: (cat: string) => void
  setAgentCategories: (cats: Array<{ id: string; label: string; icon: unknown }>) => void
  setAgentCategoryCounts: (counts: Record<string, number>) => void
  setActiveDocPath: (path: string | null) => void
  setDocTree: (tree: DocItem[]) => void
  toggleDocFolder: (path: string) => void
  setAgentHubProjectId: (id: string | null) => void
  setAgentHubScope: (scope: 'GLOBAL' | 'PROJECT') => void
  setAgentHubDirty: (dirty: boolean) => void
  /** Request a navigation that may need a discard-confirm. If the agent hub is dirty, the action is stashed in agentHubPendingNav for the dashboard to confirm; otherwise it is applied immediately. */
  requestAgentHubNav: (apply: () => void) => void
  setAgentHubPendingNav: (apply: (() => void) | null) => void
}

// ---------------------------------------------------------------------------
// Runtime Slice
// ---------------------------------------------------------------------------

export interface RuntimeSlice {
  // State
  snapshot: SnapshotPayload | null
  timeline: TimelineItem[]
  loadingState: boolean
  statusMessage: string
  usePolling: boolean
  refreshPending: boolean

  // Actions
  setSnapshot: (snapshot: SnapshotPayload | null) => void
  updateSnapshot: (partial: Partial<SnapshotPayload>) => void
  addTimelineEvent: (event: TimelineItem) => void
  setLoadingState: (loading: boolean) => void
  setStatusMessage: (message: string) => void
  setUsePolling: (polling: boolean) => void
  togglePolling: () => void
  setRefreshPending: (pending: boolean) => void
}

// ---------------------------------------------------------------------------
// Issues Slice
// ---------------------------------------------------------------------------

export interface IssuesSlice {
  // State
  boardIssues: IssueListItem[]
  githubBacklogIssues: IssueListItem[]
  allBoardIssues: IssueListItem[]

  // Actions
  setBoardIssues: (issues: IssueListItem[]) => void
  setGithubBacklogIssues: (issues: IssueListItem[]) => void
}

// ---------------------------------------------------------------------------
// Projects Slice
// ---------------------------------------------------------------------------

export interface ProjectsSlice {
  // State
  projects: Project[]
  projectStats: Record<string, ProjectStats>
  warehouseStats: GlobalStats | null
  selectedProjectID: string | null
  dataLoading: boolean

  // Actions
  setProjects: (projects: Project[]) => void
  setProjectStats: (stats: Record<string, ProjectStats>) => void
  setWarehouseStats: (stats: GlobalStats | null) => void
  setSelectedProjectID: (id: string | null) => void
  setDataLoading: (loading: boolean) => void
}

// ---------------------------------------------------------------------------
// Agents Slice
// ---------------------------------------------------------------------------

export interface AgentsSlice {
  // State
  agentConfig: AgentConfig | null
  availableAgents: string[]
  allTools: ToolSummary[]

  // Actions
  setAgentConfig: (config: AgentConfig | null) => void
  setAvailableAgents: (agents: string[]) => void
  setAllTools: (tools: ToolSummary[]) => void
}

// ---------------------------------------------------------------------------
// Settings Slice
// ---------------------------------------------------------------------------

export interface SettingsSlice {
  // State
  config: BackendConfig | null
  loadingConfig: boolean
  backendProfiles: BridgeProfilesPayload | null
  activeProfileId: string | null

  // Actions
  setConfig: (config: BackendConfig | null) => void
  setLoadingConfig: (loading: boolean) => void
  setBackendProfiles: (profiles: BridgeProfilesPayload | null) => void
  setActiveProfileId: (id: string | null) => void
}

// ---------------------------------------------------------------------------
// Terminals Slice
// ---------------------------------------------------------------------------

export interface TerminalsSlice {
  // State
  openTerminals: TerminalNode[]

  // Actions
  setOpenTerminals: (terminals: TerminalNode[]) => void
}

// ---------------------------------------------------------------------------
// Workspace Slice
// ---------------------------------------------------------------------------

type ActiveWorkspaceTab = { type: 'terminal' | 'editor' | 'browser'; id: string } | null

export interface WorkspaceSlice {
  // State
  explorerRoot: string | null // active project's explorer root (derived)
  projectExplorerRoots: Record<WorkspaceContextID, string | null> // per-project explorer roots
  activeProjectId: WorkspaceContextID
  openProjectIds: WorkspaceContextID[] // ordered list of project tabs (including GLOBAL_PROJECT_ID)

  /**
   * Tab-group state, scoped per-project. Each project has:
   *  - groups: a flat dict of all tab groups by id
   *  - layout: the recursive split tree (leaves reference groupIds)
   *  - focusedGroupId: which group is "active" (where new tabs land, where shortcuts target)
   * Created lazily — accessed via the helper actions below.
   */
  projectGroups: Record<WorkspaceContextID, Record<string, TabGroup>>
  projectLayouts: Record<WorkspaceContextID, TabGroupLayoutNode>
  projectFocusedGroupId: Record<WorkspaceContextID, string>

  activeLeftPanel: 'explorer' | 'search' | 'issues'
  leftSidebarOpen: boolean
  leftSidebarWidth: number
  rightSidebarWidth: number
  rightSidebarOpen: boolean
  expandedDirs: Set<string>
  dirCache: Record<string, DirCache>
  gitStatusMap: Record<string, string>
  searchQuery: string
  searchResults: SearchResultGroup[]
  searchLoading: boolean
  activeWorkspaceTab: ActiveWorkspaceTab

  // Actions
  setExplorerRoot: (root: string | null) => void // sets root for active project
  setActiveProjectId: (id: WorkspaceContextID) => void
  openProjectTab: (id: WorkspaceContextID, explorerRoot?: string | null) => void
  closeProjectTab: (id: WorkspaceContextID) => void
  setActiveLeftPanel: (panel: 'explorer' | 'search' | 'issues') => void
  setLeftSidebarOpen: (open: boolean) => void
  toggleLeftSidebar: () => void
  setLeftSidebarWidth: (width: number) => void
  setRightSidebarWidth: (width: number) => void
  setRightSidebarOpen: (open: boolean) => void
  toggleRightSidebar: () => void
  toggleDir: (dirPath: string) => void
  setDirChildren: (dirPath: string, children: TreeNode[]) => void
  setDirLoading: (dirPath: string, loading: boolean) => void
  setGitStatusMap: (statusMap: Record<string, string>) => void
  clearExplorerCache: () => void
  setSearchQuery: (query: string) => void
  setSearchResults: (results: SearchResultGroup[]) => void
  setSearchLoading: (loading: boolean) => void
  setActiveWorkspaceTab: (tab: ActiveWorkspaceTab) => void

  // ---- Tab-group actions --------------------------------------------------
  /** Add a tab to a project's focused group (or a specific group). Activates it. */
  addTabToGroup: (projectId: WorkspaceContextID, ref: TabRef, groupId?: string) => void
  /** Remove a tab from its group. If the tab was active, activates the previous one. */
  removeTabFromGroup: (projectId: WorkspaceContextID, tabId: string) => void
  /** Activate a tab inside its group. Also focuses the containing group. */
  activateTabInGroup: (projectId: WorkspaceContextID, tabId: string) => void
  /** Split a group into two side-by-side / stacked groups. New group is empty + focused. */
  splitGroup: (projectId: WorkspaceContextID, groupId: string, direction: 'horizontal' | 'vertical') => void
  /** Close a group: removes it from the layout tree and disposes its tabs (caller decides closing the underlying resource). */
  closeGroup: (projectId: WorkspaceContextID, groupId: string) => void
  /** Move a tab from one group to another. */
  moveTabBetweenGroups: (projectId: WorkspaceContextID, tabId: string, dstGroupId: string) => void
  /** Reorder tabs inside a single group by index. */
  reorderTabsInGroup: (projectId: WorkspaceContextID, groupId: string, fromIndex: number, toIndex: number) => void
  /** Update split ratio between siblings. nodePath is a string path of 'first'/'second' steps from the root. */
  setGroupSplitRatio: (projectId: WorkspaceContextID, nodePath: string, ratio: number) => void
  /** Focus a group (where new tabs land + which group is "current"). */
  setFocusedGroup: (projectId: WorkspaceContextID, groupId: string) => void
}

// ---------------------------------------------------------------------------
// Editor Slice
// ---------------------------------------------------------------------------

export type OpenFile = {
  id: string
  filePath: string
  relativePath: string
  language: string
  isDirty: boolean
  content: string | null // null = not yet loaded
  loadError?: string | null
  loading?: boolean
  pendingReveal?: number | null // line number to scroll to on next render
  projectId: WorkspaceContextID // GLOBAL_PROJECT_ID if not tied to a project
}

export type EditorSettings = {
  fontSize: number
  fontFamily: string
  tabSize: number
  wordWrap: 'on' | 'off' | 'wordWrapColumn' | 'bounded'
  lineNumbers: 'on' | 'off' | 'relative'
  minimap: boolean
  formatOnSave: boolean
  renderWhitespace: 'none' | 'boundary' | 'selection' | 'all'
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 13,
  fontFamily: '',
  tabSize: 2,
  wordWrap: 'on',
  lineNumbers: 'on',
  minimap: false,
  formatOnSave: false,
  renderWhitespace: 'none',
}

export interface EditorSlice {
  openFiles: OpenFile[]
  activeFileId: string | null
  editorSettings: EditorSettings
  openFile: (filePath: string, relativePath: string, revealLine?: number, projectId?: WorkspaceContextID) => void
  closeFile: (fileId: string) => void
  setActiveFile: (fileId: string) => void
  setFileDirty: (fileId: string, isDirty: boolean) => void
  setFileContent: (fileId: string, content: string) => void
  loadFileContent: (fileId: string) => Promise<void>
  clearPendingReveal: (fileId: string) => void
  setEditorSettings: (patch: Partial<EditorSettings>) => void
}

// ---------------------------------------------------------------------------
// Browser Slice
// ---------------------------------------------------------------------------

export type BrowserTab = {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  projectId: WorkspaceContextID
}

export interface BrowserSlice {
  browserTabs: BrowserTab[]
  activeBrowserTabId: string | null
  openBrowserTab: (url?: string, projectId?: WorkspaceContextID) => void
  closeBrowserTab: (tabId: string) => void
  setActiveBrowserTab: (tabId: string) => void
  updateBrowserTab: (tabId: string, updates: Partial<BrowserTab>) => void
}

// ---------------------------------------------------------------------------
// Composite App State
// ---------------------------------------------------------------------------

import type { ThemeSlice } from './slices/theme.slice'

export type AppState = UISlice &
  RuntimeSlice &
  IssuesSlice &
  ProjectsSlice &
  AgentsSlice &
  SettingsSlice &
  TerminalsSlice &
  WorkspaceSlice &
  EditorSlice &
  BrowserSlice &
  ThemeSlice
