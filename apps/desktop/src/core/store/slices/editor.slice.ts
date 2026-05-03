/**
 * Editor slice — manages open file tabs, active file, and dirty state.
 */

import type { StateCreator } from 'zustand'
import { DEFAULT_EDITOR_SETTINGS, GLOBAL_PROJECT_ID } from '../types'
import type { AppState, EditorSettings, EditorSlice, OpenFile, WorkspaceContextID } from '../types'

const EDITOR_SETTINGS_KEY = 'orchestra.editor.settings'

function loadEditorSettings(): EditorSettings {
  try {
    const stored = localStorage.getItem(EDITOR_SETTINGS_KEY)
    if (stored) return { ...DEFAULT_EDITOR_SETTINGS, ...JSON.parse(stored) }
  } catch { /* ignore */ }
  return { ...DEFAULT_EDITOR_SETTINGS }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    go: 'go',
    py: 'python',
    rs: 'rust',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sh: 'shell',
    bash: 'shell',
    sql: 'sql',
    graphql: 'graphql',
    dockerfile: 'dockerfile',
    xml: 'xml',
    svg: 'xml',
  }
  return map[ext] ?? 'plaintext'
}

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createEditorSlice: StateCreator<AppState, [], [], EditorSlice> = (set, get) => ({
  // ---- State ----------------------------------------------------------------
  openFiles: [],
  activeFileId: null,
  editorSettings: loadEditorSettings(),

  // ---- Actions --------------------------------------------------------------
  openFile: (filePath: string, relativePath: string, revealLine?: number, projectId?: WorkspaceContextID) => {
    const state = get()
    const { openFiles, config, activeProjectId } = state
    const targetProjectId = projectId ?? activeProjectId ?? GLOBAL_PROJECT_ID
    console.log('[editor] openFile', { filePath, relativePath, revealLine, projectId: targetProjectId, hasConfig: !!config?.baseUrl })
    const existing = openFiles.find((f) => f.filePath === filePath)
    if (existing) {
      set({
        activeFileId: existing.id,
        activeWorkspaceTab: { type: 'editor', id: existing.id },
        // If the file lives in a different project tab, switch to that project
        activeProjectId: existing.projectId,
        openFiles: openFiles.map((f) =>
          f.id === existing.id ? { ...f, pendingReveal: revealLine ?? f.pendingReveal ?? null } : f,
        ),
      })
      // Make sure the tab is reflected in some group of the project (and active).
      // The fn is part of WorkspaceSlice — guard for slice-isolated tests.
      get().addTabToGroup?.(existing.projectId, { type: 'editor', id: existing.id })
      if (existing.content === null && !existing.loading) {
        console.log('[editor] reactivating tab with null content, retrying load', filePath)
        get().loadFileContent(existing.id)
      }
      return
    }
    const newFile: OpenFile = {
      id: filePath,
      filePath,
      relativePath,
      language: detectLanguage(filePath),
      isDirty: false,
      content: null,
      loading: false,
      loadError: null,
      pendingReveal: revealLine ?? null,
      projectId: targetProjectId,
    }
    set({ openFiles: [...openFiles, newFile], activeFileId: newFile.id, activeWorkspaceTab: { type: 'editor', id: newFile.id } })
    // Register with the project's focused tab group (guard for slice-isolated tests)
    get().addTabToGroup?.(targetProjectId, { type: 'editor', id: newFile.id })
    get().loadFileContent(newFile.id)
  },

  clearPendingReveal: (fileId: string) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) => (f.id === fileId ? { ...f, pendingReveal: null } : f)),
    })),

  loadFileContent: async (fileId: string) => {
    const state = get()
    const file = state.openFiles.find((f) => f.id === fileId)
    if (!file) {
      console.warn('[editor] loadFileContent: file not in openFiles', fileId)
      return
    }
    if (file.loading) {
      console.log('[editor] loadFileContent: already loading, skipping', fileId)
      return
    }
    if (file.content !== null) {
      console.log('[editor] loadFileContent: content already loaded, skipping', fileId)
      return
    }

    const config = state.config
    if (!config?.baseUrl) {
      console.warn('[editor] loadFileContent: no backend config, trying Electron fallback', fileId)
      // Config not yet ready — leave content null so EditorContent can retry
      // when config becomes available. Optionally try Electron fs fallback.
      const desktopFs = (globalThis as unknown as { window?: { orchestraDesktop?: { fs?: { readFile?: (p: string) => Promise<string> } } } }).window?.orchestraDesktop?.fs
      if (desktopFs?.readFile) {
        set((s) => ({
          openFiles: s.openFiles.map((f) =>
            f.id === fileId ? { ...f, loading: true, loadError: null } : f,
          ),
        }))
        try {
          const content = await desktopFs.readFile(file.filePath)
          set((s) => ({
            openFiles: s.openFiles.map((f) =>
              f.id === fileId ? { ...f, content, loading: false, loadError: null } : f,
            ),
          }))
        } catch (err) {
          set((s) => ({
            openFiles: s.openFiles.map((f) =>
              f.id === fileId ? { ...f, loading: false, loadError: (err as Error).message } : f,
            ),
          }))
        }
      }
      return
    }

    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.id === fileId ? { ...f, loading: true, loadError: null } : f,
      ),
    }))

    const url = `${config.baseUrl}/api/v1/workspace/file?path=${encodeURIComponent(file.filePath)}`
    console.log('[editor] fetching', url)
    try {
      const headers: Record<string, string> = {}
      if (config.apiToken) headers['Authorization'] = `Bearer ${config.apiToken}`
      const res = await fetch(url, { headers })
      console.log('[editor] fetch response', { status: res.status, ok: res.ok, url })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`)
      }
      const content = await res.text()
      console.log('[editor] fetch success', { fileId, bytes: content.length })
      set((s) => ({
        openFiles: s.openFiles.map((f) =>
          f.id === fileId ? { ...f, content, loading: false, loadError: null } : f,
        ),
      }))
    } catch (err) {
      const message = (err as Error).message
      console.error('[editor] fetch failed', { fileId, url, error: message })
      set((s) => ({
        openFiles: s.openFiles.map((f) =>
          f.id === fileId ? { ...f, content: `// Error loading file: ${message}\n// Path: ${file.filePath}`, loading: false, loadError: message } : f,
        ),
      }))
    }
  },

  closeFile: (fileId: string) => {
    const { openFiles, activeFileId } = get()
    const idx = openFiles.findIndex((f) => f.id === fileId)
    if (idx === -1) return
    const next = openFiles.filter((f) => f.id !== fileId)
    let nextActive = activeFileId
    if (activeFileId === fileId) {
      if (next.length === 0) {
        nextActive = null
      } else {
        const prevIdx = Math.max(0, idx - 1)
        nextActive = next[prevIdx].id
      }
    }
    set({ openFiles: next, activeFileId: nextActive })
  },

  setActiveFile: (fileId: string) => set({ activeFileId: fileId }),

  setFileDirty: (fileId: string, isDirty: boolean) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) => (f.id === fileId ? { ...f, isDirty } : f)),
    })),

  setFileContent: (fileId: string, content: string) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) => (f.id === fileId ? { ...f, content } : f)),
    })),

  setEditorSettings: (patch: Partial<EditorSettings>) => {
    const next = { ...get().editorSettings, ...patch }
    localStorage.setItem(EDITOR_SETTINGS_KEY, JSON.stringify(next))
    set({ editorSettings: next })
  },
})
