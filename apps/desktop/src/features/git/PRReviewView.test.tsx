import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PRReviewView } from './PRReviewView'
import type { BackendConfig, GitHubPR } from '@core/api/client'
import { fetchPRSnapshot, mergePR } from '@core/api/client'

vi.mock('@core/api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@core/api/client')
  return {
    ...actual,
    fetchPRSnapshot: vi.fn(),
    fetchProjectGitHubPullDiff: vi.fn().mockResolvedValue('diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+import React from "react"\n export default {}'),
    fetchPRReviews: vi.fn().mockResolvedValue([
      { id: 1, user: { login: 'alice' }, body: 'Looks great!', state: 'APPROVED', submitted_at: '2026-03-20T10:00:00Z' },
      { id: 2, user: { login: 'bob' }, body: 'Needs a fix here', state: 'CHANGES_REQUESTED', submitted_at: '2026-03-20T11:00:00Z' },
    ]),
    submitPRReview: vi.fn().mockResolvedValue({}),
    mergePR: vi.fn().mockResolvedValue({}),
  }
})

vi.mock('./DiffViewer', () => ({
  DiffViewer: ({ filePath, diff }: { filePath: string; diff: string | null }) => (
    <div data-testid="diff-viewer">
      <span>{filePath}</span>
      {diff && <pre>{diff}</pre>}
    </div>
  ),
}))

const config: BackendConfig = { baseUrl: 'http://localhost:4010', apiToken: 'dev-token' }

function makePR(overrides: Partial<GitHubPR> = {}): GitHubPR {
  return {
    number: 42,
    title: 'Add authentication flow',
    body: 'Implements OAuth2',
    state: 'open',
    html_url: 'https://github.com/org/repo/pull/42',
    diff_url: 'https://github.com/org/repo/pull/42.diff',
    head: { ref: 'feat/auth', label: 'org:feat/auth', sha: 'a'.repeat(40) },
    base: { ref: 'main', label: 'org:main', sha: 'b'.repeat(40) },
    user: { login: 'alice', avatar_url: '' },
    created_at: '2026-03-20T09:00:00Z',
    merged_at: null,
    ...overrides,
  }
}

const defaultProps = {
  projectId: 'proj-1',
  config,
  pr: makePR(),
  onClose: vi.fn(),
}

describe('PRReviewView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchPRSnapshot).mockResolvedValue({ pr: makePR(), diff: 'diff --git a/file.ts b/file.ts\n+reviewed' })
  })

  it('renders PR title and number', () => {
    render(<PRReviewView {...defaultProps} />)
    expect(screen.getByText('Add authentication flow')).toBeTruthy()
    expect(screen.getByText('#42')).toBeTruthy()
  })

  it('renders branch info (head -> base)', () => {
    render(<PRReviewView {...defaultProps} />)
    // The component renders "base ← head" using &larr; HTML entity
    const branchInfo = screen.getByText(/main/)
    expect(branchInfo).toBeTruthy()
    expect(branchInfo.textContent).toContain('feat/auth')
  })

  it('shows Files Changed and Reviews tabs', () => {
    render(<PRReviewView {...defaultProps} />)
    expect(screen.getByText('Files Changed')).toBeTruthy()
    // Reviews tab shows count; initially 0 before async load
    expect(screen.getByText(/Reviews/)).toBeTruthy()
  })

  it('renders diff content after load', async () => {
    render(<PRReviewView {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText(/diff --git/)).toBeTruthy()
    })
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<PRReviewView {...defaultProps} onClose={onClose} />)
    // The close button is the first button in the header (contains X icon)
    const buttons = screen.getAllByRole('button')
    // First button is the close button
    fireEvent.click(buttons[0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows merge dropdown with methods (merge, squash, rebase)', async () => {
    render(<PRReviewView {...defaultProps} />)
    // Click the Merge dropdown button
    const mergeButton = screen.getByText(/Merge/)
    await waitFor(() => expect((mergeButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(mergeButton)
    expect(screen.getByText('Squash and merge')).toBeTruthy()
    expect(screen.getByText('Rebase and merge')).toBeTruthy()
    // "Create merge commit" appears as an option
    expect(screen.getByText('Create merge commit')).toBeTruthy()
  })

  it('shows review submission form', () => {
    render(<PRReviewView {...defaultProps} />)
    expect(screen.getByPlaceholderText('Leave a review comment…')).toBeTruthy()
    expect(screen.getByText('Approve')).toBeTruthy()
    expect(screen.getByText('Request changes')).toBeTruthy()
  })

  it('renders existing reviews', async () => {
    render(<PRReviewView {...defaultProps} />)
    // Switch to Reviews tab
    const reviewsTab = screen.getByText(/Reviews/)
    fireEvent.click(reviewsTab)
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy()
      expect(screen.getByText('Looks great!')).toBeTruthy()
      expect(screen.getByText('bob')).toBeTruthy()
      expect(screen.getByText('Needs a fix here')).toBeTruthy()
    })
  })

  it('shows PR state badge for open PR', () => {
    render(<PRReviewView {...defaultProps} />)
    expect(screen.getByText('open')).toBeTruthy()
  })

  it('shows PR state badge for merged PR', () => {
    render(<PRReviewView {...defaultProps} pr={makePR({ merged_at: '2026-03-20T12:00:00Z' })} />)
    expect(screen.getByText('merged')).toBeTruthy()
    expect(screen.queryByText('open')).toBeFalsy()
  })

  it('shows PR state badge for closed PR', () => {
    render(<PRReviewView {...defaultProps} pr={makePR({ state: 'closed' })} />)
    expect(screen.getByText('closed')).toBeTruthy()
    expect(screen.queryByText('open')).toBeFalsy()
  })

  it('merges the displayed snapshot head and updates confirmed merged status', async () => {
    render(<PRReviewView {...defaultProps} />)
    await waitFor(() => expect(screen.getByText(/Reviewing commit/)).toBeTruthy())
    fireEvent.click(screen.getByText('Merge'))
    fireEvent.click(screen.getByText('Squash and merge'))
    await waitFor(() => expect(mergePR).toHaveBeenCalledWith(config, 'proj-1', 42, 'squash', 'a'.repeat(40)))
    await waitFor(() => expect(screen.getByText('merged')).toBeTruthy())
    expect((screen.getByText('Merge') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows merge failure and prevents retry until review is refreshed', async () => {
    vi.mocked(mergePR).mockRejectedValueOnce(new Error('Head changed. Refresh and review again.'))
    render(<PRReviewView {...defaultProps} />)
    await waitFor(() => expect(screen.getByText(/Reviewing commit/)).toBeTruthy())
    fireEvent.click(screen.getByText('Merge'))
    fireEvent.click(screen.getByText('Create merge commit'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Head changed'))
    expect((screen.getByText('Merge') as HTMLButtonElement).disabled).toBe(true)
  })

  it('failed snapshot does not appear as an empty successful review', async () => {
    vi.mocked(fetchPRSnapshot).mockRejectedValueOnce(new Error('Diff unavailable'))
    render(<PRReviewView {...defaultProps} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Diff unavailable'))
    expect(screen.queryByTestId('diff-viewer')).toBeNull()
    expect((screen.getByText('Merge') as HTMLButtonElement).disabled).toBe(true)
  })

  it('ignores delayed snapshot from a previous PR', async () => {
    let resolveOld!: (value: { pr: GitHubPR; diff: string }) => void
    vi.mocked(fetchPRSnapshot).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    const { rerender } = render(<PRReviewView {...defaultProps} />)
    await waitFor(() => expect(fetchPRSnapshot).toHaveBeenCalledTimes(1))
    vi.mocked(fetchPRSnapshot).mockResolvedValue({ pr: makePR({ number: 43, title: 'second PR' }), diff: 'second diff' })
    rerender(<PRReviewView {...defaultProps} pr={makePR({ number: 43, title: 'second PR' })} />)
    await waitFor(() => expect(screen.getByText('second diff')).toBeTruthy())
    await act(async () => resolveOld({ pr: makePR(), diff: 'old diff' }))
    expect(screen.queryByText('old diff')).toBeNull()
    expect(screen.getByText('second diff')).toBeTruthy()
  })
})
