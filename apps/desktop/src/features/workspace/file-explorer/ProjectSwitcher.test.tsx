import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@core/store'
import { GLOBAL_PROJECT_ID } from '@core/store/types'
import type { Project } from '@core/api/types'
import { ProjectSwitcher } from './ProjectSwitcher'

afterEach(() => {
  cleanup()
  useAppStore.setState({
    openProjectIds: [GLOBAL_PROJECT_ID],
    activeProjectId: GLOBAL_PROJECT_ID,
    openProjectTab: vi.fn(),
    closeProjectTab: vi.fn(),
    setActiveProjectId: vi.fn(),
    setSelectedProjectID: vi.fn(),
  })
})

const projects = [
  { id: 'project-a', name: 'Alpha', root_path: 'C:/fixtures/alpha', remote_url: '' },
  { id: 'project-b', name: 'Beta', root_path: 'C:/fixtures/beta', remote_url: '' },
] satisfies Project[]

describe('file explorer project switcher walkthrough', () => {
  it('opens an available project using that project’s exact ID and root path', () => {
    const openProjectTab = vi.fn()
    useAppStore.setState({ openProjectIds: [GLOBAL_PROJECT_ID], openProjectTab })
    render(<ProjectSwitcher projects={projects} />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }))
    fireEvent.click(screen.getByRole('button', { name: /^Alpha/ }))

    expect(openProjectTab).toHaveBeenCalledExactlyOnceWith('project-a', 'C:/fixtures/alpha')
    expect(screen.queryByText('Available')).not.toBeInTheDocument()
  })

  it('dismisses outside without opening or changing the selected project', () => {
    const setActiveProjectId = vi.fn()
    const setSelectedProjectID = vi.fn()
    useAppStore.setState({
      openProjectIds: [GLOBAL_PROJECT_ID, 'project-a'],
      activeProjectId: 'project-a',
      setActiveProjectId,
      setSelectedProjectID,
    })
    render(<><ProjectSwitcher projects={projects} /><button>Outside switcher</button></>)

    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }))
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }))
    expect(setActiveProjectId).not.toHaveBeenCalled()
    expect(setSelectedProjectID).not.toHaveBeenCalled()
    expect(screen.queryByText('Open')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside switcher' }))
    expect(screen.queryByText('Open')).not.toBeInTheDocument()
    expect(setActiveProjectId).not.toHaveBeenCalled()
    expect(setSelectedProjectID).not.toHaveBeenCalled()
  })

  it('updates both active project scopes when an open project is selected', () => {
    const setActiveProjectId = vi.fn()
    const setSelectedProjectID = vi.fn()
    useAppStore.setState({
      openProjectIds: [GLOBAL_PROJECT_ID, 'project-a', 'project-b'],
      activeProjectId: 'project-a',
      setActiveProjectId,
      setSelectedProjectID,
    })
    render(<ProjectSwitcher projects={projects} />)

    const trigger = screen.getByRole('button', { name: 'Switch project' })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Open')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }))

    expect(setActiveProjectId).toHaveBeenCalledExactlyOnceWith('project-b')
    expect(setSelectedProjectID).toHaveBeenCalledExactlyOnceWith('project-b')
    expect(screen.queryByText('Open')).not.toBeInTheDocument()
  })
})
