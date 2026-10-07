import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from './index'
import { getActiveWorkspaceContextId, workspaceResourceContext } from './workspace-context'
import type { SelectedProjectWorkspace } from './types'

const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture' }
const child: SelectedProjectWorkspace = { projectId: 'p', workspaceId: 'wt_child', path: '/child', branch: 'feature', registered: false, isMain: false }
const root: SelectedProjectWorkspace = { ...child, workspaceId: 'wt_root', path: '/root', branch: 'main', registered: true, isMain: true }
beforeEach(() => {
  resetAppStore()
  useAppStore.setState({ config, projects: [{ id: 'p', name: 'Project', root_path: '/root', remote_url: '' }], loadFileContent: vi.fn() })
})
describe('checkout resource ownership', () => {
  it('keeps files and browser tabs in separate center strips without changing the tracker project', () => {
    const store = useAppStore.getState()
    store.selectProjectWorkspace('p', child)
    store.openFile('/child/file.md', 'file.md')
    store.openBrowserTab('http://localhost:3000')
    const context = workspaceResourceContext(config.baseUrl, child)
    expect(useAppStore.getState().activeProjectId).toBe('p')
    expect(useAppStore.getState().openFiles[0].projectId).toBe(context)
    expect(useAppStore.getState().browserTabs[0].projectId).toBe(context)
    expect(useAppStore.getState().projectCenterTabs[context].tabs).toHaveLength(2)
    expect(useAppStore.getState().projectGroups[context]).toBeUndefined()
    store.selectProjectWorkspace('p', root)
    store.openFile('/root/file.md', 'file.md')
    expect(getActiveWorkspaceContextId(useAppStore.getState())).toBe('p')
    expect(useAppStore.getState().projectCenterTabs.p.tabs).toHaveLength(1)
    store.openFile('/child/file.md', 'file.md')
    expect(useAppStore.getState().activeProjectId).toBe('p')
    expect(useAppStore.getState().explorerRoot).toBe('/child')
    expect(getActiveWorkspaceContextId(useAppStore.getState())).toBe(context)
  })
  it('fences selected checkout resources to the selected backend', () => {
    useAppStore.getState().selectProjectWorkspace('p', child)
    const context = getActiveWorkspaceContextId(useAppStore.getState())
    useAppStore.getState().setConfig({ ...config, baseUrl: 'http://localhost:4015' })
    expect(getActiveWorkspaceContextId(useAppStore.getState())).toBe('p')
    useAppStore.getState().selectProjectWorkspace('p', child)
    expect(getActiveWorkspaceContextId(useAppStore.getState())).not.toBe(context)
  })
  it('keeps new agent and new task dialog intents independent', () => {
    useAppStore.getState().openCreateAgentDialog(child)
    expect(useAppStore.getState().createWorktreeDialogOpen).toBe(true)
    expect(useAppStore.getState().createAgentWorkspace).toEqual(child)
    expect(useAppStore.getState().createTaskDialogOpen).toBe(false)
    expect(useAppStore.getState().requestedWorkspaceConversation).toBeNull()
    useAppStore.getState().closeCreateWorktreeDialog()
    useAppStore.getState().openCreateTaskDialog()
    expect(useAppStore.getState().createTaskDialogOpen).toBe(true)
    expect(useAppStore.getState().createWorktreeDialogOpen).toBe(false)
  })
})
