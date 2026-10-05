import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateTaskDialog } from './CreateTaskDialog'
import type { BackendConfig, IssueCreatePayload } from '@core/api/client'
import type { Project } from '@core/api/types'

vi.mock('@/workers/whisper-client', () => ({
  setWhisperBackendConfig: vi.fn(),
  getWhisperClient: () => ({
    recording: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    transcribe: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
})

const config: BackendConfig = {
  baseUrl: 'http://127.0.0.1:4010',
  apiToken: 'test-token',
}

const projects: Project[] = [
  { id: 'proj-1', name: 'Alpha', root_path: '/tmp/alpha', remote_url: '' } as Project,
  { id: 'proj-2', name: 'Beta', root_path: '/tmp/beta', remote_url: '' } as Project,
]

function renderDialog(overrides?: {
  projects?: Project[]
  initialProjectID?: string
  availableAgents?: string[]
  availableRuntimes?: { target: string; configured: boolean }[]
  onSubmit?: (payload: IssueCreatePayload) => Promise<void>
}) {
  const onSubmit = overrides?.onSubmit ?? vi.fn(async () => {})
  const onOpenChange = vi.fn()

  render(
    <CreateTaskDialog
      open={true}
      onOpenChange={onOpenChange}
      config={config}
      initialState="open"
      availableAgents={overrides?.availableAgents ?? ['codex']}
      availableRuntimes={overrides?.availableRuntimes}
      projects={overrides?.projects ?? projects}
      initialProjectID={overrides?.initialProjectID ?? 'proj-1'}
      onSubmit={onSubmit}
    />,
  )

  return { onSubmit, onOpenChange }
}

describe('CreateTaskDialog', () => {
  it('renders title input and description textarea', () => {
    renderDialog()

    expect(screen.getByPlaceholderText('What needs to be done?')).toBeTruthy()
    expect(screen.getByPlaceholderText('Describe the task for the agent…')).toBeTruthy()
  })

  it('submit button is disabled when title is empty', () => {
    renderDialog()

    const submitButton = screen.getByRole('button', { name: /create/i })
    expect((submitButton as HTMLButtonElement).disabled).toBe(true)
  })

  it('submit button is disabled when no project is selected', () => {
    renderDialog({ projects: [], initialProjectID: '' })

    const submitButton = screen.getByRole('button', { name: /create/i })
    expect((submitButton as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows title validation error for too-short titles', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderDialog()

    const titleInput = screen.getByPlaceholderText('What needs to be done?')
    await user.type(titleInput, 'ab')

    const form = titleInput.closest('form')!
    form.requestSubmit()

    const error = await screen.findByText('Title must be at least 3 characters')
    expect(error).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the exact project, assignee, and configured runtime selected from the task menus', async () => {
    const onSubmit = vi.fn(async (_payload: IssueCreatePayload) => {})
    renderDialog({
      availableAgents: ['codex', 'opencode'],
      availableRuntimes: [{ target: 'GCP', configured: true }],
      onSubmit,
    })

    fireEvent.change(screen.getByPlaceholderText('What needs to be done?'), { target: { value: 'Fixture task' } })
    fireEvent.change(screen.getByPlaceholderText(/Describe the task for the agent/), { target: { value: 'Fixture description' } })
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Codexcodex' }))
    fireEvent.click(screen.getByRole('button', { name: 'OpenCodeopencode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Local' }))
    fireEvent.click(screen.getByRole('button', { name: 'Gcp' }))
    fireEvent.click(screen.getByRole('button', { name: /Create task/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      title: 'Fixture task',
      description: 'Fixture description',
      state: 'Backlog',
      assignee_id: 'agent-opencode',
      project_id: 'proj-2',
      provider: 'opencode',
      runtime_target: 'GCP',
      disabled_tools: [],
    }))
  })
})
