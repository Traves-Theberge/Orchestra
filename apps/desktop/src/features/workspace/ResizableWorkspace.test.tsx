import { type ReactElement } from 'react'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { cleanup, fireEvent, render as renderBase, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ResizableWorkspace } from './ResizableWorkspace'

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




const render = (ui: ReactElement) => renderBase(ui, { wrapper: AppTooltipProvider })

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
