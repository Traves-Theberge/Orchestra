import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectControls } from './ProjectControls'
import type { Project } from '@core/api/types'

vi.mock('@ui/tooltip-wrapper', () => ({
  AppTooltip: ({ children }: { children: React.ReactNode }) => children,
}))

const sampleProjects: Project[] = [
  { id: 'p1', name: 'Alpha', root_path: '/repo/alpha', remote_url: '' },
]

describe('ProjectControls', () => {
  it('renders search and all action buttons including Refresh workspaces', () => {
    const onRefresh = vi.fn()
    const onAddProject = vi.fn()
    const onNewTask = vi.fn()
    const onQueryChange = vi.fn()

    render(
      <ProjectControls
        projects={sampleProjects}
        query=""
        onQueryChange={onQueryChange}
        onSelect={vi.fn()}
        onAddProject={onAddProject}
        onNewTask={onNewTask}
        onRefresh={onRefresh}
      />,
    )

    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toBeVisible()
    expect(screen.getByPlaceholderText('Project Search')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Refresh workspaces' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add project' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'New task' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh workspaces' }))
    expect(onRefresh).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    expect(onAddProject).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    expect(onNewTask).toHaveBeenCalledOnce()
  })

  it('disables new task button when projects list is empty', () => {
    render(
      <ProjectControls
        projects={[]}
        query=""
        onQueryChange={vi.fn()}
        onSelect={vi.fn()}
        onAddProject={vi.fn()}
        onNewTask={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled()
  })
})
