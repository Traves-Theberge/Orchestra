import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Project } from '@core/api/types'
import type { BackendConfig, IssueListItem, TrackerConfig } from '@core/api/client'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { ProjectDetailView } from './ProjectDetailView'

const mocks = vi.hoisted(() => ({
  listTrackerConfigs: vi.fn(),
  assignProjectTrackerConfig: vi.fn(),
  refreshProjects: vi.fn(),
  setActiveSection: vi.fn(),
  setSettingsInitialTab: vi.fn(),
}))

vi.mock('@core/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/api/client')>()),
  listTrackerConfigs: mocks.listTrackerConfigs,
  assignProjectTrackerConfig: mocks.assignProjectTrackerConfig,
}))

vi.mock('@core/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    openFile: vi.fn(),
    openFiles: [],
    openBrowserTab: vi.fn(),
    setActiveSection: mocks.setActiveSection,
    setSettingsInitialTab: mocks.setSettingsInitialTab,
  }),
}))

vi.mock('@layout/panels', () => ({ KanbanBoard: () => <div>Kanban board</div> }))
vi.mock('@features/git', () => ({ GitTab: () => <div>Git tab</div> }))
vi.mock('@features/workspace/editor/EditorContent', () => ({ EditorContent: () => <div>Editor</div> }))

const backend: BackendConfig = { baseUrl: 'http://localhost:4014', apiToken: 'test-token' }
const project: Project = {
  id: 'project-1', name: 'Sample', root_path: 'C:/repo', remote_url: '',
  issue_source_type: '', issue_source_endpoint: '',
}

function projectElement(overrides: Partial<Project> = {}) {
  return <AppTooltipProvider><ProjectDetailView
    project={{ ...project, ...overrides }}
    config={backend}
    snapshot={null}
    boardIssues={[] as IssueListItem[]}
    availableAgents={[]}
    loadingState={false}
    onBack={vi.fn()}
    onInspectIssue={vi.fn(async () => {})}
    onIssueUpdate={vi.fn(async () => {})}
    onCreateIssue={vi.fn()}
    onDeleteProject={vi.fn(async () => {})}
    onRefreshProjects={mocks.refreshProjects}
  /></AppTooltipProvider>
}

function renderProject(overrides: Partial<Project> = {}) {
  return render(projectElement(overrides))
}

function chooseSource(type: 'Linear' | 'Jira' | 'GitHub') {
  fireEvent.click(screen.getByRole('button', { name: 'None' }))
  fireEvent.click(screen.getByRole('button', { name: type }))
}

const trackerConfig = (overrides: Partial<TrackerConfig>): TrackerConfig => ({
  id: 'tracker-config-1', type: 'linear', display_name: 'Engineering', endpoint: 'https://api.linear.app/graphql',
  auth_method: 'apikey', has_token: true, extra: '{}', created_at: 0, updated_at: 0, ...overrides,
})

describe('ProjectDetailView issue source links', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('links Linear by saved config ID and displays the native team key, never the team UUID', async () => {
    mocks.listTrackerConfigs.mockResolvedValue([
      trackerConfig({ id: 'linear-config', extra: '{"team_key":"ENG"}' }),
    ])
    mocks.assignProjectTrackerConfig.mockResolvedValue({ ok: true })
    const view = renderProject()
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    chooseSource('Linear')

    const connection = await screen.findByRole('button', { name: 'No connection linked' })
    expect(screen.getByRole('group', { name: 'Linear tracker connection' })).toBeTruthy()
    fireEvent.click(connection)
    const option = await screen.findByRole('button', { name: 'Engineering · Team ENG' })
    expect(option.textContent).not.toContain('linear-config')
    fireEvent.click(option)
    fireEvent.click(screen.getByRole('button', { name: 'Link connection' }))

    await waitFor(() => expect(mocks.assignProjectTrackerConfig).toHaveBeenCalledWith(backend, 'project-1', 'linear-config'))
    expect(mocks.refreshProjects).toHaveBeenCalledOnce()

    view.rerender(projectElement({ tracker_config_id: 'linear-config', issue_source_type: '', issue_source_endpoint: '' }))
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect(await screen.findByRole('button', { name: 'Engineering · Team ENG' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Link connection' })).toBeTruthy()
  })

  it('keeps a Jira site and native project key together in the saved connection label', async () => {
    mocks.listTrackerConfigs.mockResolvedValue([
      trackerConfig({
        id: 'jira-config', type: 'jira', display_name: 'Company Jira',
        endpoint: 'https://example.atlassian.net', extra: '{"default_project":"ORCH"}',
      }),
    ])
    renderProject()
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    chooseSource('Jira')

    const connection = await screen.findByRole('button', { name: 'No connection linked' })
    expect(screen.getByRole('group', { name: 'Jira tracker connection' })).toBeTruthy()
    fireEvent.click(connection)
    const option = await screen.findByRole('button', { name: 'Company Jira · https://example.atlassian.net · Project ORCH' })
    expect(option).toBeTruthy()
    expect(screen.queryByPlaceholderText('https://yourco.atlassian.net')).toBeNull()
  })

  it('resolves a same-project linked config even when embedded source metadata is empty', async () => {
    mocks.listTrackerConfigs.mockResolvedValue([
      trackerConfig({
        id: 'jira-config', type: 'jira', display_name: 'Company Jira',
        endpoint: 'https://example.atlassian.net', extra: '{"default_project":"ORCH"}',
      }),
    ])
    renderProject({ tracker_config_id: 'jira-config', issue_source_type: '', issue_source_endpoint: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))

    expect(await screen.findByRole('button', { name: 'Company Jira · https://example.atlassian.net · Project ORCH' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Link connection' })).toBeTruthy()
  })

  it('shows tracker config load failures and does not present them as an empty connection list', async () => {
    mocks.listTrackerConfigs.mockRejectedValue(new Error('connection list unavailable'))
    renderProject({ tracker_config_id: 'linked-jira', issue_source_type: '', issue_source_endpoint: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the linked tracker connection: connection list unavailable')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('preserves an explicit None choice if the linked config list resolves later', async () => {
    let resolveConfigs!: (configs: TrackerConfig[]) => void
    mocks.listTrackerConfigs.mockReturnValue(new Promise<TrackerConfig[]>((resolve) => { resolveConfigs = resolve }))
    renderProject({ tracker_config_id: 'jira-config', issue_source_type: '', issue_source_endpoint: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))

    const noneTrigger = screen.getByRole('button', { name: 'None' })
    fireEvent.click(noneTrigger)
    fireEvent.click(screen.getAllByRole('button', { name: 'None' })[1])
    await act(async () => {
      resolveConfigs([trackerConfig({ id: 'jira-config', type: 'jira', extra: '{"default_project":"ORCH"}' })])
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'None' })).toBeTruthy()
    expect(screen.queryByText('Jira site and project')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Company Jira · https://example.atlassian.net · Project ORCH' })).toBeNull()
  })
})
