import { type ReactElement } from 'react'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { act, cleanup, fireEvent, render as renderBase, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { getActiveWorkspaceContextId } from '@core/store/workspace-context'
import { WorkspaceToolSurface } from './WorkspaceToolSurface'

vi.mock('./file-explorer/FileExplorer', () => ({ FileExplorer: () => <div role="tree" className="h-full w-full">Checkout files</div> }))
vi.mock('./panels/WorkspaceSearch', () => ({ WorkspaceSearch: () => <div>Checkout search</div> }))
vi.mock('./WorkspaceToolsControls', () => ({ WorkspaceToolsControls: () => <button>Maximize workspace tools</button> }))

const openFile = vi.fn()
const openBrowserTab = vi.fn()
beforeEach(() => {
  resetAppStore(); openFile.mockReset(); openBrowserTab.mockReset()
  useAppStore.setState({ config: { baseUrl: 'http://localhost:4014', apiToken: 'fixture' }, activeProjectId: 'a', projects: [{ id: 'a', name: 'Alpha', root_path: 'C:/alpha', remote_url: '' }], explorerRoot: 'C:/alpha', openFile, openBrowserTab })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Add workspace tool' }))
const openFiles = () => { openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'File viewer' })) }

it('portals its compact menu, opens file viewer and dismisses with keyboard focus restored', () => {
  const { container } = render(<WorkspaceToolSurface><div>Editor</div></WorkspaceToolSurface>)
  openMenu()
  const menu = screen.getByRole('menu', { name: 'Add workspace tool' })
  expect(container.contains(menu)).toBe(false)
  expect(screen.getByRole('menuitem', { name: 'Files & terminals' })).toHaveFocus()
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(screen.getByRole('menuitem', { name: 'Git & pull requests' })).toHaveFocus()
  fireEvent.keyDown(menu, { key: 'Escape' })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add workspace tool' })).toHaveFocus()
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'File viewer' }))
  expect(screen.getByLabelText('Workspace file sidebar')).toHaveTextContent('Checkout files')
  expect(screen.getByRole('button', { name: 'Maximize workspace tools' })).toBeVisible()
})

it('keeps the full borderless control strip inside the pane', async () => {
  const onToggleTools = vi.fn()
  render(<WorkspaceToolSurface toolsOpen onToggleTools={onToggleTools}><div>Tools</div></WorkspaceToolSurface>)
  const toolbar = screen.getByLabelText('Workspace tool controls')
  expect(toolbar).toHaveClass('h-10')
  expect(toolbar).not.toHaveClass('border-t', 'border-b')
  expect(screen.queryByRole('button', { name: 'Toggle workspace files' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Toggle workspace search' })).not.toBeInTheDocument()
  expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Add workspace tool' }))
  expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Hide workspace tools' }))
  expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Maximize workspace tools' }))
  expect(screen.getByRole('button', { name: 'Hide workspace tools' })).not.toHaveAttribute('title')
  openFiles()
  expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Toggle workspace search' }))
  fireEvent.click(screen.getByRole('button', { name: 'Hide workspace tools' }))
  expect(onToggleTools).toHaveBeenCalledOnce()
})

it('toggles the search sidebar closed without changing the active tools pane', () => {
  const onToggleTools = vi.fn()
  render(<WorkspaceToolSurface toolsOpen onToggleTools={onToggleTools}><div>Tools</div></WorkspaceToolSurface>)
  expect(screen.queryByRole('button', { name: 'Toggle workspace search' })).not.toBeInTheDocument()
  openFiles()
  expect(screen.getByLabelText('Workspace file sidebar')).toHaveTextContent('Checkout files')
  expect(screen.getByRole('button', { name: 'Toggle workspace search' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Toggle workspace search' }))
  expect(screen.getByLabelText('Workspace search sidebar')).toHaveTextContent('Checkout search')
  expect(screen.queryByRole('button', { name: 'Toggle workspace files' })).not.toBeInTheDocument()
  openFiles()
  expect(screen.getByLabelText('Workspace file sidebar')).toHaveTextContent('Checkout files')
  expect(screen.getByRole('button', { name: 'Toggle workspace search' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Close workspace file sidebar' }))
  expect(screen.queryByLabelText('Workspace search sidebar')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Workspace file sidebar')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Toggle workspace search' })).not.toBeInTheDocument()
  expect(onToggleTools).not.toHaveBeenCalled()
})

it('uses the selected workspace browser context and delegates terminal creation once', () => {
  const child = { projectId: 'a', workspaceId: 'wt_child', path: 'C:/alpha-child', branch: 'feature', registered: false, isMain: false }
  useAppStore.getState().selectProjectWorkspace('a', child)
  const terminal = vi.fn()
  render(<WorkspaceToolSurface onAddTerminal={terminal}><div>Tools</div></WorkspaceToolSurface>)
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'New terminal' }))
  expect(terminal).toHaveBeenCalledTimes(1)
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'New browser tab' }))
  expect(openBrowserTab).toHaveBeenCalledWith(undefined, getActiveWorkspaceContextId(useAppStore.getState()))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('awaits a raw Markdown PUT in the exact child checkout before opening its editor context', async () => {
  useAppStore.getState().selectProjectWorkspace('a', { projectId: 'a', workspaceId: 'wt_child', path: 'C:/alpha-child', branch: 'feature', registered: false, isMain: false })
  let complete!: (response: Response) => void
  const fetchMock = vi.fn(() => new Promise<Response>(resolve => { complete = resolve }))
  vi.stubGlobal('fetch', fetchMock)
  render(<WorkspaceToolSurface><div>Tools</div></WorkspaceToolSurface>)
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'New markdown document' }))
  expect(openFile).not.toHaveBeenCalled()
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  const path = new URL(url).searchParams.get('path')!
  expect(path).toMatch(/^C:\/alpha-child\/Untitled-[a-f0-9-]+\.md$/)
  expect(init).toMatchObject({ method: 'PUT', body: '# Untitled\n\n', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer fixture' } })
  await act(async () => complete(new Response('{}', { status: 200 })))
  expect(openFile).toHaveBeenCalledWith(path, path.split('/').pop(), undefined, getActiveWorkspaceContextId(useAppStore.getState()))
})

it('does not switch back to the old checkout when selection changes during creation', async () => {
  let complete!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve })))
  render(<WorkspaceToolSurface><div>Tools</div></WorkspaceToolSurface>)
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'New markdown document' }))
  act(() => useAppStore.getState().selectProjectWorkspace('a', { projectId: 'a', workspaceId: 'wt_child', path: 'C:/alpha-child', branch: 'feature', registered: false, isMain: false }))
  await act(async () => complete(new Response('{}', { status: 200 })))
  expect(openFile).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Document created in the previous workspace')
})

it('keeps failed creation visible without opening a nonexistent editor and dismisses outside clicks', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
  render(<WorkspaceToolSurface><div>Tools</div></WorkspaceToolSurface>)
  openMenu(); fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'New markdown document' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Document creation was not confirmed'))
  expect(openFile).not.toHaveBeenCalled()
})

const render = (ui: ReactElement) => renderBase(ui, { wrapper: AppTooltipProvider })

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
