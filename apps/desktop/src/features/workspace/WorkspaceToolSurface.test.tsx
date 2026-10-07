import { type ReactElement } from 'react'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { cleanup, fireEvent, render as renderBase, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { WorkspaceToolSurface } from './WorkspaceToolSurface'
import { WorkspaceEmptyTools } from './WorkspaceEmptyTools'

vi.mock('./file-explorer/FileExplorer', () => ({ FileExplorer: () => <div role="tree" className="h-full w-full">Checkout files</div> }))
vi.mock('./panels/WorkspaceSearch', () => ({ WorkspaceSearch: () => <div>Checkout search</div> }))
vi.mock('./WorkspaceToolsControls', () => ({ WorkspaceToolsControls: () => <button>Maximize workspace tools</button> }))

beforeEach(() => {
  resetAppStore()
  useAppStore.setState({ config: { baseUrl: 'http://localhost:4014', apiToken: 'fixture' }, activeProjectId: 'a', projects: [{ id: 'a', name: 'Alpha', root_path: 'C:/alpha', remote_url: '' }], explorerRoot: 'C:/alpha' })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('keeps the borderless control strip with the tab slot, maximize, then hide tools last', () => {
  const onToggleTools = vi.fn()
  render(<WorkspaceToolSurface toolsOpen onToggleTools={onToggleTools}><div>Tools</div></WorkspaceToolSurface>)
  const toolbar = screen.getByLabelText('Workspace tool controls')
  expect(toolbar).toHaveClass('h-10')
  expect(toolbar).not.toHaveClass('border-t', 'border-b')
  expect(screen.queryByRole('button', { name: 'Add workspace tool' })).not.toBeInTheDocument()
  expect(toolbar).toContainElement(screen.getByTestId('workspace-toolbar-tabs'))
  const maximize = screen.getByRole('button', { name: 'Maximize workspace tools' })
  const hide = screen.getByRole('button', { name: 'Hide workspace tools' })
  expect(maximize.compareDocumentPosition(hide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(hide).not.toHaveAttribute('title')
  fireEvent.click(hide)
  expect(onToggleTools).toHaveBeenCalledOnce()
})

it('opens the file sidebar on request and toggles search without changing the tools pane', () => {
  const onToggleTools = vi.fn()
  const { rerender } = render(<WorkspaceToolSurface toolsOpen onToggleTools={onToggleTools}><div>Tools</div></WorkspaceToolSurface>)
  expect(screen.queryByRole('button', { name: 'Toggle workspace search' })).not.toBeInTheDocument()
  rerender(<WorkspaceToolSurface filesRequest={1} toolsOpen onToggleTools={onToggleTools}><div>Tools</div></WorkspaceToolSurface>)
  expect(screen.getByLabelText('Workspace file sidebar')).toHaveTextContent('Checkout files')
  fireEvent.click(screen.getByRole('button', { name: 'Toggle workspace search' }))
  expect(screen.getByLabelText('Workspace search sidebar')).toHaveTextContent('Checkout search')
  rerender(<WorkspaceToolSurface filesRequest={2} toolsOpen onToggleTools={onToggleTools}><div>Tools</div></WorkspaceToolSurface>)
  expect(screen.getByLabelText('Workspace file sidebar')).toHaveTextContent('Checkout files')
  fireEvent.click(screen.getByRole('button', { name: 'Close workspace file sidebar' }))
  expect(screen.queryByLabelText('Workspace file sidebar')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Toggle workspace search' })).not.toBeInTheDocument()
  expect(onToggleTools).not.toHaveBeenCalled()
})

it('shows the files view full width when no tool is active', () => {
  render(<WorkspaceToolSurface filesRequest={1} hasActiveTools={false}><div>Tools</div></WorkspaceToolSurface>)
  expect(screen.getByLabelText('Workspace files view')).toHaveTextContent('Checkout files')
})

it('offers only Files and Git in the empty tools panel', () => {
  render(<WorkspaceToolSurface toolsOpen onToggleTools={vi.fn()}><WorkspaceEmptyTools projectId="a" /></WorkspaceToolSurface>)
  for (const label of ['Terminal', 'Browser', 'Markdown document', 'Conversations', 'File sidebar']) expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Git' }))
  expect(Object.values(useAppStore.getState().projectGroups.a)[0].tabs).toEqual([{ type: 'git', id: 'git' }])
})

const render = (ui: ReactElement) => renderBase(ui, { wrapper: AppTooltipProvider })

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
