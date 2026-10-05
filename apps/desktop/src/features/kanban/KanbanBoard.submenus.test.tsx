import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import type { Project } from '@core/api/types'
import { KanbanBoard } from './KanbanBoard'

vi.mock('@ui/tooltip-wrapper', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))

afterEach(() => {
  cleanup()
  resetAppStore()
})

const projects: Project[] = [
  { id: 'project-a', name: 'Alpha', root_path: 'C:/fixture/alpha', remote_url: '' },
  { id: 'project-b', name: 'Beta', root_path: 'C:/fixture/beta', remote_url: '' },
]

function mount() {
  useAppStore.setState({ selectedProjectID: 'project-a' })
  render(<KanbanBoard
    config={null}
    project={null}
    loadingState={false}
    snapshot={null}
    boardIssues={[]}
    projects={projects}
    availableAgents={[]}
    onInspectIssue={vi.fn(async () => {})}
  />)
}

describe('Kanban project selector walkthrough', () => {
  it('opens the Work Items project menu, scopes selection by project ID, and returns focus', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Work Items' }))
    const trigger = screen.getByRole('button', { name: 'Choose work items project' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }))

    expect(useAppStore.getState().selectedProjectID).toBe('project-b')
    expect(screen.queryByRole('button', { name: /Beta/ })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on Escape without changing project scope and restores trigger focus', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Work Items' }))
    const trigger = screen.getByRole('button', { name: 'Choose work items project' })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(useAppStore.getState().selectedProjectID).toBe('project-a')
    expect(screen.queryByRole('button', { name: /Beta/ })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
