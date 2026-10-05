import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { type ReactElement } from 'react'
import { useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render as renderBase, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { GLOBAL_PROJECT_ID } from '@core/store/types'
import { WorkspaceLayout } from './WorkspaceLayout'

vi.mock('./chat/WorkspaceChat', () => ({ WorkspaceChat: ({ projectId, config, headerTools, headerNavigation, contentOverride, onShowChat }: { projectId: string; config: { workspaceId?: string }; headerTools?: ReactNode; headerNavigation?: ReactNode; contentOverride?: ReactNode; onShowChat?: () => void }) => {
  const [draft, setDraft] = useState('')
  return <div><header><h2>Conversation title</h2>{headerNavigation}<button aria-label="New conversation" onClick={onShowChat}>New conversation</button>{headerTools}</header>{contentOverride}<textarea hidden={!!contentOverride} aria-label={`Draft ${projectId}${config.workspaceId ? ` / ${config.workspaceId}` : ''}`} value={draft} onChange={e => setDraft(e.target.value)} /></div>
} }))
vi.mock('./SplitLayout', () => ({ SplitLayout: () => <div>Project tools</div> }))
vi.mock('@features/git', () => ({ GitTab: () => <div>Repository changes</div> }))
vi.mock('./panels/WorkspaceWelcome', () => ({ WorkspaceWelcome: () => <div>Welcome</div> }))
beforeEach(() => {
  resetAppStore()
  useAppStore.setState({
    config: { baseUrl: 'http://localhost:4014', apiToken: 'fixture' },
    projects: [{ id: 'a', name: 'Alpha', root_path: '/alpha', remote_url: '' }, { id: 'b', name: 'Beta', root_path: '/beta', remote_url: '' }],
    activeProjectId: 'a', openProjectIds: ['a', 'b'],
  })
})
afterEach(cleanup)
describe('WorkspaceLayout chat ownership', () => {
  it('separates child checkout chat and resources while retaining the registered project identity', () => {
    render(<WorkspaceLayout />)
    const rootDraft = screen.getByLabelText('Draft a')
    fireEvent.change(rootDraft, { target: { value: 'Root draft' } })
    const child = { projectId: 'a', workspaceId: 'wt_child', path: '/alpha-child', branch: 'feature', registered: false, isMain: false }
    act(() => useAppStore.getState().selectProjectWorkspace('a', child))
    expect(useAppStore.getState().activeProjectId).toBe('a')
    expect(useAppStore.getState().explorerRoot).toBe('/alpha-child')
    const childDraft = screen.getByLabelText('Draft a / wt_child')
    fireEvent.change(childDraft, { target: { value: 'Child draft' } })
    act(() => useAppStore.getState().selectProjectWorkspace('a', { ...child, workspaceId: 'wt_root', path: '/alpha', branch: 'main', registered: true, isMain: true }))
    expect(rootDraft).toBeVisible()
    expect(rootDraft).toHaveValue('Root draft')
    expect(childDraft).not.toBeVisible()
    act(() => useAppStore.getState().requestWorkspaceConversation('a', 'child-session', child))
    expect(childDraft).toBeVisible()
    expect(childDraft).toHaveValue('Child draft')
    expect(useAppStore.getState().requestedWorkspaceConversation?.workspaceId).toBe('wt_child')
  })
  it('opens the file tree from the Files & terminals tab', () => {
    render(<WorkspaceLayout />)
    fireEvent.click(screen.getByRole('tab', { name: 'Files & terminals' }))
    expect(screen.getByLabelText('Workspace tools')).toBeVisible()
    expect(screen.getByText('Select a file to open it in the editor')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Files & terminals' }))
    expect(screen.getByLabelText('Workspace tools')).not.toBeVisible()
    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Files & terminals' }))
    expect(screen.getByLabelText('Workspace tools')).toBeVisible()
  })
  it('returns from task settings to the requested project conversation without losing its draft', () => {
    render(<WorkspaceLayout projectDetails={() => <div>Task settings</div>} />)
    const draft = screen.getByLabelText('Draft a')
    fireEvent.change(draft, { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
    act(() => useAppStore.getState().requestWorkspaceConversation('a', 'session-a'))
    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Draft a')).toBe(draft)
    expect(draft).toHaveValue('Keep this draft')
  })
  it('keeps chat mounted while accessing repository and task settings in the same project', () => {
    render(<WorkspaceLayout projectDetails={project => <div>{project.name} settings</div>} />)
    const draft = screen.getByLabelText('Draft a')
    fireEvent.change(draft, { target: { value: 'Keep my workspace draft' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Git & pull requests' }))
    expect(screen.getByText('Repository changes')).toBeVisible()
    expect(draft).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
    expect(screen.getByText('Alpha settings')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Conversation title' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeVisible()
    expect(screen.getByRole('tabpanel', { name: 'Tasks' })).toBeVisible()
    expect(draft).not.toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }))
    expect(screen.getByLabelText('Draft a')).toBe(draft)
    expect(draft).toHaveValue('Keep my workspace draft')
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true')
  })
  it('returns to the workspace before opening tools from the Tasks header', () => {
    const onAddTerminal = vi.fn()
    render(<WorkspaceLayout onAddTerminal={onAddTerminal} projectDetails={() => <div>Tasks content</div>} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Files & terminals' }))
    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Workspace tools')).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add workspace tool' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New terminal' }))
    expect(onAddTerminal).toHaveBeenCalledOnce()
    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Workspace tools')).toBeVisible()
  })
  it('starts with one chat surface and reveals tools only on request', () => {
    render(<WorkspaceLayout />)
    const tools = screen.getByLabelText('Workspace tools')
    expect(tools).not.toBeVisible()
    fireEvent.click(screen.getAllByRole('button', { name: 'Files & terminals' })[0])
    expect(tools).toBeVisible()
    expect(screen.queryByText('Welcome')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Files & terminals' })[0])
    expect(tools).not.toBeVisible()
  })
  it('keeps drafts isolated across project and global workspace switches', () => {
    render(<WorkspaceLayout />)
    fireEvent.change(screen.getByLabelText('Draft a'), { target: { value: 'Alpha draft' } })
    act(() => useAppStore.getState().setActiveProjectId('b'))
    expect(screen.getByLabelText('Draft b')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Draft b'), { target: { value: 'Beta draft' } })
    act(() => useAppStore.getState().setActiveProjectId(GLOBAL_PROJECT_ID))
    act(() => useAppStore.getState().setActiveProjectId('a'))
    expect(screen.getByLabelText('Draft a')).toHaveValue('Alpha draft')
    act(() => useAppStore.getState().setActiveProjectId('b'))
    expect(screen.getByLabelText('Draft b')).toHaveValue('Beta draft')
  })
  it('remounts conversations when the selected backend changes', () => {
    render(<WorkspaceLayout />)
    fireEvent.change(screen.getByLabelText('Draft a'), { target: { value: 'Previous backend draft' } })
    act(() => useAppStore.getState().setConfig({ baseUrl: 'http://localhost:4015', apiToken: 'other-fixture' }))
    expect(screen.getByLabelText('Draft a')).toHaveValue('')
  })
})

const render = (ui: ReactElement) => renderBase(ui, { wrapper: AppTooltipProvider })
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => vi.unstubAllGlobals())
