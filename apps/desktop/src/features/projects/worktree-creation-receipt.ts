import type { SelectedProjectWorkspace } from '@core/store/types'
export type WorktreeCreationReceipt = { baseUrl: string; projectId: string; requestId: string; sessionId: string; provider: string; model: string; createMore: boolean; agentAttempted?: boolean; workspace?: SelectedProjectWorkspace }
const prefix = 'orchestra.workspace-creation.v1:'
export function receiptStorageKey(baseUrl: string, projectId: string, mode: string, workspaceId = '') { return `${prefix}${JSON.stringify([baseUrl, projectId, mode, workspaceId])}` }
export function readCreationReceipt(key: string, baseUrl: string, projectId: string): WorktreeCreationReceipt | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null') as Partial<WorktreeCreationReceipt> | null
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!parsed || parsed.baseUrl !== baseUrl || parsed.projectId !== projectId || !uuid.test(parsed.requestId || '') || !uuid.test(parsed.sessionId || '') || typeof parsed.provider !== 'string' || typeof parsed.model !== 'string') return null
    if (parsed.workspace && (parsed.workspace.projectId !== projectId || !parsed.workspace.workspaceId || !parsed.workspace.path)) return null
    return parsed as WorktreeCreationReceipt
  } catch { return null }
}
/** Deliberately serializes no API token or provider credentials. */
export function saveCreationReceipt(key: string, receipt: WorktreeCreationReceipt | null) {
  try {
    if (!receipt) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify({ baseUrl: receipt.baseUrl, projectId: receipt.projectId, requestId: receipt.requestId, sessionId: receipt.sessionId, provider: receipt.provider, model: receipt.model, createMore: receipt.createMore, agentAttempted: !!receipt.agentAttempted, workspace: receipt.workspace }))
  } catch { /* The visible request ID remains available if storage is disabled. */ }
}
