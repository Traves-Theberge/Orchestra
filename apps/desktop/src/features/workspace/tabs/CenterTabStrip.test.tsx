import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { CENTER_WORKSPACE_TAB } from '@core/store/types'
import { CenterNewTabMenu, CenterTabPanels, CenterTabs } from './CenterTabStrip'

vi.mock('../editor/EditorContent', () => ({ EditorContent: ({ file }: { file: { id: string } }) => <div>Editor {file.id}</div> }))
vi.mock('../browser/BrowserContent', () => ({ BrowserContent: ({ tab }: { tab: { id: string } }) => <div>Browser {tab.id}</div> }))
vi.mock('@features/terminal/TerminalView', () => ({ TerminalView: ({ sessionId }: { sessionId: string }) => <div>Terminal {sessionId}</div> }))
vi.mock('../panels/ConversationsPanel', () => ({ ConversationsPanel: () => <div>Conversation list</div> }))

afterEach(() => {
  cleanup()
  resetAppStore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mountMenu(config: { baseUrl: string; apiToken: string } | null = null) {
  const openBrowserTab = vi.fn()
  const addTabToGroup = vi.fn()
  const setOpenTerminals = vi.fn()
  const openFile = vi.fn()
  const setActiveSection = vi.fn()
  useAppStore.setState({
    projects: [{ id: 'project-a', name: 'Alpha', root_path: 'C:/fixture/alpha', remote_url: '' }],
    openTerminals: [],
    config,
    openBrowserTab, addTabToGroup, setOpenTerminals, openFile, setActiveSection,
  })
  render(<CenterNewTabMenu projectId="project-a" />)
  return { openBrowserTab, addTabToGroup, setOpenTerminals, openFile, setActiveSection }
}

describe('center new-tab menu', () => {
  it('opens a browser tab in the current workspace and restores focus to the trigger', () => {
    const { openBrowserTab } = mountMenu()
    const trigger = screen.getByRole('button', { name: 'New tab' })
    fireEvent.click(trigger)
    // The single "+" also covers the right panel's Files and Git.
    expect(screen.getByRole('menuitem', { name: 'Files' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Git' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Browser Tab' }))
    expect(openBrowserTab).toHaveBeenCalledExactlyOnceWith(undefined, 'project-a')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('creates an idle terminal in the exact project workspace', () => {
    const { setOpenTerminals, addTabToGroup } = mountMenu()
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Terminal' }))
    const [term] = setOpenTerminals.mock.calls[0][0]
    expect(term).toMatchObject({ title: 'Alpha Shell', projectId: 'project-a', cwd: 'C:/fixture/alpha', initialCommand: undefined })
    expect(addTabToGroup).toHaveBeenCalledExactlyOnceWith('project-a', { type: 'terminal', id: term.id })
  })

  it.each([
    ['Claude', 'claude'], ['Codex', 'codex'], ['Antigravity', 'agy'], ['OpenCode', 'opencode'], ['8gent', '8gent'],
  ])('starts the %s terminal choice with a safely scoped workspace command', (label, executable) => {
    const { setOpenTerminals, addTabToGroup } = mountMenu()
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
    const [term] = setOpenTerminals.mock.calls[0][0]
    expect(term).toMatchObject({ title: `${label} · Alpha`, projectId: 'project-a', cwd: 'C:/fixture/alpha', initialCommand: `cd 'C:/fixture/alpha' && clear && ${executable}` })
    expect(addTabToGroup).toHaveBeenCalledExactlyOnceWith('project-a', { type: 'terminal', id: term.id })
  })

  it('opens Conversations as a center tab', () => {
    const { addTabToGroup } = mountMenu()
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Conversations' }))
    expect(addTabToGroup).toHaveBeenCalledExactlyOnceWith('project-a', { type: 'conversations', id: 'conversations' })
  })

  it('creates Markdown through the scoped fixture HTTP boundary and opens the same path', async () => {
    const { openFile } = mountMenu({ baseUrl: 'http://fixture.invalid', apiToken: 'fixture-token' })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('0000-fixture' as ReturnType<typeof crypto.randomUUID>)
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Markdown' }))
    await waitFor(() => expect(openFile).toHaveBeenCalledOnce())
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('http://fixture.invalid/api/v1/workspace/file?path=C%3A%2Ffixture%2Falpha%2FUntitled-0000-fixture.md')
    expect(request).toMatchObject({ method: 'PUT', body: '# Untitled\n\n' })
    expect(openFile).toHaveBeenCalledExactlyOnceWith('C:/fixture/alpha/Untitled-0000-fixture.md', 'Untitled-0000-fixture.md', undefined, 'project-a')
  })

  it('routes Agent settings to the Agents section without opening a terminal', () => {
    const { setActiveSection, setOpenTerminals } = mountMenu()
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Agent settings/ }))
    expect(setActiveSection).toHaveBeenCalledExactlyOnceWith('AGENTS')
    expect(setOpenTerminals).not.toHaveBeenCalled()
  })
})

describe('center tabs', () => {
  const seed = () => {
    useAppStore.setState({
      config: { baseUrl: 'http://fixture.invalid', apiToken: 'fixture' },
      openTerminals: [{ id: 'shell-1', title: 'Alpha Shell' }],
      openFiles: [{ id: '/a/notes.md', filePath: '/a/notes.md', relativePath: 'notes.md', language: 'markdown', isDirty: true, content: '', loading: false, loadError: null, projectId: 'a' }],
    })
    const store = useAppStore.getState()
    store.addTabToGroup('a', { type: 'terminal', id: 'shell-1' })
    store.addTabToGroup('a', { type: 'editor', id: '/a/notes.md' })
    render(<div><div role="tablist"><CenterTabs projectId="a" /></div><CenterTabPanels contextId="a" /></div>)
  }

  it('keeps every tab mounted while switching and shows only the selected one', () => {
    seed()
    const terminal = screen.getByText('Terminal shell-1')
    expect(screen.getByText('Editor /a/notes.md')).toBeVisible()
    expect(terminal).not.toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: /Alpha Shell/ }))
    expect(screen.getByText('Terminal shell-1')).toBe(terminal)
    expect(terminal).toBeVisible()
    expect(screen.getByText('Editor /a/notes.md')).not.toBeVisible()
  })

  it('shows a dirty dot, closes on middle-click and falls back to the previous selection', () => {
    seed()
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Alpha Shell/ }))
    fireEvent(screen.getByRole('tab', { name: /Alpha Shell/ }), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(useAppStore.getState().projectCenterTabs.a.selectedId).toBe('/a/notes.md')
    expect(useAppStore.getState().openTerminals).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Close notes.md' }))
    expect(useAppStore.getState().projectCenterTabs.a).toMatchObject({ tabs: [], selectedId: CENTER_WORKSPACE_TAB })
  })

  it('reorders tabs by drag and drop', () => {
    seed()
    const [first, second] = screen.getAllByRole('tab').map(tab => tab.parentElement!)
    const data = new Map<string, string>()
    const dataTransfer = { types: [] as string[], setData: (k: string, v: string) => { data.set(k, v); dataTransfer.types.push(k) }, getData: (k: string) => data.get(k) ?? '', effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(second, { dataTransfer })
    fireEvent.dragOver(first, { dataTransfer, clientX: 0 })
    fireEvent.drop(first, { dataTransfer })
    expect(useAppStore.getState().projectCenterTabs.a.tabs.map(t => t.id)).toEqual(['/a/notes.md', 'shell-1'])
  })

  it('shows the split button only while a terminal tab is selected', () => {
    seed()
    expect(screen.queryByRole('button', { name: 'Split terminal' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Alpha Shell/ }))
    expect(screen.getByRole('button', { name: 'Split terminal' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /notes\.md/ }))
    expect(screen.queryByRole('button', { name: 'Split terminal' })).not.toBeInTheDocument()
  })

  it('splits a terminal into side-by-side panes, focuses and closes panes', () => {
    seed()
    fireEvent.click(screen.getByRole('tab', { name: /Alpha Shell/ }))
    const original = screen.getByText('Terminal shell-1')
    fireEvent.click(screen.getByRole('button', { name: 'Split terminal' }))
    const split = useAppStore.getState().projectCenterTabs.a.terminalSplits!['shell-1']
    const added = split.panes[1]
    expect(screen.getAllByText(/^Terminal /)).toHaveLength(2)
    expect(screen.getByText(`Terminal ${added}`)).toBeVisible()
    // The original shell was not remounted by the split.
    expect(screen.getByText('Terminal shell-1')).toBe(original)
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    useAppStore.getState().setOpenTerminals(useAppStore.getState().openTerminals.map(t => t.id === 'shell-1' ? { ...t, title: 'Build Shell' } : t))
    fireEvent.mouseDown(original)
    expect(useAppStore.getState().projectCenterTabs.a.terminalSplits!['shell-1'].focusedId).toBe('shell-1')
    expect(screen.getByRole('tab', { name: /Build Shell/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close pane Build Shell' }))
    expect(screen.queryByText('Terminal shell-1')).toBeNull()
    expect(screen.getByText(`Terminal ${added}`)).toBeVisible()
    expect(useAppStore.getState().openTerminals.map(t => t.id)).toEqual([added])
    expect(useAppStore.getState().projectCenterTabs.a.tabs.map(t => t.id)).toEqual(['shell-1', '/a/notes.md'])
  })

  it('keeps split panes mounted while switching tabs', () => {
    seed()
    fireEvent.click(screen.getByRole('tab', { name: /Alpha Shell/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Split terminal' }))
    const panes = screen.getAllByText(/^Terminal /)
    fireEvent.click(screen.getByRole('tab', { name: /notes\.md/ }))
    expect(screen.getAllByText(/^Terminal /)).toEqual(panes)
    panes.forEach(pane => expect(pane).not.toBeVisible())
    fireEvent.click(screen.getByRole('tab', { name: /Shell/ }))
    expect(screen.getAllByText(/^Terminal /)).toEqual(panes)
    panes.forEach(pane => expect(pane).toBeVisible())
  })

  it('closing a split tab closes all of its terminals', () => {
    seed()
    fireEvent.click(screen.getByRole('tab', { name: /Alpha Shell/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Split terminal' }))
    fireEvent.click(screen.getByRole('button', { name: /^Close Shell$/ }))
    expect(screen.queryAllByText(/^Terminal /)).toHaveLength(0)
    expect(useAppStore.getState().openTerminals).toEqual([])
  })
})
