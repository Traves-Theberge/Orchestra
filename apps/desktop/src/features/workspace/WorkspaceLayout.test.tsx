import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { createPortal } from 'react-dom'
import { type ReactElement } from 'react'
import { useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render as renderBase, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { GLOBAL_PROJECT_ID } from '@core/store/types'
import { WorkspaceLayout } from './WorkspaceLayout'

vi.mock('./chat/WorkspaceChat', () => ({ WorkspaceChat: ({ projectId, config, headerTools, headerNavigation, contentOverride, onShowChat, breadcrumbSlot }: { projectId: string; config: { workspaceId?: string }; headerTools?: ReactNode; headerNavigation?: ReactNode; contentOverride?: ReactNode; onShowChat?: () => void; breadcrumbSlot?: HTMLElement | null }) => {
  const [draft, setDraft] = useState('')
  const breadcrumb = <h2>Conversation title</h2>
  return <div>{breadcrumbSlot === undefined ? breadcrumb : breadcrumbSlot && createPortal(breadcrumb, breadcrumbSlot)}<header>{headerNavigation}<button aria-label="New conversation" onClick={onShowChat}>New conversation</button>{headerTools}</header>{contentOverride}<textarea hidden={!!contentOverride} aria-label={`Draft ${projectId}${config.workspaceId ? ` / ${config.workspaceId}` : ''}`} value={draft} onChange={e => setDraft(e.target.value)} /></div>
} }))
vi.mock('./SplitLayout', () => ({ SplitLayout: () => <div>Project tools</div> }))
vi.mock('@features/git', () => ({ GitTab: () => <div>Repository changes</div> }))
vi.mock('./file-explorer/FileExplorer', () => ({ FileExplorer: () => <div role="tree" className="h-full w-full">Workspace files</div> }))
vi.mock('./panels/WorkspaceSearch', () => ({ WorkspaceSearch: () => <div>Workspace search</div> }))
vi.mock('@features/terminal/TerminalView', () => ({ TerminalView: ({ sessionId }: { sessionId: string }) => <div>Terminal {sessionId}</div> }))
vi.mock('./editor/EditorContent', () => ({ EditorContent: ({ file }: { file: { id: string } }) => <div>Editor {file.id}</div> }))
vi.mock('./browser/BrowserContent', () => ({ BrowserContent: ({ tab }: { tab: { id: string } }) => <div>Browser {tab.id}</div> }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Show workspace tools' }))
    act(() => useAppStore.getState().addTabToGroup('a', { type: 'git', id: 'git' }))
    expect(screen.getByText('Project tools')).toBeVisible()
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
  it('shows tool controls in the same strip as the Workspace / Tasks tabs only while tools are open', () => {
    render(<WorkspaceLayout />)
    expect(screen.queryByLabelText('Workspace tool controls')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show workspace tools' }))
    const tools = screen.getByLabelText('Workspace tools')
    const toolbar = screen.getByLabelText('Workspace tool controls')
    const strip = screen.getByRole('tablist', { name: 'Project workspace' }).parentElement!
    expect(strip).toContainElement(toolbar)
    expect(tools).not.toContainElement(toolbar)
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Hide workspace tools' }))
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Maximize workspace tools' }))
    expect(screen.getAllByRole('button', { name: 'Maximize workspace tools' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Hide workspace tools' }))
    expect(tools).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Show workspace tools' })).toBeVisible()
  })
  it('keeps the same mounted tools panel visible beside Tasks', () => {
    useAppStore.setState({
      projectGroups: { a: { group: { id: 'group', tabs: [{ type: 'git', id: 'git' }], activeTabId: 'git' } } },
      projectLayouts: { a: { kind: 'leaf', groupId: 'group' } },
    })
    render(<WorkspaceLayout projectDetails={() => <div>Tasks content</div>} />)
    const split = screen.getByText('Project tools')
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
    expect(screen.getByText('Tasks content')).toBeVisible()
    expect(split).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }))
    expect(screen.getByText('Project tools')).toBe(split)
  })
  it('shows the tools panel from Tasks without leaving Tasks', () => {
    const onAddTerminal = vi.fn()
    render(<WorkspaceLayout onAddTerminal={onAddTerminal} projectDetails={() => <div>Tasks content</div>} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show workspace tools' }))
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Workspace tools')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Terminal' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Git' }))
    expect(onAddTerminal).not.toHaveBeenCalled()
    expect(Object.values(useAppStore.getState().projectGroups.a)[0].tabs).toEqual([{ type: 'git', id: 'git' }])
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Workspace tools')).toBeVisible()
  })
  it('starts with one chat surface and reveals tools only on request', () => {
    render(<WorkspaceLayout />)
    const tools = screen.getByLabelText('Workspace tools')
    expect(tools).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Show workspace tools' }))
    expect(tools).toBeVisible()
    expect(screen.queryByText('Welcome')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide workspace tools' }))
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

describe('WorkspaceLayout center tabs', () => {
  const tabNames = () => screen.getAllByRole('tab').map(tab => tab.getAttribute('title') ?? tab.textContent)
  const seedResources = () => useAppStore.setState({
    openTerminals: [{ id: 'shell-1', title: 'Alpha Shell' }],
    browserTabs: [{ id: 'web-1', url: 'http://localhost:3000', title: 'Preview', loading: false, canGoBack: false, canGoForward: false, projectId: 'a' }],
    openFiles: [{ id: '/alpha/notes.md', filePath: '/alpha/notes.md', relativePath: 'notes.md', language: 'markdown', isDirty: false, content: '', loading: false, loadError: null, projectId: 'a' }],
  })

  it('puts the conversation breadcrumb left of Workspace in the one strip', () => {
    render(<WorkspaceLayout />)
    const strip = screen.getByRole('tablist', { name: 'Project workspace' }).parentElement!
    const breadcrumb = screen.getByTestId('workspace-breadcrumb')
    expect(strip).toContainElement(breadcrumb)
    expect(breadcrumb).toContainElement(screen.getByRole('heading', { name: 'Conversation title' }))
    expect(screen.getAllByRole('heading', { name: 'Conversation title' })).toHaveLength(1)
    expect(breadcrumb.compareDocumentPosition(screen.getByRole('tab', { name: 'Workspace' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(strip).toContainElement(screen.getByRole('button', { name: 'Show workspace tools' }))
  })

  it('opens terminals, browsers and editors as selected center tabs without opening the tools panel', () => {
    seedResources()
    render(<WorkspaceLayout />)
    const draft = screen.getByLabelText('Draft a')
    act(() => useAppStore.getState().addTabToGroup('a', { type: 'terminal', id: 'shell-1' }))
    expect(screen.getByRole('tab', { name: /Alpha Shell/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Terminal shell-1')).toBeVisible()
    expect(draft).not.toBeVisible()
    expect(screen.getByLabelText('Workspace tools')).not.toBeVisible()
    act(() => useAppStore.getState().addTabToGroup('a', { type: 'browser', id: 'web-1' }))
    act(() => useAppStore.getState().addTabToGroup('a', { type: 'editor', id: '/alpha/notes.md' }))
    expect(tabNames()).toEqual(['Workspace', 'Tasks', 'Alpha Shell', 'Preview', 'notes.md'])
    expect(screen.getByRole('tab', { name: /notes\.md/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Editor /alpha/notes.md')).toBeVisible()
    expect(useAppStore.getState().projectGroups.a).toBeUndefined()
    expect(screen.getByLabelText('Workspace tools')).not.toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }))
    expect(screen.getByLabelText('Draft a')).toBe(draft)
    expect(draft).toBeVisible()
    expect(screen.getByText('Editor /alpha/notes.md')).not.toBeVisible()
  })

  it('keeps terminals mounted across tab, Tasks and workspace switches', () => {
    seedResources()
    render(<WorkspaceLayout projectDetails={() => <div>Tasks content</div>} />)
    act(() => useAppStore.getState().addTabToGroup('a', { type: 'terminal', id: 'shell-1' }))
    const terminal = screen.getByText('Terminal shell-1')
    act(() => useAppStore.getState().addTabToGroup('a', { type: 'browser', id: 'web-1' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
    expect(screen.getByText('Tasks content')).toBeVisible()
    act(() => useAppStore.getState().setActiveProjectId('b'))
    act(() => useAppStore.getState().setActiveProjectId('a'))
    expect(screen.getByText('Terminal shell-1')).toBe(terminal)
    fireEvent.click(screen.getByRole('tab', { name: /Alpha Shell/ }))
    expect(terminal).toBeVisible()
  })

  it('falls back to the previously selected tab, then Workspace, when closing the selected tab', () => {
    seedResources()
    render(<WorkspaceLayout projectDetails={() => <div>Tasks content</div>} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
    act(() => useAppStore.getState().addTabToGroup('a', { type: 'terminal', id: 'shell-1' }))
    act(() => useAppStore.getState().addTabToGroup('a', { type: 'browser', id: 'web-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close Preview' }))
    expect(screen.getByRole('tab', { name: /Alpha Shell/ })).toHaveAttribute('aria-selected', 'true')
    expect(useAppStore.getState().browserTabs).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Close Alpha Shell' }))
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true')
    expect(useAppStore.getState().openTerminals).toEqual([])
  })

  it('opens Files and Git in the right panel and reveals it when hidden', () => {
    render(<WorkspaceLayout />)
    const tools = screen.getByLabelText('Workspace tools')
    expect(tools).not.toBeVisible()
    act(() => useAppStore.getState().addTabToGroup('a', { type: 'git', id: 'git' }))
    expect(tools).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Hide workspace tools' }))
    expect(tools).not.toBeVisible()
    act(() => useAppStore.getState().addTabToGroup('a', { type: 'git', id: 'git' }))
    expect(tools).toBeVisible()
    expect(useAppStore.getState().projectCenterTabs.a).toBeUndefined()
  })

  it('migrates legacy tool groups holding terminal and browser tabs into the center strip', () => {
    seedResources()
    useAppStore.setState({
      projectGroups: { a: { group: { id: 'group', tabs: [{ type: 'terminal', id: 'shell-1' }, { type: 'git', id: 'git' }, { type: 'browser', id: 'web-1' }], activeTabId: 'web-1' } } },
      projectLayouts: { a: { kind: 'leaf', groupId: 'group' } },
    })
    render(<WorkspaceLayout />)
    expect(tabNames()).toEqual(['Workspace', 'Tasks', 'Alpha Shell', 'Preview'])
    expect(useAppStore.getState().projectGroups.a.group).toEqual({ id: 'group', tabs: [{ type: 'git', id: 'git' }], activeTabId: 'git' })
    expect(screen.getByText('Project tools')).toBeVisible()
  })
})
