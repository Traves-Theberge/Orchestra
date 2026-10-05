import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore } from '@core/store'
import type { Project } from '@core/api/types'
import type { IssueListItem } from '@core/api/client'
import { KanbanBoard } from './KanbanBoard'

vi.mock('@ui/tooltip-wrapper', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@layout/shared/controls', () => ({
  AgentSelector: () => <div data-testid="agent-selector" />,
  CustomDropdown: () => <div data-testid="custom-dropdown" />,
}))

afterEach(() => {
  cleanup()
  resetAppStore()
})

const project: Project = { id: 'project-a', name: 'Orchestra', root_path: 'C:/fixture/orchestra', remote_url: '' }

const issues: IssueListItem[] = [
  {
    issue_id: 'task-12', identifier: 'ORC-12', state: 'Backlog',
    title: 'Improve résumé search', description: 'Index the task cache and retry safely',
    assignee_id: 'agent-codex', provider: 'CODEX', project_id: project.id,
  },
  {
    issue_id: 'task-13', identifier: 'ORC-13', state: 'Backlog',
    title: 'Repair sidebar layout', description: 'Keep columns aligned',
    assignee_id: 'worker-jane', project_id: project.id,
  },
  {
    issue_id: 'task-14', identifier: 'ORC-14', state: 'Todo',
    title: 'Improve résumé search', description: 'Queued task outside Backlog',
    assignee_id: 'agent-codex', provider: 'CODEX', project_id: project.id,
  },
]

function mount(boardIssues = issues, onIssueUpdate = vi.fn(async () => {})) {
  render(<KanbanBoard
    config={null}
    project={project}
    loadingState={false}
    snapshot={null}
    boardIssues={boardIssues}
    projects={[project]}
    availableAgents={['codex']}
    onInspectIssue={vi.fn(async () => {})}
    onIssueUpdate={onIssueUpdate}
  />)
  return onIssueUpdate
}

describe('Kanban Backlog search and drag', () => {
  it('searches Backlog title, body, ID, assignee and project with normalized multi-token matching', () => {
    mount()
    const search = screen.getByRole('searchbox', { name: 'Search Backlog tasks' })

    fireEvent.change(search, { target: { value: 'resume INDEX' } })
    expect(screen.getByTestId('kanban-task-task-12')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-task-task-13')).not.toBeInTheDocument()
    expect(screen.getByTestId('kanban-task-task-14')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'orc-13 jane orchestra' } })
    expect(screen.getByTestId('kanban-task-task-13')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-task-task-12')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'codex' } })
    expect(screen.getByTestId('kanban-task-task-12')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-task-task-13')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'no-match' } })
    expect(screen.getByText('No Backlog tasks match “no-match”')).toBeInTheDocument()
    expect(screen.getByText('0 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveValue('')
    expect(screen.getByTestId('kanban-task-task-12')).toBeInTheDocument()
  })

  it('clears the search by its button or Escape and leaves non-Backlog lanes unfiltered', () => {
    mount()
    const search = screen.getByRole('searchbox', { name: 'Search Backlog tasks' })
    fireEvent.change(search, { target: { value: 'ORC-12' } })
    expect(screen.queryByTestId('kanban-task-task-13')).not.toBeInTheDocument()
    expect(screen.getByTestId('kanban-task-task-14')).toBeInTheDocument()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')
    expect(screen.getByTestId('kanban-task-task-13')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'ORC-12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear Backlog search' }))
    expect(search).toHaveValue('')
    expect(screen.getByTestId('kanban-task-task-12')).toBeInTheDocument()
    expect(screen.getByTestId('kanban-task-task-14')).toBeInTheDocument()
  })

  it('applies the Backlog query in List view without filtering other states', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    const search = screen.getByRole('searchbox', { name: 'Search Backlog tasks' })
    fireEvent.change(search, { target: { value: 'ORC-12' } })

    expect(screen.getAllByText('Improve résumé search')).toHaveLength(2)
    expect(screen.getByText('ORC-14')).toBeInTheDocument()
    expect(screen.queryByText('Repair sidebar layout')).not.toBeInTheDocument()
  })

  it('drops a lower-case Backlog card identified only by local issue_id into Todo', () => {
    const onIssueUpdate = vi.fn(async () => {})
    mount([{
      issue_id: 'local-task-id', state: 'backlog', title: 'Complete task',
      description: 'Provide enough admission detail', assignee_id: 'worker-7', project_id: project.id,
    }], onIssueUpdate)

    const store = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: '',
      setData: (key: string, value: string) => store.set(key.toLowerCase(), value),
      getData: (key: string) => store.get(key.toLowerCase()) || '',
    } as unknown as DataTransfer

    fireEvent.dragStart(screen.getByTestId('kanban-task-local-task-id'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('kanban-column-todo'), { dataTransfer })

    expect(onIssueUpdate).toHaveBeenCalledWith('local-task-id', { state: 'Todo' })
  })

  it('keeps the Backlog admission guard when required task metadata is missing', () => {
    const onIssueUpdate = vi.fn(async () => {})
    mount([{
      issue_id: 'incomplete-task', state: 'Backlog', title: 'Incomplete',
      description: '', assignee_id: 'Unassigned', project_id: project.id,
    }], onIssueUpdate)

    const store = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: '',
      setData: (key: string, value: string) => store.set(key.toLowerCase(), value),
      getData: (key: string) => store.get(key.toLowerCase()) || '',
    } as unknown as DataTransfer

    fireEvent.dragStart(screen.getByTestId('kanban-task-incomplete-task'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('kanban-column-todo'), { dataTransfer })

    expect(onIssueUpdate).not.toHaveBeenCalled()
    expect(screen.getByText(/Cannot move to Todo.*description, assignee/)).toBeInTheDocument()
  })
})
