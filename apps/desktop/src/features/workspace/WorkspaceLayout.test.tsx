import { useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { GLOBAL_PROJECT_ID } from '@core/store/types'
import { WorkspaceLayout } from './WorkspaceLayout'

vi.mock('./chat/WorkspaceChat', () => ({ WorkspaceChat: ({ projectId, headerTools }: { projectId: string; headerTools?: ReactNode }) => {
  const [draft, setDraft] = useState('')
  return <div>{headerTools}<textarea aria-label={`Draft ${projectId}`} value={draft} onChange={e => setDraft(e.target.value)} /></div>
} }))
vi.mock('./SplitLayout', () => ({ SplitLayout: () => <div>Project tools</div> }))
vi.mock('./panels/WorkspaceWelcome', () => ({ WorkspaceWelcome: () => <div>Welcome</div> }))
beforeEach(() => {
  resetAppStore()
  useAppStore.setState({
    config: { baseUrl: 'http://localhost:4014', apiToken: 'fixture' },
    projects: [{ id: 'a', name: 'Alpha', root_path: '/alpha', remote_url: '' }, { id: 'b', name: 'Beta', root_path: '/beta', remote_url: '' }],
    activeProjectId: 'a', openProjectIds: ['a', 'b'],
  })
})
afterEach(cleanup)
describe('WorkspaceLayout chat ownership', () => {
  it('starts with one chat surface and reveals tools only on request', () => {
    render(<WorkspaceLayout />)
    const tools = screen.getByLabelText('Workspace tools')
    expect(tools).not.toBeVisible()
    fireEvent.click(screen.getAllByRole('button', { name: 'Files & terminals' })[0])
    expect(tools).toBeVisible()
    expect(screen.queryByText('Welcome')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Files & terminals' })[0])
    expect(tools).not.toBeVisible()
  })
  it('keeps drafts isolated across project and global workspace switches', () => {
    render(<WorkspaceLayout />)
    fireEvent.change(screen.getByLabelText('Draft a'), { target: { value: 'Alpha draft' } })
    act(() => useAppStore.getState().setActiveProjectId('b'))
    expect(screen.getByLabelText('Draft b')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Draft b'), { target: { value: 'Beta draft' } })
    act(() => useAppStore.getState().setActiveProjectId(GLOBAL_PROJECT_ID))
    act(() => useAppStore.getState().setActiveProjectId('a'))
    expect(screen.getByLabelText('Draft a')).toHaveValue('Alpha draft')
    act(() => useAppStore.getState().setActiveProjectId('b'))
    expect(screen.getByLabelText('Draft b')).toHaveValue('Beta draft')
  })
  it('remounts conversations when the selected backend changes', () => {
    render(<WorkspaceLayout />)
    fireEvent.change(screen.getByLabelText('Draft a'), { target: { value: 'Previous backend draft' } })
    act(() => useAppStore.getState().setConfig({ baseUrl: 'http://localhost:4015', apiToken: 'other-fixture' }))
    expect(screen.getByLabelText('Draft a')).toHaveValue('')
  })
})
