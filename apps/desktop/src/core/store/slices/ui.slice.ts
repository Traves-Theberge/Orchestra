/**
 * UI slice — navigation, theme, modals, and palette state.
 */

import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { UISlice } from '../types'

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------

function getInitialTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem('orchestra-theme')
    if (stored === 'light' || stored === 'dark') return stored
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  } catch {
    // localStorage or matchMedia not available (e.g. in tests)
  }
  return 'dark'
}

function applyTheme(theme: 'light' | 'dark'): void {
  try {
    localStorage.setItem('orchestra-theme', theme)
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  } catch {
    // DOM not available (e.g. in tests)
  }
}

const HOMEPAGE_KEY = 'orchestra-browser-homepage'
const DEFAULT_HOMEPAGE = 'about:blank'

function normalizeHomepage(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return DEFAULT_HOMEPAGE
  if (trimmed.startsWith('about:') || trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('file://')) {
    return trimmed
  }
  return `https://${trimmed}`
}

function getInitialHomepage(): string {
  try {
    const stored = localStorage.getItem(HOMEPAGE_KEY)
    if (stored && stored.trim()) return stored
  } catch {
    // localStorage not available
  }
  return DEFAULT_HOMEPAGE
}

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createUISlice: StateCreator<AppState, [], [], UISlice> = (set, get) => ({
  // ---- State ----------------------------------------------------------------
  activeSection: 'ISSUES',
  sidebarCollapsed: false,
  theme: getInitialTheme(),
  activePeriod: 'Week',
  paletteOpen: false,
  inspectDialogOpen: false,
  sessionInspectDialogOpen: false,
  createTaskDialogOpen: false,
  createTaskInitialState: null,
  createProjectDialogOpen: false,
  settingsInitialTab: undefined,
  browserHomepage: getInitialHomepage(),
  sidePanelOpen: true,
  activeSettingsSection: 'connections',
  scrollToSettingsSection: null,
  activeAgentProvider: 'claude',
  activeAgentScope: 'GLOBAL',
  activeAgentProjectId: '',
  activeAgentCategory: 'settings',
  agentCategories: [],
  agentCategoryCounts: {},
  activeDocPath: null,
  docTree: [],
  expandedDocFolders: new Set(['plans', 'specs']),
  agentHubProjectId: null,
  agentHubScope: 'GLOBAL',
  agentHubDirty: false,
  agentHubPendingNav: null,

  // ---- Actions --------------------------------------------------------------
  setActiveSection: (section) => set({ activeSection: section }),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    // Bridge to the new theme slice so re-applying the active theme picks up
    // the mode change. setMode handles the actual CSS-var work.
    try {
      const setMode = (get() as AppState).setMode
      if (typeof setMode === 'function') setMode(theme)
    } catch { /* ignore — slice may not be attached yet during first init */ }
  },

  setActivePeriod: (period) => set({ activePeriod: period }),

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  setInspectDialogOpen: (open) => set({ inspectDialogOpen: open }),

  setSessionInspectDialogOpen: (open) => set({ sessionInspectDialogOpen: open }),

  openCreateTaskDialog: (initialState?) =>
    set({ createTaskDialogOpen: true, createTaskInitialState: initialState ?? null }),

  closeCreateTaskDialog: () =>
    set({ createTaskDialogOpen: false, createTaskInitialState: null }),

  setCreateProjectDialogOpen: (open) => set({ createProjectDialogOpen: open }),

  setSettingsInitialTab: (tab) => set({ settingsInitialTab: tab }),

  setBrowserHomepage: (url) => {
    const normalized = normalizeHomepage(url)
    try { localStorage.setItem(HOMEPAGE_KEY, normalized) } catch { /* unavailable in tests */ }
    set({ browserHomepage: normalized })
  },

  setSidePanelOpen: (v) => set({ sidePanelOpen: v }),

  toggleSidePanel: () => set((s) => ({ sidePanelOpen: !s.sidePanelOpen })),

  setActiveSettingsSection: (id) => set({ activeSettingsSection: id }),

  setScrollToSettingsSection: (fn) => set({ scrollToSettingsSection: fn }),

  setActiveAgentProvider: (provider) => set({ activeAgentProvider: provider }),

  setActiveAgentScope: (scope, projectId = '') => set({ activeAgentScope: scope, activeAgentProjectId: projectId }),

  setActiveAgentCategory: (cat) => set({ activeAgentCategory: cat }),

  setAgentCategories: (cats) => set({ agentCategories: cats }),

  setAgentCategoryCounts: (counts) => set({ agentCategoryCounts: counts }),

  setActiveDocPath: (path) => set({ activeDocPath: path }),

  setDocTree: (tree) => set({ docTree: tree }),

  toggleDocFolder: (path) => set((s) => {
    const next = new Set(s.expandedDocFolders)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return { expandedDocFolders: next }
  }),

  setAgentHubProjectId: (id) => set({ agentHubProjectId: id }),

  setAgentHubScope: (scope) => set({ agentHubScope: scope }),

  setAgentHubDirty: (dirty) => set({ agentHubDirty: dirty }),

  setAgentHubPendingNav: (apply) => set({ agentHubPendingNav: apply }),

  requestAgentHubNav: (apply) => {
    if (get().agentHubDirty) {
      set({ agentHubPendingNav: apply })
    } else {
      apply()
    }
  },
})
