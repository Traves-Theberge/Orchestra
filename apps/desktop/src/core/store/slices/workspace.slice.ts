/**
 * Workspace slice — project tabs, file explorer, sidebar dimensions, panel state.
 */

import type { StateCreator } from 'zustand'
import { GLOBAL_PROJECT_ID } from '../types'
import type { AppState, WorkspaceSlice, TreeNode, WorkspaceContextID, TabRef, TabGroup, TabGroupLayoutNode } from '../types'
import { newGroupId, splitLeaf, removeLeaf, updateNodeAtPath, collectGroupIds } from '../group-helpers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEFT_SIDEBAR_MIN = 220
const LEFT_SIDEBAR_MAX = 500
const RIGHT_SIDEBAR_MIN = 280
const RIGHT_SIDEBAR_MAX = 500

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createWorkspaceSlice: StateCreator<AppState, [], [], WorkspaceSlice> = (set, get) => ({
  // ---- State ----------------------------------------------------------------
  explorerRoot: null,
  projectExplorerRoots: {},
  activeProjectId: GLOBAL_PROJECT_ID, // GLOBAL is the implicit "no project" state, not shown as a tab
  openProjectIds: [],
  projectGroups: {},
  projectLayouts: {},
  projectFocusedGroupId: {},
  activeLeftPanel: 'explorer',
  leftSidebarOpen: true,
  leftSidebarWidth: 280,
  rightSidebarWidth: 320,
  rightSidebarOpen: true,
  expandedDirs: new Set<string>(),
  dirCache: {},
  gitStatusMap: {},
  searchQuery: '',
  searchResults: [],
  searchLoading: false,
  activeWorkspaceTab: null,

  // ---- Actions --------------------------------------------------------------
  setExplorerRoot: (root) =>
    set((s) => ({
      explorerRoot: root,
      projectExplorerRoots: { ...s.projectExplorerRoots, [s.activeProjectId]: root },
    })),

  setActiveProjectId: (id: WorkspaceContextID) => {
    const state = get()
    const root = state.projectExplorerRoots[id] ?? null
    set({
      activeProjectId: id,
      explorerRoot: root,
      // Reset transient explorer caches so the tree reflects the new project
      expandedDirs: new Set<string>(),
      dirCache: {},
      gitStatusMap: {},
      // Clear active tab — it'll be repopulated by the workspace content layer
      activeWorkspaceTab: null,
      // Clear search so it doesn't show stale results from the prior project
      searchQuery: '',
      searchResults: [],
    })
  },

  openProjectTab: (id: WorkspaceContextID, explorerRoot?: string | null) => {
    const state = get()
    const exists = state.openProjectIds.includes(id)
    set({
      openProjectIds: exists ? state.openProjectIds : [...state.openProjectIds, id],
      projectExplorerRoots: {
        ...state.projectExplorerRoots,
        [id]: explorerRoot !== undefined ? explorerRoot : state.projectExplorerRoots[id] ?? null,
      },
    })
    // Activate it
    get().setActiveProjectId(id)
  },

  closeProjectTab: (id: WorkspaceContextID) => {
    if (id === GLOBAL_PROJECT_ID) return
    const state = get()
    const remaining = state.openProjectIds.filter((p) => p !== id)
    const nextActive =
      state.activeProjectId === id
        ? remaining[remaining.length - 1] ?? GLOBAL_PROJECT_ID
        : state.activeProjectId
    const { [id]: _removed, ...remainingRoots } = state.projectExplorerRoots
    void _removed
    set({
      openProjectIds: remaining,
      projectExplorerRoots: remainingRoots,
    })
    if (nextActive !== state.activeProjectId) {
      get().setActiveProjectId(nextActive)
    }
  },

  setActiveLeftPanel: (panel) => set({ activeLeftPanel: panel }),

  setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),

  toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),

  setLeftSidebarWidth: (width) =>
    set({ leftSidebarWidth: clamp(width, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX) }),

  setRightSidebarWidth: (width) =>
    set({ rightSidebarWidth: clamp(width, RIGHT_SIDEBAR_MIN, RIGHT_SIDEBAR_MAX) }),

  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),

  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),

  toggleDir: (dirPath: string) =>
    set((s) => {
      const next = new Set(s.expandedDirs)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return { expandedDirs: next }
    }),

  setDirChildren: (dirPath: string, children: TreeNode[]) =>
    set((s) => ({
      dirCache: { ...s.dirCache, [dirPath]: { children, loading: false } },
    })),

  setDirLoading: (dirPath: string, loading: boolean) =>
    set((s) => {
      const existing = s.dirCache[dirPath]
      return {
        dirCache: {
          ...s.dirCache,
          [dirPath]: { children: existing?.children ?? [], loading },
        },
      }
    }),

  setGitStatusMap: (statusMap: Record<string, string>) =>
    set({ gitStatusMap: statusMap }),

  clearExplorerCache: () =>
    set({ expandedDirs: new Set<string>(), dirCache: {}, gitStatusMap: {} }),

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchResults: (results) => set({ searchResults: results }),
  setSearchLoading: (loading) => set({ searchLoading: loading }),
  setActiveWorkspaceTab: (tab) => set({ activeWorkspaceTab: tab }),

  // ---- Tab-group actions --------------------------------------------------
  addTabToGroup: (projectId, ref, groupId) => {
    const state = get()
    const ensure = ensureProjectGroups(state, projectId)
    const targetGroupId = groupId ?? ensure.focusedGroupId
    const groups = { ...ensure.groups }
    let layout = ensure.layout
    let focused = ensure.focusedGroupId

    // Look up which group the tab currently lives in (if any)
    const existingGroupId = findGroupForTab(groups, ref.id)

    if (existingGroupId) {
      // Already open — just activate it
      groups[existingGroupId] = {
        ...groups[existingGroupId],
        activeTabId: ref.id,
      }
      focused = existingGroupId
    } else {
      const target = groups[targetGroupId]
      if (!target) return
      groups[targetGroupId] = {
        ...target,
        tabs: [...target.tabs, ref],
        activeTabId: ref.id,
      }
      focused = targetGroupId
    }

    set({
      projectGroups: { ...state.projectGroups, [projectId]: groups },
      projectLayouts: { ...state.projectLayouts, [projectId]: layout },
      projectFocusedGroupId: { ...state.projectFocusedGroupId, [projectId]: focused },
    })
  },

  removeTabFromGroup: (projectId, tabId) => {
    const state = get()
    const groups = state.projectGroups[projectId]
    if (!groups) return
    const groupId = findGroupForTab(groups, tabId)
    if (!groupId) return
    const group = groups[groupId]
    const idx = group.tabs.findIndex((t) => t.id === tabId)
    const nextTabs = group.tabs.filter((t) => t.id !== tabId)
    let nextActive = group.activeTabId
    if (group.activeTabId === tabId) {
      if (nextTabs.length === 0) {
        nextActive = null
      } else {
        const fallbackIdx = Math.max(0, idx - 1)
        nextActive = nextTabs[fallbackIdx]?.id ?? null
      }
    }
    const nextGroups = {
      ...groups,
      [groupId]: { ...group, tabs: nextTabs, activeTabId: nextActive },
    }
    set({ projectGroups: { ...state.projectGroups, [projectId]: nextGroups } })
  },

  activateTabInGroup: (projectId, tabId) => {
    const state = get()
    const groups = state.projectGroups[projectId]
    if (!groups) return
    const groupId = findGroupForTab(groups, tabId)
    if (!groupId) return
    const nextGroups = {
      ...groups,
      [groupId]: { ...groups[groupId], activeTabId: tabId },
    }
    set({
      projectGroups: { ...state.projectGroups, [projectId]: nextGroups },
      projectFocusedGroupId: { ...state.projectFocusedGroupId, [projectId]: groupId },
    })
  },

  splitGroup: (projectId, groupId, direction) => {
    const state = get()
    const layout = state.projectLayouts[projectId]
    const groups = state.projectGroups[projectId]
    if (!layout || !groups || !groups[groupId]) return
    const newId = newGroupId()
    const newLayout = splitLeaf(layout, groupId, direction, newId)
    const newGroup: TabGroup = { id: newId, tabs: [], activeTabId: null }
    set({
      projectLayouts: { ...state.projectLayouts, [projectId]: newLayout },
      projectGroups: {
        ...state.projectGroups,
        [projectId]: { ...groups, [newId]: newGroup },
      },
      projectFocusedGroupId: { ...state.projectFocusedGroupId, [projectId]: newId },
    })
  },

  closeGroup: (projectId, groupId) => {
    const state = get()
    const layout = state.projectLayouts[projectId]
    const groups = state.projectGroups[projectId]
    if (!layout || !groups || !groups[groupId]) return
    const nextLayout = removeLeaf(layout, groupId)
    const { [groupId]: _removed, ...rest } = groups
    void _removed
    // If we removed the only group, create a fresh empty one
    let finalLayout: TabGroupLayoutNode
    let finalGroups = rest
    if (nextLayout === null) {
      const fresh = newGroupId()
      finalLayout = { kind: 'leaf', groupId: fresh }
      finalGroups = { ...rest, [fresh]: { id: fresh, tabs: [], activeTabId: null } }
    } else {
      finalLayout = nextLayout
    }
    // Move focus to any remaining group
    const remainingIds = collectGroupIds(finalLayout)
    const nextFocused = remainingIds[0] ?? newGroupId()
    set({
      projectLayouts: { ...state.projectLayouts, [projectId]: finalLayout },
      projectGroups: { ...state.projectGroups, [projectId]: finalGroups },
      projectFocusedGroupId: { ...state.projectFocusedGroupId, [projectId]: nextFocused },
    })
  },

  moveTabBetweenGroups: (projectId, tabId, dstGroupId) => {
    const state = get()
    const groups = state.projectGroups[projectId]
    if (!groups || !groups[dstGroupId]) return
    const srcGroupId = findGroupForTab(groups, tabId)
    if (!srcGroupId || srcGroupId === dstGroupId) return
    const src = groups[srcGroupId]
    const dst = groups[dstGroupId]
    const ref = src.tabs.find((t) => t.id === tabId)
    if (!ref) return
    const nextSrcTabs = src.tabs.filter((t) => t.id !== tabId)
    const nextSrcActive =
      src.activeTabId === tabId
        ? (nextSrcTabs[nextSrcTabs.length - 1]?.id ?? null)
        : src.activeTabId
    const nextGroups = {
      ...groups,
      [srcGroupId]: { ...src, tabs: nextSrcTabs, activeTabId: nextSrcActive },
      [dstGroupId]: { ...dst, tabs: [...dst.tabs, ref], activeTabId: ref.id },
    }
    set({
      projectGroups: { ...state.projectGroups, [projectId]: nextGroups },
      projectFocusedGroupId: { ...state.projectFocusedGroupId, [projectId]: dstGroupId },
    })
  },

  reorderTabsInGroup: (projectId, groupId, fromIndex, toIndex) => {
    const state = get()
    const groups = state.projectGroups[projectId]
    if (!groups || !groups[groupId]) return
    const group = groups[groupId]
    if (
      fromIndex < 0 || fromIndex >= group.tabs.length ||
      toIndex < 0 || toIndex > group.tabs.length ||
      fromIndex === toIndex
    ) return
    const next = group.tabs.slice()
    const [moved] = next.splice(fromIndex, 1)
    // When moving forward, the splice above shifts subsequent indices left by one.
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
    next.splice(insertAt, 0, moved)
    if (next.length === group.tabs.length && next.every((t, i) => t.id === group.tabs[i]?.id)) return
    set({
      projectGroups: {
        ...state.projectGroups,
        [projectId]: {
          ...groups,
          [groupId]: { ...group, tabs: next },
        },
      },
    })
  },

  setGroupSplitRatio: (projectId, nodePath, ratio) => {
    const state = get()
    const layout = state.projectLayouts[projectId]
    if (!layout) return
    const clamped = Math.min(0.85, Math.max(0.15, ratio))
    const next = updateNodeAtPath(layout, nodePath, (n) =>
      n.kind === 'split' ? { ...n, ratio: clamped } : n,
    )
    set({ projectLayouts: { ...state.projectLayouts, [projectId]: next } })
  },

  setFocusedGroup: (projectId, groupId) => {
    const state = get()
    if (!state.projectGroups[projectId]?.[groupId]) return
    set({
      projectFocusedGroupId: { ...state.projectFocusedGroupId, [projectId]: groupId },
    })
  },
})

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the project's tab-group state, lazily creating a default single
 * empty group if none exists yet. Does not mutate state — caller must apply.
 */
function ensureProjectGroups(
  state: AppState,
  projectId: WorkspaceContextID,
): { groups: Record<string, TabGroup>; layout: TabGroupLayoutNode; focusedGroupId: string } {
  const existingGroups = state.projectGroups[projectId]
  const existingLayout = state.projectLayouts[projectId]
  const existingFocus = state.projectFocusedGroupId[projectId]
  if (existingGroups && existingLayout && existingFocus && existingGroups[existingFocus]) {
    return { groups: existingGroups, layout: existingLayout, focusedGroupId: existingFocus }
  }
  const id = newGroupId()
  return {
    groups: { [id]: { id, tabs: [], activeTabId: null } },
    layout: { kind: 'leaf', groupId: id },
    focusedGroupId: id,
  }
}

/** Find which group a given tab currently lives in. */
function findGroupForTab(
  groups: Record<string, TabGroup>,
  tabId: string,
): string | null {
  for (const id of Object.keys(groups)) {
    if (groups[id].tabs.some((t) => t.id === tabId)) return id
  }
  return null
}
