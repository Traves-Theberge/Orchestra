import { type ReactElement } from 'react'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { cleanup, fireEvent, render as renderBase, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { ResizableWorkspace } from './ResizableWorkspace'
import { WorkspaceToolsControls } from './WorkspaceToolsControls'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
const props = { toolsOpen: true, chat: <div>Chat</div>, tools: <div>Tools</div> }

it('adjusts by keyboard, clamps both panes and restores the workspace on remount', () => {
  const view = render(<ResizableWorkspace {...props} storageKey="workspace-a" />)
  const handle = screen.getByRole('separator')
  fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
  expect(handle).toHaveAttribute('aria-valuenow', '50')
  fireEvent.keyDown(handle, { key: 'End' })
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(handle).toHaveAttribute('aria-valuenow', '80')
  view.unmount()
  render(<ResizableWorkspace {...props} storageKey="workspace-a" />)
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '80')
})

it('keeps workspace ratios separate and removes the divider when tools close', () => {
  const view = render(<ResizableWorkspace {...props} storageKey="workspace-a" />)
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'Home' })
  view.rerender(<ResizableWorkspace {...props} storageKey="workspace-b" />)
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '60')
  view.rerender(<ResizableWorkspace {...props} storageKey="workspace-a" />)
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '25')
  fireEvent.doubleClick(screen.getByRole('separator'))
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '60')
  view.rerender(<ResizableWorkspace {...props} storageKey="workspace-a" toolsOpen={false} />)
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Workspace tools')).not.toBeVisible()
})

it('maximizes the whole tools surface without remounting sessions and restores the saved split', () => {
  const mounted = vi.fn()
  const disposed = vi.fn()
  function Session() {
    const [value, setValue] = useState('')
    useEffect(() => { mounted(); return disposed }, [])
    return <><WorkspaceToolsControls /><input aria-label="Session state" value={value} onChange={event => setValue(event.target.value)} /></>
  }
  render(<ResizableWorkspace {...props} tools={<Session />} storageKey="workspace-a" />)
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft', shiftKey: true })
  fireEvent.change(screen.getByLabelText('Session state'), { target: { value: 'Retained browser/terminal state' } })
  const session = screen.getByLabelText('Session state')
  fireEvent.click(screen.getByRole('button', { name: 'Maximize workspace tools' }))
  expect(screen.getByLabelText('Workspace chat pane')).not.toBeVisible()
  expect(screen.getByLabelText('Workspace tools')).toHaveAttribute('data-maximized', 'true')
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Session state')).toBe(session)
  expect(session).toHaveValue('Retained browser/terminal state')
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(disposed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Restore workspace tools' }))
  expect(screen.getByLabelText('Workspace chat pane')).toBeVisible()
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '50')
  expect(localStorage.getItem('workspace-a')).toBe('50')
  fireEvent.click(screen.getByRole('button', { name: 'Maximize workspace tools' }))
  fireEvent.keyDown(session, { key: 'Escape' })
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '50')
})

it('leaves maximize mode when switching workspace or closing tools', () => {
  const view = render(<ResizableWorkspace {...props} tools={<WorkspaceToolsControls />} storageKey="workspace-a" />)
  fireEvent.click(screen.getByRole('button', { name: 'Maximize workspace tools' }))
  view.rerender(<ResizableWorkspace {...props} tools={<WorkspaceToolsControls />} storageKey="workspace-b" />)
  expect(screen.getByLabelText('Workspace chat pane')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Maximize workspace tools' }))
  view.rerender(<ResizableWorkspace {...props} tools={<WorkspaceToolsControls />} storageKey="workspace-b" toolsOpen={false} />)
  expect(screen.getByLabelText('Workspace chat pane')).toBeVisible()
  view.rerender(<ResizableWorkspace {...props} tools={<WorkspaceToolsControls />} storageKey="workspace-b" />)
  expect(screen.getByRole('separator')).toBeInTheDocument()
})

const render = (ui: ReactElement) => renderBase(ui, { wrapper: AppTooltipProvider })

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
