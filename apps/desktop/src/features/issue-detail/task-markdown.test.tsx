import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkItemDetail } from '../tracker/WorkItemDetail'
import { DescriptionEditor } from './DescriptionEditor'
import { IssueDetailView } from './IssueDetailView'
import { GitHubIssuesTab } from '../git/GitHubIssuesTab'
import type { WorkItem } from '@/entities/tracker/types'

const actions = vi.hoisted(() => ({ openBrowserTab: vi.fn(), setActiveSection: vi.fn() }))
vi.mock('@core/store', () => ({ useAppStore: (selector: (state: unknown) => unknown) => selector({ theme: 'dark', ...actions }) }))
vi.mock('@/hooks', () => ({ useOpenUrl: () => vi.fn() }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const description = '# Acceptance\n\n**Deliver** the change.\n\n- Inspect files\n- [x] Verify tests\n\n1. Open project\n2. Review result\n\n[Reference](https://example.com/spec) and `inline code`.\n\n```ts\nconst ready = true\n```\n\n| Stage | State |\n| --- | --- |\n| Review | Pending |\n\n<script>alert("unsafe")</script>\n<img src="x" onerror="alert(1)">\n[Unsafe](javascript:alert(1))'
const item: WorkItem = { id: 'task', identifier: 'ORC-1', source: 'github', title: 'Task', description, state: 'Review', priority: 0, url: '', labels: [], assignees: [], project_id: 'project', created_at: '', updated_at: '', extra: {} }

function expectFormattedBody(container: HTMLElement) {
  expect(screen.getByRole('heading', { name: 'Acceptance' })).toBeTruthy()
  expect(container.querySelector('strong')).toHaveTextContent('Deliver')
  expect(container.querySelector('ul')).toHaveTextContent('Inspect files')
  expect(container.querySelector('ol')).toHaveTextContent('Open project')
  expect(container.querySelector('input[type="checkbox"]')).toBeChecked()
  expect(container.querySelector('pre code')).toHaveTextContent('const ready = true')
  expect(container.querySelector('table')).toHaveTextContent('Pending')
  expect(container.querySelector('script, img[onerror]')).toBeNull()
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
}

describe('task description Markdown', () => {
  it('formats tracker item bodies safely and opens links in the owning project', async () => {
    const { container } = render(<WorkItemDetail item={item} />)
    expectFormattedBody(container)
    const link = screen.getByRole('link', { name: /Reference/i })
    fireEvent.keyDown(link, { key: 'Enter' })
    const option = await screen.findByText('Open in Workspace')
    fireEvent.click(option)
    expect(actions.openBrowserTab).toHaveBeenCalledWith('https://example.com/spec', 'project')
  })

  it('formats the read-only task detail body', () => {
    const { container } = render(<IssueDetailView result={{ ...item }} config={null} snapshot={null} />)
    expectFormattedBody(container)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('formats expanded GitHub issue bodies', () => {
    const noop = vi.fn()
    const { container } = render(<GitHubIssuesTab issues={[{number: 1, title: 'Task', body: description, state: 'open', html_url: 'https://github.com/owner/repo/issues/1', labels: []}]} issueFilter="open" onSetIssueFilter={noop} loadError={false} showCreateIssue={false} onToggleShowCreate={noop} newIssueTitle="" setNewIssueTitle={noop} newIssueBody="" setNewIssueBody={noop} onCreateIssue={noop} loading={false} expandedIssue={1} onToggleExpandedIssue={noop} onToggleIssueState={noop} hasMore={false} loadingMore={false} onLoadMore={noop} />)
    expectFormattedBody(container)
  })

  it('keeps links interactive in editable previews and preserves source when editing', async () => {
    const onChange = vi.fn()
    const { container } = render(<DescriptionEditor value={description} onChange={onChange} onBlur={vi.fn()} projectId="project" />)
    expectFormattedBody(container)
    const link = screen.getByRole('link', { name: /Reference/i })
    fireEvent.keyDown(link, { key: 'Enter' })
    const option = await screen.findByText('Open in Workspace')
    fireEvent.click(option)
    expect(actions.openBrowserTab).toHaveBeenCalledWith('https://example.com/spec', 'project')
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    expect(screen.getByRole('textbox')).toHaveValue(description)
    expect(onChange).not.toHaveBeenCalled()
  })
})
