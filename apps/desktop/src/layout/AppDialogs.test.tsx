import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDialogs } from './AppDialogs'
import { resetAppStore, useAppStore } from '@core/store'

vi.mock('@core/api/client', () => ({
  fetchAvailableRuntimes: vi.fn(async () => []),
  fetchIssueHistory: vi.fn(async () => []),
  fetchIssueLogs: vi.fn(async () => ''),
  fetchIssueDiff: vi.fn(async () => ''),
}))

afterEach(() => cleanup())

beforeEach(() => {
  resetAppStore()
  useAppStore.getState().setInspectDialogOpen(true)
})

const task = (plan: string) => ({
  id: 'task-1', identifier: 'ORC-1', title: 'Task title', description: 'Task body', state: 'Todo',
  assignee_id: 'agent-codex', project_id: 'project-1', project_name: 'Project', provider: 'CODEX', plan,
})

function props(overrides: Partial<React.ComponentProps<typeof AppDialogs>> = {}): React.ComponentProps<typeof AppDialogs> {
  return {
    config: { baseUrl: 'http://127.0.0.1:4010', apiToken: 'fixture' },
    timeline: [], availableAgents: [], snapshot: null, theme: 'dark', issueLookupId: 'ORC-1',
    issueLookupPending: false, issueLookupError: '', issueLookupResult: task('- [ ] Initial plan step'),
    sessionLookupPending: false, sessionLookupError: '', sessionLookupResult: null,
    onIssueUpdate: vi.fn(async () => {}), onApprovePlan: vi.fn(async () => {}), onReplan: vi.fn(async () => {}),
    onRequestReview: vi.fn(async () => {}), onApproveReview: vi.fn(async () => {}),
    onCompleteReview: vi.fn(async () => {}), onStopSession: vi.fn(async () => {}),
    onTaskSubmit: vi.fn(async () => {}), onAddProject: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('AppDialogs task detail refresh', () => {
  it('keeps the selected task panel mounted while the same task refreshes', () => {
    const view = render(<AppDialogs {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }))

    const originalStep = screen.getByText('Initial plan step')
    const planPanel = originalStep.closest('.h-full.p-4')
    expect(planPanel).not.toBeNull()

    view.rerender(<AppDialogs {...props({
      config: { baseUrl: 'http://127.0.0.1:4010', apiToken: 'fixture' },
      issueLookupPending: true,
    })} />)

    expect(screen.getByText('Initial plan step')).toBe(originalStep)
    expect(originalStep.closest('.h-full.p-4')).toBe(planPanel)

    view.rerender(<AppDialogs {...props({
      config: { baseUrl: 'http://127.0.0.1:4010', apiToken: 'fixture' },
      issueLookupPending: false,
      issueLookupResult: task('- [ ] Refreshed plan step'),
    })} />)

    expect(screen.getByText('Refreshed plan step')).toBeVisible()
    expect(screen.getByRole('button', { name: /Plan/ })).toHaveClass('border-b-primary')
    expect(screen.getByText('Refreshed plan step').closest('.h-full.p-4')).toBe(planPanel)

    view.rerender(<AppDialogs {...props({
      config: { baseUrl: 'http://127.0.0.1:4010', apiToken: 'fixture' },
      issueLookupPending: false,
      issueLookupError: 'Backend temporarily unavailable',
      issueLookupResult: task('- [ ] Refreshed plan step'),
    })} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Backend temporarily unavailable')
    expect(screen.getByRole('button', { name: /Plan/ })).toHaveClass('border-b-primary')
    expect(screen.getByText('Refreshed plan step').closest('.h-full.p-4')).toBe(planPanel)
  })

  it('does not carry a previous task panel across a different lookup identity', () => {
    render(<AppDialogs {...props({ issueLookupId: 'ORC-2', issueLookupPending: true })} />)

    expect(screen.queryByRole('button', { name: /Plan/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Initial plan step')).not.toBeInTheDocument()
  })

  it('keeps the Session panel mounted through same-task polling', async () => {
    const view = render(<AppDialogs {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Session' }))
    await waitFor(() => expect(screen.getByTestId('timeline-empty')).toBeInTheDocument())
    const sessionScrollContainer = screen.getByTestId('timeline-empty').closest('.custom-scrollbar')
    expect(sessionScrollContainer).not.toBeNull()

    view.rerender(<AppDialogs {...props({ issueLookupPending: true })} />)
    expect(screen.getByRole('button', { name: 'Session' })).toHaveClass('border-b-primary')
    expect(screen.getByTestId('timeline-loading').closest('.custom-scrollbar')).toBe(sessionScrollContainer)

    view.rerender(<AppDialogs {...props({ issueLookupResult: task('- [ ] Updated plan') })} />)
    await waitFor(() => expect(screen.getByTestId('timeline-empty')).toBeInTheDocument())
    expect(screen.getByTestId('timeline-empty').closest('.custom-scrollbar')).toBe(sessionScrollContainer)
  })

  it('keeps the description editor in Preview mode through same-task polling', () => {
    const view = render(<AppDialogs {...props({ issueLookupResult: { ...task(''), state: 'Backlog' } })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    fireEvent.change(screen.getByPlaceholderText(/Describe what this task should accomplish/), {
      target: { value: '# Preview draft\n\nThis description is still being edited.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const descriptionPreview = screen.getByRole('button', { name: 'Edit description' })
    expect(screen.getByText('This description is still being edited.')).toBeVisible()

    view.rerender(<AppDialogs {...props({
      issueLookupPending: true,
      issueLookupResult: { ...task(''), state: 'Backlog' },
    })} />)

    expect(screen.getByRole('button', { name: 'Edit description' })).toBe(descriptionPreview)
    expect(screen.getByText('This description is still being edited.')).toBeVisible()
    expect(screen.queryByRole('textbox', { name: /Describe what this task/ })).not.toBeInTheDocument()
  })
})
