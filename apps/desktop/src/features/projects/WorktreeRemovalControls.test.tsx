import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorktreeRemovalControls } from './WorktreeRemovalControls'
import { removeProjectWorktree, type ProjectWorktree } from '@core/api/client'

vi.mock('@core/api/client', () => ({
  getProjectWorktreeRemoval: vi.fn(),
  removeProjectWorktree: vi.fn(),
}))

const config = { baseUrl: 'http://localhost:4010', apiToken: 'fixture' }
const primary: ProjectWorktree = {
  id: 'root', path: '/repo', branch: 'main', head: 'abcdef123456', primary: true,
  is_main_worktree: true, detached: false, locked: false, prunable: false,
}

describe('WorktreeRemovalControls', () => {
  it('shows a close-view action on the primary workspace while protecting its checkout', () => {
    const onCloseWorkspace = vi.fn()
    const onRemoved = vi.fn()
    render(<WorktreeRemovalControls config={config} projectId="p1" projectName="Repo" worktree={primary} onRemoved={onRemoved} onCloseWorkspace={onCloseWorkspace} />)

    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions for Repo workspace main' }))
    expect(screen.getByRole('menuitem', { name: 'Close workspace view' })).toBeEnabled()
    const protectedRemove = screen.getByRole('menuitem', { name: /Remove worktree unavailable: The primary workspace is protected/ })
    expect(protectedRemove).toBeDisabled()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Close workspace view' }))
    expect(onCloseWorkspace).toHaveBeenCalledOnce()
    expect(onRemoved).not.toHaveBeenCalled()
    expect(removeProjectWorktree).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('keeps the close-view action independent from eligible child checkout removal', () => {
    const onCloseWorkspace = vi.fn()
    const child = { ...primary, id: 'child', path: '/repo/.worktrees/feature', branch: 'feature', primary: false, is_main_worktree: false }
    render(<WorktreeRemovalControls config={config} projectId="p1" projectName="Repo" worktree={child} onRemoved={vi.fn()} onCloseWorkspace={onCloseWorkspace} />)

    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions for Repo workspace feature' }))
    expect(screen.getByRole('menuitem', { name: 'Close workspace view' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Remove worktree' })).toBeEnabled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close workspace view' }))
    expect(onCloseWorkspace).toHaveBeenCalledOnce()
    expect(removeProjectWorktree).not.toHaveBeenCalled()
  })

  it('cycles enabled menu items and supports Home and End', () => {
    const child = { ...primary, id: 'child', path: '/repo/.worktrees/feature', branch: 'feature', primary: false, is_main_worktree: false }
    render(<WorktreeRemovalControls config={config} projectId="p1" projectName="Repo" worktree={child} onRemoved={vi.fn()} onCloseWorkspace={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions for Repo workspace feature' }))
    const close = screen.getByRole('menuitem', { name: 'Close workspace view' })
    const remove = screen.getByRole('menuitem', { name: 'Remove worktree' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(close, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(remove)
    fireEvent.keyDown(remove, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(remove)
    fireEvent.keyDown(remove, { key: 'Home' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'End' })
    expect(document.activeElement).toBe(remove)
  })

  it('opens focus on the first enabled item when the optional close action is unavailable', () => {
    const child = { ...primary, id: 'child', path: '/repo/.worktrees/feature', branch: 'feature', primary: false, is_main_worktree: false }
    render(<WorktreeRemovalControls config={config} projectId="p1" projectName="Repo" worktree={child} onRemoved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions for Repo workspace feature' }))
    const close = screen.getByRole('menuitem', { name: 'Close workspace view' })
    const remove = screen.getByRole('menuitem', { name: 'Remove worktree' })
    expect(close).toBeDisabled()
    expect(document.activeElement).toBe(remove)
    fireEvent.keyDown(remove, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(remove)
  })
})
