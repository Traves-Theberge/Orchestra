import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { TabGroupPanel } from './TabGroupPanel'

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
  return { setFocusedGroup, addTabToGroup, setOpenTerminals, openFile, setActiveSection, splitGroup, closeGroup }
}

describe('workspace tab group menus', () => {
  it('offers only Files, File sidebar and Git, adds them to this group and restores focus', () => {
    const { addTabToGroup, setFocusedGroup } = mount()
    const trigger = screen.getByRole('button', { name: 'Add tab' })
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect(document.body).toContainElement(menu)
    expect(screen.getAllByRole('menuitem').map(item => item.getAttribute('aria-label'))).toEqual(['Files', 'Git & pull requests'])
    expect(screen.queryByRole('menuitem', { name: /Terminal|Browser|Markdown|Conversations/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Git & pull requests' }))
    expect(addTabToGroup).toHaveBeenCalledExactlyOnceWith('project-a', { type: 'git', id: 'git' }, 'group-a')
    expect(setFocusedGroup).toHaveBeenCalledExactlyOnceWith('project-a', 'group-a')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('never renders center-type tabs left over in a legacy group', () => {
    useAppStore.setState({ openTerminals: [{ id: 'shell-1', title: 'Old shell' }] })
    render(<TabGroupPanel
      projectId="project-a"
      group={{ id: 'legacy', tabs: [{ type: 'terminal', id: 'shell-1' }, { type: 'git', id: 'git' }], activeTabId: 'shell-1' }}
      isFocused={true}
      siblingGroupIds={['legacy']}
    />)
    expect(screen.queryByRole('tab', { name: /Old shell/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Git/ })).toBeInTheDocument()
  })

  it('never offers a split control in the Files/Git panel', () => {
    mount()
    expect(screen.queryByRole('button', { name: /split/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add tab' }))
    expect(screen.queryByRole('menuitem', { name: /split/i })).not.toBeInTheDocument()
  })


})
