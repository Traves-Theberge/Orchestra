import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IssueDetailView } from './IssueDetailView'
import type { SnapshotPayload } from '@core/api/types'

vi.mock('@core/store', () => ({ useAppStore: (selector: (state: unknown) => unknown) => selector({ openBrowserTab: vi.fn(), setActiveSection: vi.fn() }) }))
vi.mock('@ui/MarkdownRenderer', () => ({ MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div> }))
vi.mock('@layout/shared/controls', () => ({ AgentSelector: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <select aria-label="Assignee" value={value} onChange={event => onChange(event.target.value)}><option value="agent-codex">agent-codex</option><option value="agent-claude">agent-claude</option></select> }))
vi.mock('./DescriptionEditor', () => ({ DescriptionEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Task description" value={value} onChange={event => onChange(event.target.value)} /> }))
vi.mock('./PRCreateDialog', () => ({ PRCreateDialog: () => null }))
vi.mock('./SessionTimeline', () => ({ SessionTimeline: () => null }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1', identifier: 'ORC-1', title: 'Task title', description: 'Task body', state: 'Todo',
  assignee_id: 'agent-codex', project_id: 'project-1', project_name: 'Project', provider: 'CODEX',
  ...overrides,
})
const config = { baseUrl: 'http://127.0.0.1:4010', apiToken: 'fixture' }

function snapshot(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    generated_at: '', counts: { running: 0, retrying: 0 }, running: [], retrying: [],
    codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
    rate_limits: null, ...overrides,
  }
}

describe('IssueDetailView runtime observation', () => {
  it('stops through the scoped session action without clearing task context', async () => {
    const onStopSession = vi.fn(async () => {})
    const onUpdate = vi.fn(async () => {})
    render(<IssueDetailView result={task({ state: 'In Progress', plan: 'Preserved plan', feedback: 'Preserved feedback', plan_gate: { status: 'approved', plan_hash: 'a'.repeat(64) } })} snapshot={snapshot()} config={config} onStopSession={onStopSession} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop task' }))
    expect(screen.getByText(/Your plan, feedback, files, branch and PR stay intact/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Stop task' }).at(-1)!)
    await waitFor(() => expect(onStopSession).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByText('Stop task?')).not.toBeInTheDocument())
    expect(onUpdate).not.toHaveBeenCalled()
  })
  it('shows the observed harness limitation instead of implying planning is running', () => {
    const reason = 'Antigravity has no verified read-only planning adapter'
    render(<IssueDetailView result={task({ provider: 'ANTIGRAVITY', plan_gate: { status: 'unsupported', plan_hash: 'fixture-hash', reason } })} config={config} snapshot={null} onApprovePlan={vi.fn()} />)
    expect(screen.getByRole('status', { name: 'Task runtime status' })).toHaveTextContent('Planning capability unavailable')
    expect(screen.queryByRole('button', { name: 'Approve plan' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))
    expect(screen.getByText(reason)).toBeVisible()
  })

  it('distinguishes Todo from queued, claimed, active planning, and retry evidence', () => {
    const props = { config: null, result: task(), snapshot: null }
    const view = render(<IssueDetailView {...props} />)
    const status = () => screen.getByRole('status', { name: 'Task runtime status' })
    expect(status()).toHaveTextContent('Todo · no active run observed')
    expect(screen.queryByText('Planning', { exact: true })).not.toBeInTheDocument()

    view.rerender(<IssueDetailView {...props} snapshot={snapshot({
      counts: { running: 1, retrying: 0 },
      running: [{ issue_id: 'task-1', issue_identifier: 'ORC-1', state: 'Todo', last_event: 'dispatch_queued' }],
    })} />)
    expect(status()).toHaveTextContent('Queued for planning')
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))
    expect(screen.getByText('Run queued; planning has not started')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))

    view.rerender(<IssueDetailView {...props} snapshot={snapshot({
      counts: { running: 1, retrying: 0 },
      running: [{ issue_id: 'task-1', issue_identifier: 'ORC-1', state: 'Todo', last_event: 'run_claimed' }],
    })} />)
    expect(status()).toHaveTextContent('Worker claimed · planning starting')
    view.rerender(<IssueDetailView {...props} snapshot={snapshot({
      counts: { running: 1, retrying: 0 },
      running: [{ issue_id: 'task-1', issue_identifier: 'ORC-1', state: 'Todo', last_event: 'assistant_message' }],
    })} />)
    expect(status()).toHaveTextContent('Planning')

    view.rerender(<IssueDetailView {...props} snapshot={snapshot({
      counts: { running: 0, retrying: 1 },
      retrying: [{ issue_id: 'task-1', issue_identifier: 'ORC-1', state: 'Todo', attempt: 2, due_at: '2026-10-05T12:00:00Z', error: 'Provider exited before completing the plan' }],
    })} />)
    expect(status()).toHaveTextContent('Retry scheduled · attempt 2')
    expect(screen.getByText('Provider exited before completing the plan')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Plan' })).toBeVisible()
  })

  it('syncs authoritative same-task status while preserving dirty Backlog fields', async () => {
    const view = render(<IssueDetailView result={task({ state: 'Backlog' })} config={null} snapshot={null} />)
    fireEvent.change(screen.getByPlaceholderText('Task title...'), { target: { value: 'Local title draft' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Task description' }), { target: { value: 'Local body draft' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Assignee' }), { target: { value: 'agent-claude' } })

    view.rerender(<IssueDetailView result={task({ state: 'Todo', title: 'Server title', description: 'Server body', assignee_id: 'agent-codex' })} config={null} snapshot={null} />)
    await waitFor(() => expect(screen.getByRole('status', { name: 'Task runtime status' })).toHaveTextContent('Todo · no active run observed'))
    expect(screen.getByText('Local title draft', { selector: 'h2' })).toBeVisible()
    expect(screen.getByText('Local body draft')).toBeVisible()

    view.rerender(<IssueDetailView result={task({ state: 'Backlog', title: 'Another server title', description: 'Another server body', assignee_id: 'agent-codex' })} config={null} snapshot={null} />)
    expect(screen.getByPlaceholderText('Task title...')).toHaveValue('Local title draft')
    expect(screen.getByRole('textbox', { name: 'Task description' })).toHaveValue('Local body draft')
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveValue('agent-claude')
  })

  it('syncs a same-task Todo to In Progress while showing the missing approval gate', async () => {
    const view = render(<IssueDetailView result={task()} config={null} snapshot={null} />)
    expect(screen.getByRole('status', { name: 'Task runtime status' })).toHaveTextContent('Todo · no active run observed')
    view.rerender(<IssueDetailView result={task({ state: 'In Progress' })} config={null} snapshot={null} />)
    await waitFor(() => expect(screen.getByRole('status', { name: 'Task runtime status' })).toHaveTextContent('Execution blocked · plan approval not observed'))
    expect(screen.queryByText('Executing', { exact: true })).not.toBeInTheDocument()
  })

  it('offers approval only for an exact ready gate and reports callback confirmation', async () => {
    const approve = vi.fn(async () => {})
    render(<IssueDetailView result={task({ plan_gate: { status: 'awaiting_approval', plan_hash: 'sha256:plan-1' } })} config={config} snapshot={null} onApprovePlan={approve} />)
    expect(screen.getByRole('status', { name: 'Task runtime status' })).toHaveTextContent('Plan ready · awaiting approval')
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'approve_plan', project_id: 'project-1', task_id: 'task-1', expected_state: 'Todo', expected_plan_hash: 'sha256:plan-1', request_id: expect.any(String),
    })))
    await waitFor(() => expect(screen.getByRole('status', { name: 'Task runtime status' })).toHaveTextContent('Approval recorded · refreshing task state'))
    expect(screen.queryByRole('button', { name: 'Approve plan' })).not.toBeInTheDocument()
  })

  it('does not offer approval without the observed awaiting-approval gate and hash', () => {
    const approve = vi.fn(async () => {})
    const replan = vi.fn(async () => {})
    const { rerender } = render(<IssueDetailView result={task({ plan_gate: { status: 'planning' } })} config={config} snapshot={null} onApprovePlan={approve} onReplan={replan} />)
    expect(screen.queryByRole('button', { name: 'Approve plan' })).not.toBeInTheDocument()
    rerender(<IssueDetailView result={task({ plan_gate: { status: 'awaiting_approval' } })} config={config} snapshot={null} onApprovePlan={approve} onReplan={replan} />)
    expect(screen.queryByRole('button', { name: 'Approve plan' })).not.toBeInTheDocument()
    rerender(<IssueDetailView result={task({ plan_gate: { status: 'unsupported', plan_hash: 'sha256:plan' } })} config={config} snapshot={null} onApprovePlan={approve} onReplan={replan} />)
    expect(screen.queryByRole('button', { name: 'Approve plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request replan with feedback' })).not.toBeInTheDocument()
  })

  it('retains the same approval request ID after an uncertain response', async () => {
    const approve = vi.fn()
      .mockRejectedValueOnce(new Error('Approval outcome is unknown; inspect the receipt.'))
      .mockResolvedValueOnce(undefined)
    render(<IssueDetailView result={task({ plan_gate: { status: 'awaiting_approval', plan_hash: 'sha256:plan-1' } })} config={config} snapshot={null} onApprovePlan={approve} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('outcome is unknown'))
    const firstRequestId = approve.mock.calls[0][0].request_id

    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(2))

    expect(approve.mock.calls[1][0].request_id).toBe(firstRequestId)
  })

  it('submits Review feedback through the provider-neutral replan control', async () => {
    const replan = vi.fn(async () => {})
    render(<IssueDetailView result={task({ state: 'Todo', plan_gate: { status: 'awaiting_approval', plan_hash: 'sha256:review-plan' } })} config={config} snapshot={null} onReplan={replan} />)
    fireEvent.click(screen.getByRole('button', { name: 'Request replan with feedback' }))
    fireEvent.change(screen.getByPlaceholderText('What needs to change?'), { target: { value: 'Handle the empty input case' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Feedback' }))

    await waitFor(() => expect(replan).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'replan', project_id: 'project-1', task_id: 'task-1', expected_state: 'Todo', expected_plan_hash: 'sha256:review-plan', feedback: 'Handle the empty input case', request_id: expect.any(String),
    })))
  })
})
