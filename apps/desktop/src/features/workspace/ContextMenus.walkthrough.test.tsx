import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileContextMenu, type FileContextAction } from './file-explorer/FileContextMenu'
import { TabContextMenu } from './tabs/TabContextMenu'

afterEach(cleanup)

function FileWalkthrough({ onAction, variant = 'item' }: { onAction: (action: FileContextAction) => void; variant?: 'item' | 'root' }) {
  const [open, setOpen] = useState(false)
  return <><button onClick={() => setOpen(true)}>File actions</button>{open && <FileContextMenu x={24} y={24} variant={variant} onAction={onAction} onClose={() => setOpen(false)} />}</>
}

describe('file context menu walkthrough', () => {
  it.each([
    ['New File', 'newFile'], ['New Folder', 'newFolder'], ['Copy Path', 'copyPath'],
    ['Copy Relative Path', 'copyRelativePath'], ['Open Containing Folder', 'openContaining'],
    ['Rename', 'rename'], ['Delete', 'delete'],
  ] as const)('opens and dispatches %s once, then dismisses', (label, action) => {
    const dispatch = vi.fn()
    const view = render(<FileWalkthrough onAction={dispatch} />)
    fireEvent.click(screen.getByRole('button', { name: 'File actions' }))
    // The popup must escape the containing panel, rather than be clipped by it.
    const menu = screen.getByRole('menu')
    expect(document.body).toContainElement(menu)
    expect(view.container).not.toContainElement(menu)
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(action)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers only creation actions at the root, and cancellation never dispatches', () => {
    const dispatch = vi.fn()
    render(<FileWalkthrough variant="root" onAction={dispatch} />)
    fireEvent.click(screen.getByRole('button', { name: 'File actions' }))
    expect(screen.getByRole('menuitem', { name: 'New File' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'New Folder' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'File actions' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('tab context menu walkthrough', () => {
  function TabWalkthrough({ onCloseTab }: { onCloseTab: () => void }) {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>Tab actions</button>{open && <TabContextMenu x={24} y={24} onCloseTab={onCloseTab} onClose={() => setOpen(false)} />}</>
  }
  it('dismisses without closing the tab, then explicitly closes exactly once', () => {
    const closeTab = vi.fn()
    render(<TabWalkthrough onCloseTab={closeTab} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tab actions' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tab actions' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(closeTab).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Tab actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }))
    expect(closeTab).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
