import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@core/api/client'
import type { Automation, AutomationRun } from '@core/api/client'
import { useAppStore } from '@core/store'
import { AutomationsPage } from './AutomationsPage'
import { RunsDashboard } from './components/RunsDashboard'
import { RunDetail } from './components/RunDetail'
import { handleAutomationRunEvent, resetAutomationRunEvents } from './lib/run-events'
import { validateAutomationForm } from './lib/schemas'
import { initialFormValues } from './lib/form'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import type { ReactElement } from 'react'

const renderUI = (ui: ReactElement) => render(<AppTooltipProvider>{ui}</AppTooltipProvider>)

vi.mock('@core/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@core/api/client')>()
  return {
    ...original,
    listAutomations: vi.fn(),
    createAutomation: vi.fn(),
    updateAutomation: vi.fn(),
    deleteAutomation: vi.fn(),
    runAutomationNow: vi.fn(),
    pauseAutomation: vi.fn(),
    resumeAutomation: vi.fn(),
    listAutomationRuns: vi.fn(),
    listAutomationRunsFor: vi.fn(),
    getAutomationRun: vi.fn(),
    cancelAutomationRun: vi.fn(),
    previewAutomationSchedule: vi.fn(),
    fetchWorkspaceChatProviders: vi.fn(),
    fetchWorkspaceChatModels: vi.fn(),
    fetchUnifiedAgents: vi.fn(),
  }
})

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Prompt" value={value} onChange={event => onChange(event.target.value)} />
  ),
}))

vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }
})

const config = { baseUrl: 'http://localhost:4010', apiToken: 'dev-token' }

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1', name: 'Weekday repo audit', prompt: 'Audit the repo', provider: 'claude', model: '', reasoning_effort: '',
    project_id: '', task_id: '', workspace_mode: 'project', base_branch: '',
    schedule: { kind: 'weekdays', time: '09:00', timezone: 'UTC' }, grace_minutes: 720, precheck: { command: '', timeout_seconds: 60 }, enabled: true,
    created_at: hoursFromNow(-48), updated_at: hoursFromNow(-48), next_run_at: hoursFromNow(3), last_run_at: '', last_run_status: '',
    schedule_description: 'Weekdays at 09:00 (UTC)', project_name: '', task_identifier: '', task_title: '',
    ...overrides,
  }
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1', automation_id: 'auto-1', automation_name: 'Weekday repo audit', run_number: 1, title: 'Weekday repo audit run 1', trigger: 'scheduled',
    status: 'succeeded', scheduled_for: hoursFromNow(-2), started_at: hoursFromNow(-2), finished_at: hoursFromNow(-1.9),
    project_id: '', workspace_id: '', workspace_path: '', branch: '', chat_project_id: '__orchestrator__', chat_session_id: 'chat-1',
    task_id: '', provider: 'claude', model: '', output: '## Report\n\nAll good.', output_truncated: false, error: '',
    precheck: null, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, occurrence_count: 1,
    ...overrides,
  }
}

beforeAll(() => {
  // Radix primitives rely on browser APIs that jsdom lacks.
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.releasePointerCapture ??= () => {}
  proto.setPointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
  ;(globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})

beforeEach(() => {
  vi.clearAllMocks()
  resetAutomationRunEvents()
  useAppStore.setState({ config, projects: [{ id: 'proj-1', name: 'Orchestra', root_path: '/repo', remote_url: '' }], allBoardIssues: [], activeSection: 'AUTOMATIONS', requestedWorkspaceConversation: null })
  vi.mocked(api.listAutomations).mockResolvedValue([])
  vi.mocked(api.listAutomationRuns).mockResolvedValue([])
  vi.mocked(api.listAutomationRunsFor).mockResolvedValue([])
  vi.mocked(api.previewAutomationSchedule).mockResolvedValue({ valid: true, description: 'Weekdays at 09:00 (UTC)', next_runs: [hoursFromNow(1), hoursFromNow(25), hoursFromNow(49)] })
  vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [{ id: 'claude', label: 'Claude Code', enabled: true, conversation_mode: 'native_session', provider_resume: true }] })
  vi.mocked(api.fetchWorkspaceChatModels).mockResolvedValue({ provider: 'claude', project_id: '__orchestrator__', observation: 'provider_catalog', models: [] })
  vi.mocked(api.fetchUnifiedAgents).mockResolvedValue([])
})

afterEach(() => cleanup())

describe('AutomationsPage list', () => {
  it('shows the template gallery when there are no automations', async () => {
    renderUI(<AutomationsPage config={config} />)
    const gallery = await screen.findByLabelText('Automation templates')
    expect(screen.getByText('Start from a template')).toBeInTheDocument()
    for (const name of ['Weekday repo audit', 'Release readiness', 'Daily change review', 'Hourly maintenance check']) {
      expect(within(gallery).getByText(name)).toBeInTheDocument()
    }
    expect(within(gallery).getByRole('button', { name: /Add new/ })).toBeInTheDocument()
  })

  it('opens the editor prefilled from a template', async () => {
    renderUI(<AutomationsPage config={config} />)
    fireEvent.click(await screen.findByText('Release readiness'))
    expect(await screen.findByLabelText('Automation name')).toHaveValue('Release readiness')
    await waitFor(() => expect(api.previewAutomationSchedule).toHaveBeenCalledWith(config, expect.objectContaining({ kind: 'weekly', time: '14:00', day: 4 })))
  })

  it('renders rows with schedule, links, next run, last run and status', async () => {
    vi.mocked(api.listAutomations).mockResolvedValue([
      automation(),
      automation({ id: 'auto-2', name: 'Release readiness', enabled: false, project_id: 'proj-1', project_name: 'Orchestra', task_id: 'issue-9', task_identifier: 'ORC-9', last_run_at: hoursFromNow(-5), last_run_status: 'failed', schedule_description: 'Thursdays at 14:00' }),
    ])
    renderUI(<AutomationsPage config={config} />)
    const table = await screen.findByRole('table', { name: 'Automations' })
    const first = within(table).getByRole('row', { name: 'Weekday repo audit' })
    expect(within(first).getByText('Weekdays at 09:00 (UTC)')).toBeInTheDocument()
    expect(within(first).getByText('Never ran')).toBeInTheDocument()
    expect(within(first).getByText('Enabled')).toBeInTheDocument()
    const second = within(table).getByRole('row', { name: 'Release readiness' })
    expect(within(second).getAllByText('Paused')).toHaveLength(2)
    expect(within(second).getByText('Orchestra')).toBeInTheDocument()
    expect(within(second).getByText('ORC-9')).toBeInTheDocument()
    expect(within(second).getByText('Failed').closest('span[class*="text-red-500"]')).not.toBeNull()
  })

  it('filters by search and supports arrow/enter keyboard navigation', async () => {
    vi.mocked(api.listAutomations).mockResolvedValue([automation(), automation({ id: 'auto-2', name: 'Release readiness' })])
    renderUI(<AutomationsPage config={config} />)
    const table = await screen.findByRole('table', { name: 'Automations' })
    fireEvent.change(screen.getByLabelText('Search automations'), { target: { value: 'release' } })
    expect(within(table).queryByRole('row', { name: 'Weekday repo audit' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Search automations'), { target: { value: '' } })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Release readiness', 'Weekday repo audit'])
    rows[0].focus()
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1], { key: 'Enter' })
    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All automations/ })).toBeInTheDocument()
  })

  it('kebab actions run now, pause and delete with confirmation', async () => {
    const user = userEvent.setup()
    const item = automation()
    vi.mocked(api.listAutomations).mockResolvedValue([item])
    vi.mocked(api.runAutomationNow).mockResolvedValue(run({ status: 'queued', trigger: 'manual' }))
    // The server is the source of truth: list refreshes reflect each mutation.
    vi.mocked(api.pauseAutomation).mockImplementation(async () => {
      vi.mocked(api.listAutomations).mockResolvedValue([{ ...item, enabled: false }])
      return { ...item, enabled: false }
    })
    vi.mocked(api.deleteAutomation).mockImplementation(async () => {
      vi.mocked(api.listAutomations).mockResolvedValue([])
    })
    renderUI(<AutomationsPage config={config} />)

    await user.click(await screen.findByRole('button', { name: 'Actions for Weekday repo audit' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Run now' }))
    await waitFor(() => expect(api.runAutomationNow).toHaveBeenCalledWith(config, 'auto-1'))

    await user.click(screen.getByRole('button', { name: 'Actions for Weekday repo audit' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Pause' }))
    await waitFor(() => expect(api.pauseAutomation).toHaveBeenCalledWith(config, 'auto-1'))
    const row = await screen.findByRole('row', { name: 'Weekday repo audit' })
    await waitFor(() => expect(within(row).getByText('Paused', { selector: 'span' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Actions for Weekday repo audit' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Deletes the automation and its run history. Worktrees created by runs are kept.')).toBeInTheDocument()
    expect(api.deleteAutomation).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteAutomation).toHaveBeenCalledWith(config, 'auto-1'))
    await waitFor(() => expect(screen.queryByRole('row', { name: 'Weekday repo audit' })).toBeNull())
  })

  it('offers the same actions on right-click', async () => {
    vi.mocked(api.listAutomations).mockResolvedValue([automation()])
    vi.mocked(api.runAutomationNow).mockResolvedValue(run({ status: 'queued' }))
    renderUI(<AutomationsPage config={config} />)
    fireEvent.contextMenu(await screen.findByRole('row', { name: 'Weekday repo audit' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Run now' }))
    await waitFor(() => expect(api.runAutomationNow).toHaveBeenCalledWith(config, 'auto-1'))
  })
})

describe('AutomationEditorDialog', () => {
  it('validates required fields before submitting', async () => {
    renderUI(<AutomationsPage config={config} />)
    fireEvent.click(await screen.findByRole('button', { name: /New automation/ }))
    await screen.findByLabelText('Automation name')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Prompt is required')).toBeInTheDocument()
    expect(api.createAutomation).not.toHaveBeenCalled()
  })

  it('previews the schedule and submits the normalized payload', async () => {
    vi.mocked(api.createAutomation).mockImplementation(async (_config, input) => {
      const created = automation({ ...input, id: 'auto-new' } as Partial<Automation>)
      vi.mocked(api.listAutomations).mockResolvedValue([created])
      return created
    })
    renderUI(<AutomationsPage config={config} />)
    fireEvent.click(await screen.findByRole('button', { name: /New automation/ }))
    fireEvent.change(await screen.findByLabelText('Automation name'), { target: { value: 'Nightly audit' } })
    fireEvent.change(await screen.findByLabelText('Prompt'), { target: { value: 'Check the build' } })

    await waitFor(() => expect(api.previewAutomationSchedule).toHaveBeenCalledWith(config, expect.objectContaining({ kind: 'weekdays', time: '09:00' })))
    const preview = screen.getByTestId('schedule-preview')
    await waitFor(() => expect(within(preview).getByText('Weekdays at 09:00 (UTC)')).toBeInTheDocument())
    expect(within(preview).getAllByRole('listitem')).toHaveLength(3)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose harness and model' })).toHaveTextContent('Claude Code'))

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(api.createAutomation).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.createAutomation).mock.calls[0][1]).toEqual(expect.objectContaining({
      name: 'Nightly audit',
      prompt: 'Check the build',
      provider: 'claude',
      project_id: '',
      task_id: '',
      workspace_mode: 'project',
      schedule: expect.objectContaining({ kind: 'weekdays', time: '09:00' }),
      grace_minutes: 720,
      precheck: { command: '', timeout_seconds: 60 },
      enabled: true,
    }))
    expect(await screen.findByRole('row', { name: 'Nightly audit' })).toBeInTheDocument()
  })

  it('offers compatible agent profiles, hides Gemini and submits agent_id', async () => {
    const user = userEvent.setup()
    vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [
      { id: 'gemini', label: 'Gemini', enabled: true, conversation_mode: 'transcript_replay', provider_resume: false },
      { id: 'claude', label: 'Claude Code', enabled: true, conversation_mode: 'native_session', provider_resume: true },
    ] })
    vi.mocked(api.fetchUnifiedAgents).mockResolvedValue([
      { id: 'orchestra:global:orchestra:reviewer', name: 'reviewer', mode: 'primary', source: 'orchestra', scope: 'global', selectable: true },
      { id: 'orchestra:global:orchestra:planner', name: 'planner', mode: 'all', source: 'orchestra', scope: 'global', selectable: false, unavailable_reason: 'Needs skills support' },
      { id: 'harness:global:claude:explorer', name: 'explorer', mode: 'subagent', source: 'harness', scope: 'global', harness: 'claude' },
    ])
    vi.mocked(api.createAutomation).mockImplementation(async (_config, input) => automation({ ...input, id: 'auto-agent' } as Partial<Automation>))
    renderUI(<AutomationsPage config={config} />)
    fireEvent.click(await screen.findByRole('button', { name: /New automation/ }))
    fireEvent.change(await screen.findByLabelText('Automation name'), { target: { value: 'Agent run' } })
    fireEvent.change(await screen.findByLabelText('Prompt'), { target: { value: 'Review the diff' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose harness and model' })).toHaveTextContent('Claude Code'))
    await waitFor(() => expect(api.fetchUnifiedAgents).toHaveBeenCalledWith(config, { projectId: undefined, harness: 'claude' }))

    await user.click(screen.getByRole('combobox', { name: 'Agent profile' }))
    expect(await screen.findByRole('option', { name: /planner/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('option', { name: /explorer/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /reviewer/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Choose harness and model' }))
    expect(await screen.findByRole('button', { name: 'Use Claude Code' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use Gemini' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(api.createAutomation).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.createAutomation).mock.calls[0][1]).toEqual(expect.objectContaining({ provider: 'claude', agent_id: 'orchestra:global:orchestra:reviewer' }))
  })

  it('keeps agent_id empty in the payload when no agent profile is chosen', () => {
    const result = validateAutomationForm({ ...initialFormValues(), name: 'n', prompt: 'p', provider: 'codex' })
    expect(result.ok && result.input.agent_id).toBe('')
  })

  it('validates custom cron and shows the 5-cell breakdown', () => {
    const values = initialFormValues(null, null)
    const bad = validateAutomationForm({ ...values, name: 'x', prompt: 'y', provider: 'claude', schedule: { kind: 'cron', cron: '0 9 * *' } })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors['schedule.cron']).toMatch(/5 fields/)
    const good = validateAutomationForm({ ...values, name: 'x', prompt: 'y', provider: 'claude', project_id: 'p', workspace_mode: 'new_worktree', base_branch: ' main ', schedule: { kind: 'cron', cron: '*/15 9-17 * * 1-5', timezone: 'UTC' } })
    expect(good.ok).toBe(true)
    if (good.ok) {
      expect(good.input.schedule).toEqual({ kind: 'cron', cron: '*/15 9-17 * * 1-5', timezone: 'UTC' })
      expect(good.input.base_branch).toBe('main')
    }
  })

  it('renders custom cron cells and previews them through the backend', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listAutomations).mockResolvedValue([automation({ schedule: { kind: 'cron', cron: '*/15 9-17 * * 1-5', timezone: 'UTC' } })])
    renderUI(<AutomationsPage config={config} />)
    await user.click(await screen.findByRole('button', { name: 'Actions for Weekday repo audit' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    expect(await screen.findByLabelText('Cron expression')).toHaveValue('*/15 9-17 * * 1-5')
    expect(screen.getByTestId('cron-cell-minute')).toHaveTextContent('*/15')
    expect(screen.getByTestId('cron-cell-hour')).toHaveTextContent('9-17')
    expect(screen.getByTestId('cron-cell-dow')).toHaveTextContent('1-5')
    await waitFor(() => expect(api.previewAutomationSchedule).toHaveBeenCalledWith(config, { kind: 'cron', cron: '*/15 9-17 * * 1-5', timezone: 'UTC' }))
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })
})

describe('RunsDashboard', () => {
  it('shows 24h/7d stats and filters by status and search', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listAutomationRuns).mockResolvedValue([
      run(),
      run({ id: 'run-2', run_number: 2, title: 'Weekday repo audit run 2', status: 'failed', error: 'boom', finished_at: hoursFromNow(-30), started_at: hoursFromNow(-30) }),
      run({ id: 'run-3', automation_id: 'auto-2', automation_name: 'Release readiness', title: 'Release readiness run 1', status: 'skipped_precheck', finished_at: hoursFromNow(-3) }),
    ])
    renderUI(<RunsDashboard config={config} onBack={() => {}} onOpenRun={() => {}} />)
    await screen.findByText('Weekday repo audit run 1')
    await waitFor(() => expect(screen.getByTestId('stat-Succeeded · 24h')).toHaveTextContent('1'))
    expect(screen.getByTestId('stat-Failed · 24h')).toHaveTextContent('0')
    expect(screen.getByTestId('stat-Failed · 7d')).toHaveTextContent('1')
    expect(screen.getByText('precheck', { exact: false })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Status filter' }))
    await user.click(await screen.findByRole('option', { name: 'Failed' }))
    expect(screen.queryByText('Weekday repo audit run 1')).toBeNull()
    expect(screen.getByText('Weekday repo audit run 2')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Status filter' }))
    await user.click(await screen.findByRole('option', { name: 'All statuses' }))
    fireEvent.change(screen.getByLabelText('Search runs'), { target: { value: 'release' } })
    expect(screen.getByText('Release readiness run 1')).toBeInTheDocument()
    expect(screen.queryByText('Weekday repo audit run 2')).toBeNull()
  })
})

describe('RunDetail', () => {
  it('renders markdown output and opens the Maestro conversation', async () => {
    vi.mocked(api.getAutomationRun).mockResolvedValue(run())
    vi.mocked(api.runAutomationNow).mockResolvedValue(run({ id: 'run-9', status: 'queued' }))
    renderUI(<RunDetail config={config} runId="run-1" initialRun={run()} onBack={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'Report' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Open conversation/ }))
    expect(useAppStore.getState().activeSection).toBe('ORCHESTRATOR')
    expect(useAppStore.getState().requestedWorkspaceConversation).toEqual(expect.objectContaining({ projectId: '__orchestrator__', sessionId: 'chat-1', baseUrl: config.baseUrl }))

    fireEvent.click(screen.getByRole('button', { name: /Rerun/ }))
    await waitFor(() => expect(api.runAutomationNow).toHaveBeenCalledWith(config, 'auto-1'))
  })

  it('cancels an active run, falls back to precheck output and links the task', async () => {
    const active = run({ status: 'running', output: '', finished_at: '', task_id: 'issue-9', precheck: { exit_code: 0, stdout: 'changes found', stderr: '', duration_ms: 12 } })
    vi.mocked(api.getAutomationRun).mockResolvedValue(active)
    vi.mocked(api.cancelAutomationRun).mockResolvedValue({ ...active, status: 'cancelled' })
    const onOpenTask = vi.fn()
    renderUI(<RunDetail config={config} runId="run-1" initialRun={active} automation={automation({ task_id: 'issue-9', task_identifier: 'ORC-9' })} onBack={() => {}} onOpenTask={onOpenTask} />)
    expect(await screen.findByText('changes found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rerun/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'ORC-9' }))
    expect(onOpenTask).toHaveBeenCalledWith('ORC-9')
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    await waitFor(() => expect(api.cancelAutomationRun).toHaveBeenCalledWith(config, 'run-1'))
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveAttribute('data-status', 'cancelled'))
  })

  it('opens project conversations through the workspace conversation request', async () => {
    const projectRun = run({ project_id: 'proj-1', chat_project_id: 'proj-1', chat_session_id: 'chat-7' })
    vi.mocked(api.getAutomationRun).mockResolvedValue(projectRun)
    renderUI(<RunDetail config={config} runId="run-1" initialRun={projectRun} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Open conversation/ }))
    expect(useAppStore.getState().requestedWorkspaceConversation).toEqual(expect.objectContaining({ projectId: 'proj-1', sessionId: 'chat-7' }))
  })
})

describe('automation run events', () => {
  it('notifies once when a run finishes and updates mounted run lists', async () => {
    vi.mocked(api.listAutomationRuns).mockResolvedValue([run({ status: 'running', finished_at: '' })])
    renderUI(<RunsDashboard config={config} onBack={() => {}} onOpenRun={() => {}} />)
    await screen.findByText('Weekday repo audit run 1')
    const notify = vi.fn()
    act(() => {
      handleAutomationRunEvent(run({ status: 'failed', error: 'tests failed' }), notify)
      handleAutomationRunEvent(run({ status: 'failed', error: 'tests failed' }), notify)
    })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Automation failed', expect.stringContaining('tests failed'))
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveAttribute('data-status', 'failed'))
  })
})
