import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@core/store'
import type { BackendConfig, Project } from '@core/api/types'
import { StudioModal } from './StudioModal'

const push = vi.hoisted(() => vi.fn())
vi.mock('./StudioSection', () => ({
  StudioSection: ({ config, projectId }: { config: BackendConfig; projectId: string }) => (
    <button onClick={() => push(config, projectId)}>Push test draft</button>
  ),
}))
vi.mock('@layout/shared/controls', () => ({
  ProjectSelector: ({ value, projects, onChange }: {
    value: string; projects: Project[]; onChange: (id: string) => void
  }) => (
    <select aria-label="Project" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose project</option>
      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
  ),
}))

const config: BackendConfig = { baseUrl: 'http://backend-a.test', apiToken: 'fixture-a' }
const projects: Project[] = [
  { id: 'a', name: 'Project A', root_path: '/a', remote_url: '' },
  { id: 'b', name: 'Project B', root_path: '/b', remote_url: '' },
]

describe('StudioModal session ownership', () => {
  beforeEach(() => {
    push.mockReset()
    useAppStore.setState({ studioModalOpen: true, selectedProjectID: 'a' })
  })

  it('keeps the displayed project and dispatch target fixed across project and backend changes', async () => {
    const { rerender } = render(<StudioModal config={config} projects={projects} />)
    await screen.findByRole('button', { name: 'Push test draft' })
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeDisabled()
    // Even a programmatic change must not rebind an owned session.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } })
    act(() => useAppStore.setState({ selectedProjectID: 'b' }))
    rerender(<StudioModal config={{ baseUrl: 'http://backend-b.test', apiToken: 'fixture-b' }} projects={projects} />)
    expect(screen.getByRole('combobox')).toHaveValue('a')
    fireEvent.click(screen.getByRole('button', { name: 'Push test draft' }))
    expect(push).toHaveBeenCalledWith(config, 'a')
  })

  it('allows another project after closing without discarding the previous draft', async () => {
    render(<StudioModal config={config} projects={projects} />)
    await screen.findByRole('button', { name: 'Push test draft' })
    fireEvent.click(screen.getByRole('button', { name: 'Close Studio' }))
    act(() => useAppStore.setState({ selectedProjectID: 'b', studioModalOpen: true }))
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('b'))
    fireEvent.click(await screen.findByRole('button', { name: 'Push test draft' }))
    expect(push).toHaveBeenCalledWith(config, 'b')
  })

  it('lets an unbound draft choose its project before starting the session', async () => {
    useAppStore.setState({ selectedProjectID: '' })
    render(<StudioModal config={config} projects={projects} />)
    expect(screen.getByRole('combobox')).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Push test draft' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } })
    await screen.findByRole('button', { name: 'Push test draft' })
    expect(screen.getByRole('combobox')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Push test draft' }))
    expect(push).toHaveBeenCalledWith(config, 'b')
  })
})
