import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { TabGroupPanel } from './TabGroupPanel'

vi.mock('../WorkspaceToolsControls', () => ({ WorkspaceToolsControls: () => null }))
vi.mock('../editor/EditorContent', () => ({ EditorContent: () => null }))
vi.mock('../browser/BrowserContent', () => ({ BrowserContent: () => null }))
vi.mock('@features/terminal/TerminalView', () => ({ TerminalView: () => null }))

afterEach(() => {
  cleanup()
  resetAppStore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mount(config: { baseUrl: string; apiToken: string } | null = null) {
  const openBrowserTab = vi.fn()
  const setFocusedGroup = vi.fn()
  const addTabToGroup = vi.fn()
  const setOpenTerminals = vi.fn()
  const openFile = vi.fn()
  const setActiveSection = vi.fn()
  const splitGroup = vi.fn()
  const closeGroup = vi.fn()
  useAppStore.setState({
    projects: [{ id: 'project-a', name: 'Alpha', root_path: 'C:/fixture/alpha', remote_url: '' }],
    browserTabs: [],
    openFiles: [],
    openTerminals: [],
    config,
    openBrowserTab,
    setFocusedGroup,
    addTabToGroup,
    setOpenTerminals,
    openFile,
    setActiveSection,
    splitGroup,
    closeGroup,
  })
  render(<TabGroupPanel
    projectId="project-a"
    group={{ id: 'group-a', tabs: [], activeTabId: null }}
    isFocused={true}
    siblingGroupIds={['group-a']}
  />)
  return { openBrowserTab, setFocusedGroup, addTabToGroup, setOpenTerminals, openFile, setActiveSection, splitGroup, closeGroup }
}

describe('workspace tab group menus', () => {
  it('adds a browser tab in the current workspace and restores focus to the Add tab trigger', () => {
    const { openBrowserTab, setFocusedGroup } = mount()
    const trigger = screen.getByRole('button', { name: 'Add tab' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(document.body).toContainElement(screen.getByRole('menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: /New Browser Tab/ }))

    expect(openBrowserTab).toHaveBeenCalledExactlyOnceWith(undefined, 'project-a')
    expect(setFocusedGroup).toHaveBeenCalledExactlyOnceWith('project-a', 'group-a')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('splits downward by group ID and closes without closing the group on Escape', () => {
    const { splitGroup, closeGroup } = mount()
    const trigger = screen.getByRole('button', { name: 'Split group' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split down' }))
    expect(splitGroup).toHaveBeenCalledExactlyOnceWith('project-a', 'group-a', 'vertical')
    expect(closeGroup).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(closeGroup).not.toHaveBeenCalled()
  })

  it('creates an idle terminal in the exact project workspace through the terminal menu choice', () => {
    const { setOpenTerminals, setFocusedGroup, addTabToGroup } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add tab' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Terminal' }))

    expect(setOpenTerminals).toHaveBeenCalledOnce()
    const [term] = setOpenTerminals.mock.calls[0][0]
    expect(term).toMatchObject({ title: 'Alpha Shell', projectId: 'project-a', cwd: 'C:/fixture/alpha', initialCommand: undefined })
    expect(addTabToGroup).toHaveBeenCalledExactlyOnceWith('project-a', { type: 'terminal', id: term.id }, 'group-a')
    expect(setFocusedGroup).toHaveBeenCalledExactlyOnceWith('project-a', 'group-a')
  })

  it.each([
    ['Claude', 'claude'], ['Codex', 'codex'], ['Antigravity', 'agy'], ['OpenCode', 'opencode'], ['8gent', '8gent'],
  ])('starts the %s terminal choice with a safely scoped workspace command', (label, executable) => {
    const { setOpenTerminals, addTabToGroup } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add tab' }))
    fireEvent.click(screen.getByRole('menuitem', { name: label }))

    const [term] = setOpenTerminals.mock.calls[0][0]
    expect(term).toMatchObject({
      title: `${label} · Alpha`,
      projectId: 'project-a',
      cwd: 'C:/fixture/alpha',
      initialCommand: `cd 'C:/fixture/alpha' && clear && ${executable}`,
    })
    expect(addTabToGroup).toHaveBeenCalledExactlyOnceWith('project-a', { type: 'terminal', id: term.id }, 'group-a')
  })

  it('creates Markdown through the scoped fixture HTTP boundary and opens the same path', async () => {
    const { openFile } = mount({ baseUrl: 'http://fixture.invalid', apiToken: 'fixture-token' })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 201, text: async () => '' }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-10-05T12:34:56.000Z')
    fireEvent.click(screen.getByRole('button', { name: 'Add tab' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Markdown' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('http://fixture.invalid/api/v1/workspace/file?path=C%3A%2Ffixture%2Falpha%2FUntitled-2026-10-05T12-34-56.md')
    expect(request).toMatchObject({ method: 'PUT', body: '# Untitled\n\n' })
    expect(openFile).toHaveBeenCalledExactlyOnceWith('C:/fixture/alpha/Untitled-2026-10-05T12-34-56.md', 'Untitled-2026-10-05T12-34-56.md', undefined, 'project-a')
  })

  it('routes Agent settings to the existing Agents section without opening a terminal', () => {
    const { setActiveSection, setOpenTerminals } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add tab' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Agent settings/ }))
    expect(setActiveSection).toHaveBeenCalledExactlyOnceWith('AGENTS')
    expect(setOpenTerminals).not.toHaveBeenCalled()
  })

  it('closes the group only after choosing Close group', () => {
    const { closeGroup } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Split group' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close group' }))
    expect(closeGroup).toHaveBeenCalledExactlyOnceWith('project-a', 'group-a')
  })
})
