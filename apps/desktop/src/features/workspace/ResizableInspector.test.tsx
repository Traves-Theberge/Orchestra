import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ResizableInspector } from './ResizableInspector'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
it('retains separate widths for file/search panes and each workspace', () => {
  const props = { inspector: <div>Files</div>, children: <div>Editor</div> }
  const view = render(<ResizableInspector {...props} storageKey="checkout-a" mode="files" />)
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight', shiftKey: true })
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '216')
  view.rerender(<ResizableInspector {...props} storageKey="checkout-a" mode="search" />)
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '240')
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'End' })
  view.rerender(<ResizableInspector {...props} storageKey="checkout-b" mode="search" />)
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '240')
  view.rerender(<ResizableInspector {...props} storageKey="checkout-a" mode="search" />)
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '480')
  fireEvent.doubleClick(screen.getByRole('separator'))
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '240')
  view.rerender(<ResizableInspector {...props} storageKey="checkout-a" mode={null} />)
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
})
