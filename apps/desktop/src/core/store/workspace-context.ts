import type { AppState, SelectedProjectWorkspace } from './types'

export const workspaceSelectionKey = (baseUrl: string, projectId: string) => `${baseUrl}::${projectId}`
export function workspaceResourceContext(baseUrl: string, workspace: SelectedProjectWorkspace) {
  return workspace.registered ? workspace.projectId : `${baseUrl}::${workspace.projectId}@${workspace.workspaceId}`
}
export function selectedProjectWorkspace(state: Pick<AppState, 'config' | 'workspaceSelections' | 'activeProjectId'>, projectId = state.activeProjectId) {
  return state.config ? state.workspaceSelections[workspaceSelectionKey(state.config.baseUrl, projectId)] : undefined
}
export function getActiveWorkspaceContextId(state: Pick<AppState, 'config' | 'workspaceSelections' | 'activeProjectId'>) {
  const workspace = selectedProjectWorkspace(state)
  return workspace && state.config ? workspaceResourceContext(state.config.baseUrl, workspace) : state.activeProjectId
}
export function projectIdForWorkspaceContext(state: Pick<AppState, 'config' | 'knownProjectWorkspaces'>, contextId: string) {
  return state.config ? state.knownProjectWorkspaces[workspaceSelectionKey(state.config.baseUrl, contextId)]?.projectId ?? contextId : contextId
}
