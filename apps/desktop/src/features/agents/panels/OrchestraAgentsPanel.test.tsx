import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@core/api/client'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { OrchestraAgentsPanel } from './OrchestraAgentsPanel'
import { McpStatusPanel } from './McpStatusPanel'
import { resetAppStore, useAppStore } from '@core/store'
import { validateAgentForm, emptyAgentForm } from '../lib/orchestra-agent-schema'

vi.mock('@core/api/client', () => ({
  fetchUnifiedAgents: vi.fn(), fetchHarnessCapabilities: vi.fn(), fetchAgentSkills: vi.fn(), fetchMcpServerStatus: vi.fn(), probeMcpServer: vi.fn(),
  createOrchestraAgent: vi.fn(), updateOrchestraAgent: vi.fn(), deleteOrchestraAgent: vi.fn(),
  toDisplayError: (error: unknown) => error instanceof Error ? error.message : String(error),
}))
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Prompt" value={value} onChange={event => onChange(event.target.value)} />,
}))
vi.mock('sonner', async importOriginal => ({ ...await importOriginal<typeof import('sonner')>(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const config = { baseUrl: 'http://localhost:4010', apiToken: 'dev-token' }
const reviewer: api.OrchestraAgent = {
  id: 'orchestra:global:orchestra:reviewer', name: 'reviewer', description: 'Reviews diffs', mode: 'primary', source: 'orchestra', scope: 'global',
  prompt: 'Review carefully.', skills: ['tdd'], mcp_servers: [], permissions: { bash: 'ask' }, compatible_harnesses: ['claude', 'codex'],
}
const harnessAgent: api.OrchestraAgent = { id: 'harness:global:claude:explorer', name: 'explorer', mode: 'subagent', source: 'harness', scope: 'global', harness: 'claude', path: '/home/.claude/agents/explorer.md' }
const capabilities: api.HarnessCapabilities[] = [
  { harness: 'claude', agent_inline: { supported: true, mechanism: '--agents <tmpfile>' }, skills: { supported: true }, mcp: { supported: true }, model: { supported: true }, effort: { supported: true }, permissions: { supported: true } },
  { harness: 'codex', agent_inline: { supported: true, mechanism: 'developerInstructions' }, skills: { supported: true }, mcp: { supported: true }, model: { supported: true }, effort: { supported: true }, permissions: { supported: false } },
  { harness: '8gent', agent_inline: { supported: false, note: 'unverified with installed CLI' } },
]

beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.releasePointerCapture ??= () => {}
  proto.setPointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
  ;(globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})
beforeEach(() => {
  vi.clearAllMocks()
  resetAppStore()
  vi.mocked(api.fetchUnifiedAgents).mockResolvedValue([reviewer, harnessAgent])
  vi.mocked(api.fetchHarnessCapabilities).mockResolvedValue(capabilities)
  vi.mocked(api.fetchAgentSkills).mockResolvedValue([{ name: 'tdd', harness: 'shared' }, { name: 'release', harness: 'claude' }])
  vi.mocked(api.fetchMcpServerStatus).mockResolvedValue([{ name: 'github', source: 'orchestra', status: 'connected' }])
})
afterEach(() => cleanup())

const renderPanel = (projectId = '') => render(<AppTooltipProvider><OrchestraAgentsPanel config={config} projectId={projectId} /></AppTooltipProvider>)

describe('orchestra agent form schema', () => {
  it('rejects invalid names, colors, empty prompts and project scope without a project', () => {
    const result = validateAgentForm({ ...emptyAgentForm('project', ''), name: 'has space', color: 'red', prompt: '   ' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.name).toMatch(/letters, numbers/)
    expect(result.errors.color).toMatch(/#rrggbb/)
    expect(result.errors.prompt).toBe('Prompt is required')
    expect(result.errors.project_id).toMatch(/Choose a project/)
  })
  it('builds the API payload, dropping default permissions', () => {
    const result = validateAgentForm({ ...emptyAgentForm(), name: ' reviewer ', prompt: 'Do it', permissions: { edit: '', bash: 'deny', webfetch: '' } })
    expect(result).toEqual({ ok: true, input: expect.objectContaining({ scope: 'global', name: 'reviewer', mode: 'primary', prompt: 'Do it', permissions: { bash: 'deny' } }) })
    expect(result.ok && 'project_id' in result.input).toBe(false)
  })
})

describe('OrchestraAgentsPanel', () => {
  it('lists Orchestra agents with mode, scope and harness badges; harness agents link to their harness', async () => {
    renderPanel()
    const orchestra = await screen.findByRole('list', { name: 'Orchestra agents' })
    const row = within(orchestra).getByRole('button', { name: /reviewer/ })
    expect(row).toHaveTextContent('Primary')
    expect(row).toHaveTextContent('Global')
    expect(within(row).getByLabelText('Compatible harnesses: Claude, Codex')).toBeInTheDocument()
    const claude = screen.getByRole('list', { name: 'Claude agents' })
    expect(within(claude).getByText('explorer')).toBeInTheDocument()
    expect(within(claude).queryByRole('button')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Edit in Claude/ }))
    expect(useAppStore.getState().activeAgentProvider).toBe('claude')
    expect(useAppStore.getState().activeAgentCategory).toBe('agents')
  })

  it('offers starter templates when there are no Orchestra agents and prefills the editor', async () => {
    vi.mocked(api.fetchUnifiedAgents).mockResolvedValue([harnessAgent])
    renderPanel()
    expect(await screen.findByText('Create your first agent')).toBeInTheDocument()
    fireEvent.click(within(screen.getByLabelText('Agent templates')).getByRole('button', { name: /test-fixer/ }))
    const form = await screen.findByRole('form', { name: 'Create agent' })
    expect(within(form).getByLabelText('Agent name')).toHaveValue('test-fixer')
    expect(within(form).getByRole('radio', { name: 'Subagent' })).toHaveAttribute('aria-checked', 'true')
    expect(within(form).getByTestId('agent-path')).toHaveTextContent('~/.orchestra/agents/test-fixer.md')
  })

  it('creates project agents with the project path and announces the change to other pickers', async () => {
    const changed = vi.fn()
    window.addEventListener('orchestra:agents-changed', changed)
    useAppStore.setState({ projects: [{ id: 'proj-1', name: 'Nautilus', root_path: '/work/nautilus', remote_url: '' }] })
    vi.mocked(api.createOrchestraAgent).mockImplementation(async (_config, input) => ({ ...reviewer, id: 'orchestra:project:orchestra:local', name: input.name, scope: 'project' }))
    renderPanel()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Create agent' }))[0])
    const form = await screen.findByRole('form', { name: 'Create agent' })
    fireEvent.click(within(form).getByRole('radio', { name: 'This project' }))
    fireEvent.change(within(form).getByLabelText('Agent name'), { target: { value: 'local' } })
    expect(within(form).getByTestId('agent-path')).toHaveTextContent('/work/nautilus/.orchestra/agents/local.md')
    fireEvent.change(await within(form).findByLabelText('Prompt'), { target: { value: 'Local rules.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(api.createOrchestraAgent).toHaveBeenCalledWith(config, expect.objectContaining({ scope: 'project', project_id: 'proj-1', name: 'local' })))
    await waitFor(() => expect(changed).toHaveBeenCalled())
    window.removeEventListener('orchestra:agents-changed', changed)
  })

  it('validates and creates an agent, showing the compatible-harness preview', async () => {
    const created: api.OrchestraAgent = { ...reviewer, id: 'orchestra:global:orchestra:planner', name: 'planner', prompt: 'Plan.' }
    vi.mocked(api.createOrchestraAgent).mockImplementation(async () => { vi.mocked(api.fetchUnifiedAgents).mockResolvedValue([reviewer, harnessAgent, created]); return created })
    renderPanel()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Create agent' }))[0])
    const form = screen.getByRole('form', { name: 'Create agent' })
    fireEvent.click(within(form).getByRole('button', { name: 'Create agent' }))
    expect(await within(form).findByText('Name is required')).toBeInTheDocument()
    expect(within(form).getByText('Prompt is required')).toBeInTheDocument()
    expect(api.createOrchestraAgent).not.toHaveBeenCalled()

    fireEvent.change(within(form).getByLabelText('Agent name'), { target: { value: 'planner' } })
    fireEvent.change(within(form).getByLabelText('Description'), { target: { value: 'Plans work' } })
    fireEvent.change(await within(form).findByLabelText('Prompt'), { target: { value: 'Plan.' } })
    fireEvent.click(within(form).getByRole('radio', { name: 'All' }))
    await waitFor(() => expect(within(form).getAllByTestId('compat-row')).toHaveLength(3))
    const rows = within(form).getAllByTestId('compat-row')
    expect(rows[0]).toHaveAttribute('data-status', 'full')
    expect(rows[0]).toHaveTextContent('via --agents <tmpfile>')
    expect(rows[2]).toHaveAttribute('data-status', 'unavailable')
    expect(rows[2]).toHaveTextContent('unverified with installed CLI')

    fireEvent.click(within(form).getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(api.createOrchestraAgent).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.createOrchestraAgent).mock.calls[0][1]).toEqual(expect.objectContaining({ scope: 'global', name: 'planner', description: 'Plans work', mode: 'all', prompt: 'Plan.', skills: [], mcp_servers: [] }))
    expect(await within(await screen.findByRole('list', { name: 'Orchestra agents' })).findByText('planner')).toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('marks harnesses that would drop permissions as partial, then saves edits via PATCH', async () => {
    vi.mocked(api.updateOrchestraAgent).mockImplementation(async (_config, _id, input) => ({ ...reviewer, ...input } as api.OrchestraAgent))
    renderPanel()
    fireEvent.click(await within(await screen.findByRole('list', { name: 'Orchestra agents' })).findByText('reviewer'))
    const form = screen.getByRole('form', { name: 'Edit agent reviewer' })
    expect(within(form).getByLabelText('Agent name')).toBeDisabled()
    await waitFor(() => expect(within(form).getAllByTestId('compat-row')[1]).toHaveAttribute('data-status', 'partial'))
    expect(within(form).getAllByTestId('compat-row')[1]).toHaveTextContent('ignores permissions')
    fireEvent.change(within(form).getByLabelText('Description'), { target: { value: 'Reviews everything' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.updateOrchestraAgent).toHaveBeenCalledWith(config, reviewer.id, expect.objectContaining({ description: 'Reviews everything', skills: ['tdd'], permissions: { bash: 'ask' } })))
  })

  it('deletes after confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(api.deleteOrchestraAgent).mockImplementation(async () => { vi.mocked(api.fetchUnifiedAgents).mockResolvedValue([harnessAgent]) })
    renderPanel()
    await user.click(await within(await screen.findByRole('list', { name: 'Orchestra agents' })).findByText('reviewer'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = (await screen.findAllByRole('dialog')).at(-1)!
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteOrchestraAgent).toHaveBeenCalledWith(config, reviewer.id))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Orchestra agents' })).not.toBeInTheDocument())
  })
})

describe('McpStatusPanel', () => {
  it('renders status badges and source labels, filtered to a harness, and probes a server', async () => {
    vi.mocked(api.fetchMcpServerStatus).mockResolvedValue([
      { name: 'github', source: 'orchestra', status: 'connected', type: 'local', command: 'npx', args: ['gh-mcp'] },
      { name: 'linear', source: 'harness', harness: 'claude', status: 'needs_auth', type: 'remote', url: 'https://mcp.linear.app' },
      { name: 'figma', source: 'harness', harness: 'codex', status: 'failed', error: 'spawn ENOENT' },
    ])
    vi.mocked(api.probeMcpServer).mockResolvedValue({ name: 'linear', source: 'harness', harness: 'claude', status: 'connected' })
    render(<McpStatusPanel config={config} harness="claude" />)
    const rows = await screen.findAllByTestId('mcp-server-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Orchestra')
    expect(within(rows[0]).getByTestId('mcp-status')).toHaveTextContent('Connected')
    expect(rows[1]).toHaveTextContent('Claude')
    expect(within(rows[1]).getByTestId('mcp-status')).toHaveTextContent('Needs auth')
    fireEvent.click(screen.getByRole('button', { name: 'Probe linear' }))
    await waitFor(() => expect(within(screen.getAllByTestId('mcp-server-row')[1]).getByTestId('mcp-status')).toHaveTextContent('Connected'))
    expect(api.probeMcpServer).toHaveBeenCalledWith(config, 'linear')
  })

  it('shows failures with their error and refreshes on demand', async () => {
    vi.mocked(api.fetchMcpServerStatus).mockResolvedValueOnce([{ name: 'figma', source: 'harness', harness: 'codex', status: 'failed', error: 'spawn ENOENT' }])
    render(<McpStatusPanel config={config} />)
    expect(await screen.findByText('spawn ENOENT')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-status')).toHaveAttribute('data-status', 'failed')
    vi.mocked(api.fetchMcpServerStatus).mockResolvedValueOnce([])
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    expect(await screen.findByText('No MCP servers configured.')).toBeInTheDocument()
  })
})
