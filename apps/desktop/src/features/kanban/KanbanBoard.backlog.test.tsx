import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

describe('Kanban task search and drag', () => {
  it('searches title, body, ID, assignee and project across every column with normalized multi-token matching', () => {
    mount()
    const search = screen.getByRole('searchbox', { name: 'Search tasks' })

    fireEvent.change(search, { target: { value: 'resume INDEX' } })
    expect(screen.getByTestId('kanban-task-task-12')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-task-task-13')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kanban-task-task-14')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'resume' } })
    expect(screen.getByTestId('kanban-task-task-14')).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'orc-13 jane orchestra' } })
    expect(screen.getByTestId('kanban-task-task-13')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-task-task-12')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'codex' } })
    expect(screen.getByTestId('kanban-task-task-12')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-task-task-13')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'no-match' } })
    expect(screen.getAllByText('No tasks match “no-match”').length).toBeGreaterThan(0)
    expect(screen.getByText('0 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' })[0])
    expect(search).toHaveValue('')
    expect(screen.getByTestId('kanban-task-task-12')).toBeInTheDocument()
  })

  it('clears the search by its button or Escape and filters every lane', () => {
    mount()
    const search = screen.getByRole('searchbox', { name: 'Search tasks' })
    fireEvent.change(search, { target: { value: 'ORC-12' } })
    expect(screen.queryByTestId('kanban-task-task-13')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kanban-task-task-14')).not.toBeInTheDocument()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')
    expect(screen.getByTestId('kanban-task-task-13')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'ORC-12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear task search' }))
    expect(search).toHaveValue('')
    expect(screen.getByTestId('kanban-task-task-12')).toBeInTheDocument()
    expect(screen.getByTestId('kanban-task-task-14')).toBeInTheDocument()
  })

  it('applies the query in List view to every state', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    const search = screen.getByRole('searchbox', { name: 'Search tasks' })
    fireEvent.change(search, { target: { value: 'ORC-12' } })

    expect(screen.getAllByText('Improve résumé search')).toHaveLength(1)
    expect(screen.queryByText('ORC-14')).not.toBeInTheDocument()
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

  it('virtualizes long columns instead of rendering every card', () => {
    const many: IssueListItem[] = Array.from({ length: 500 }, (_, i) => ({ issue_id: `bulk-${i}`, identifier: `ORC-${1000 + i}`, state: 'Backlog', title: `Bulk task ${i}`, project_id: project.id }))
    mount(many)
    expect(screen.queryAllByTestId(/^kanban-task-bulk-/).length).toBeLessThan(100)
    expect(screen.getByText('500')).toBeInTheDocument()
  })

  it('focuses task search with the / shortcut', () => {
    mount()
    fireEvent.keyDown(window, { key: '/' })
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveFocus()
  })

  it('renders mid-drag: dims the source, outlines the allowed column, fades the rest', async () => {
    mount()
    const store = new Map<string, string>()
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: (k: string, v: string) => store.set(k, v), getData: (k: string) => store.get(k) || '', setDragImage: () => {} } as unknown as DataTransfer
    fireEvent.dragStart(screen.getByTestId('kanban-task-task-12'), { dataTransfer, clientX: 10, clientY: 10 })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(screen.getByTestId('kanban-task-task-12').className).toContain('opacity-40')
    expect(screen.getByTestId('kanban-column-progress').className).toContain('opacity-30')
    expect(screen.getByTestId('kanban-column-todo').className).not.toContain('opacity-30')
    fireEvent.dragOver(screen.getByTestId('kanban-column-todo'), { dataTransfer })
    expect(screen.getByText('Move to Planning')).toBeInTheDocument()
    fireEvent.dragEnd(screen.getByTestId('kanban-task-task-12'), { dataTransfer })
    expect(screen.getByTestId('kanban-task-task-12').className).not.toContain('opacity-40')
  })
})
