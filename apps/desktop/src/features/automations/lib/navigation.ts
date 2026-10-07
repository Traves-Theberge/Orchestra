import type { AutomationRun } from '@core/api/client'
import { useAppStore } from '@core/store'
import type { SelectedProjectWorkspace } from '@core/store/types'
import { workspaceSelectionKey } from '@core/store/workspace-context'

export const MAESTRO_PROJECT_ID = '__orchestrator__'

/**
 * Navigates to the chat session that executed a run: the Maestro chat when the
 * run has no project, otherwise the project's (or run worktree's) chat. Reuses
 * the store's requestedWorkspaceConversation mechanism that WorkspaceChat honours.
 * Returns false when the run has no conversation yet.
 */
export function openRunConversation(run: Pick<AutomationRun, 'chat_project_id' | 'chat_session_id' | 'project_id' | 'workspace_id' | 'workspace_path' | 'branch'>): boolean {
  const state = useAppStore.getState()
  const sessionId = run.chat_session_id
  if (!sessionId || !state.config) return false
  const projectId = run.chat_project_id || run.project_id || MAESTRO_PROJECT_ID

  if (projectId === MAESTRO_PROJECT_ID) {
    state.setActiveSection('ORCHESTRATOR')
    useAppStore.setState({
      requestedWorkspaceConversation: {
        baseUrl: state.config.baseUrl,
        apiToken: state.config.apiToken,
        projectId: MAESTRO_PROJECT_ID,
        sessionId,
        // Unique per request; WorkspaceChat only compares request ids for equality.
        requestId: Date.now(),
      },
    })
    return true
  }

  let workspace: SelectedProjectWorkspace | undefined
  if (run.workspace_id) {
    const known = Object.values(state.knownProjectWorkspaces).find(candidate => candidate.projectId === projectId && candidate.workspaceId === run.workspace_id)
      ?? state.knownProjectWorkspaces[workspaceSelectionKey(state.config.baseUrl, run.workspace_id)]
    workspace = known ?? (run.workspace_path
      ? { projectId, workspaceId: run.workspace_id, path: run.workspace_path, branch: run.branch, registered: false, isMain: false }
      : undefined)
  }
  state.requestWorkspaceConversation(projectId, sessionId, workspace)
  return true
}
