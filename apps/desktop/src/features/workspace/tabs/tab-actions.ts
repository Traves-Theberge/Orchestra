import { useAppStore } from '@core/store'
import { projectIdForWorkspaceContext, workspaceSelectionKey } from '@core/store/workspace-context'
import type { AppState, TabRef, WorkspaceContextID } from '@core/store/types'
import { shellQuote } from '../file-explorer/FileTreeRow'

/** Agents that can be launched as terminal tabs from the new-tab menu. */
export const AGENT_LAUNCHERS = [
  { id: 'claude', label: 'Claude', command: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'antigravity', label: 'Antigravity', command: 'agy' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode' },
  { id: '8gent', label: '8gent', command: '8gent' },
  { id: 'omp', label: 'OMP', command: 'omp' },
] as const

/** The project and working directory backing a workspace context. */
export function workspaceRootFor(contextId: WorkspaceContextID) {
  const state = useAppStore.getState()
  const project = state.projects.find(p => p.id === projectIdForWorkspaceContext(state, contextId))
  const workspace = state.config ? state.knownProjectWorkspaces[workspaceSelectionKey(state.config.baseUrl, contextId)] : undefined
  return { project, cwd: workspace?.path ?? state.projectExplorerRoots[contextId] ?? project?.root_path ?? undefined }
}

/** Open a shell (or an agent CLI) as a center tab and select it. */
export function openTerminalTab(contextId: WorkspaceContextID, agent?: { label: string; command: string }) {
  const state = useAppStore.getState()
  const id = `shell-${Date.now()}`
  const { project, cwd } = workspaceRootFor(contextId)
  // `~` must stay unquoted so the shell expands it; any concrete path goes
  // through shellQuote to defuse spaces / quotes / $.
  const initialCommand = agent ? `cd ${cwd ? shellQuote(cwd) : '~'} && clear && ${agent.command}` : undefined
  const title = agent ? `${agent.label}${project ? ` · ${project.name}` : ''}` : project ? `${project.name} Shell` : 'Shell'
  state.setOpenTerminals([...state.openTerminals, { id, title, projectId: project?.id, cwd, initialCommand }])
  state.addTabToGroup(contextId, { type: 'terminal', id })
}

/** Create an untitled markdown file in the workspace root and open it as a center tab. */
export async function createMarkdownDocument(contextId: WorkspaceContextID) {
  const state = useAppStore.getState()
  const root = workspaceRootFor(contextId).cwd || state.explorerRoot
  const backend = state.config
  if (!root || !backend?.baseUrl) throw new Error('Select a workspace with a connected backend to create a document.')
  const filename = `Untitled-${crypto.randomUUID()}.md`
  const path = `${root.replace(/[\\/]+$/, '')}/${filename}`
  const response = await fetch(`${backend.baseUrl}/api/v1/workspace/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain', ...(backend.apiToken ? { Authorization: `Bearer ${backend.apiToken}` } : {}) },
    body: '# Untitled\n\n',
  })
  if (!response.ok) throw new Error(`Failed to create document: HTTP ${response.status}`)
  useAppStore.getState().openFile(path, filename, undefined, contextId)
}

/** Remove a tab from its strip, then dispose the underlying resource. */
export function closeWorkspaceTab(contextId: WorkspaceContextID, ref: TabRef) {
  const state = useAppStore.getState()
  // Terminal tabs may hold several split panes; close the tab and every pane's terminal.
  if (ref.type === 'terminal') { state.closeTerminalTab(contextId, ref.id); return }
  state.removeTabFromGroup(contextId, ref.id)
  if (ref.type === 'editor') state.closeFile(ref.id)
  if (ref.type === 'browser') state.closeBrowserTab(ref.id)
}

/** Display title (and dirty flag) for a tab. */
export function tabTitle(ref: TabRef, state: Pick<AppState, 'openFiles' | 'browserTabs' | 'openTerminals'>): { title: string; isDirty?: boolean } {
  if (ref.type === 'editor') {
    const file = state.openFiles.find(f => f.id === ref.id)
    return { title: file?.relativePath.split('/').pop() ?? 'Untitled', isDirty: file?.isDirty }
  }
  if (ref.type === 'browser') return { title: state.browserTabs.find(t => t.id === ref.id)?.title || 'New Tab' }
  if (ref.type === 'terminal') return { title: state.openTerminals.find(t => t.id === ref.id)?.title || 'Shell' }
  if (ref.type === 'git') return { title: 'Git' }
  if (ref.type === 'files') return { title: 'Files' }
  if (ref.type === 'conversations') return { title: 'Conversations' }
  return { title: '' }
}
