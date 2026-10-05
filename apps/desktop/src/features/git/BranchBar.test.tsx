import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@ui/tooltip-wrapper', () => ({
  AppTooltip: ({ children }: any) => <>{children}</>,
}))

vi.mock('@core/api/client', () => ({
  gitCheckout: vi.fn(() => Promise.resolve()),
  gitCreateBranch: vi.fn(() => Promise.resolve()),
  gitStash: vi.fn(() => Promise.resolve()),
  gitStashPop: vi.fn(() => Promise.resolve()),
}))

import { gitCheckout, gitCreateBranch, gitStash } from '@core/api/client'
import { BranchBar } from './BranchBar'

const mockConfig = { baseUrl: 'http://localhost:4010', token: 'dev-token' }

const defaultProps = {
  projectId: 'proj-1',
  config: mockConfig as any,
  currentBranch: 'main',
  branches: ['main', 'feature-a', 'feature-b'],
  onBranchChange: vi.fn(),
}

describe('BranchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders current branch name in trigger button', () => {
    render(<BranchBar {...defaultProps} />)
    const trigger = screen.getByTestId('branch-trigger')
    expect(trigger.textContent).toContain('main')
  })

  it('opens dropdown on click showing local branches', async () => {
    const user = userEvent.setup()
    render(<BranchBar {...defaultProps} />)
    const trigger = screen.getByTestId('branch-trigger')
    await user.click(trigger)
    expect(screen.getByText('feature-a')).toBeTruthy()
    expect(screen.getByText('feature-b')).toBeTruthy()
  })

  it('shows remote branches section when remoteBranches provided', async () => {
    const user = userEvent.setup()
    render(
      <BranchBar
        {...defaultProps}
        remoteBranches={['origin/develop', 'origin/release']}
      />
    )
    const trigger = screen.getByTestId('branch-trigger')
    await user.click(trigger)
    expect(screen.getByText('Remote')).toBeTruthy()
    expect(screen.getByText('origin/develop')).toBeTruthy()
    expect(screen.getByText('origin/release')).toBeTruthy()
  })

  it('highlights current branch with green dot', async () => {
    const user = userEvent.setup()
    render(<BranchBar {...defaultProps} />)
    const trigger = screen.getByTestId('branch-trigger')
    await user.click(trigger)
    const mainRow = screen.getByTestId('branch-row-main')
    const dot = mainRow.querySelector('[data-testid="green-dot"]')
    expect(dot).toBeTruthy()
  })

  it('calls onBranchChange after checkout', async () => {
    const onBranchChange = vi.fn()
    const user = userEvent.setup()
    render(<BranchBar {...defaultProps} onBranchChange={onBranchChange} />)
    const trigger = screen.getByTestId('branch-trigger')
    await user.click(trigger)
    const row = screen.getByTestId('branch-row-feature-a')
    await user.click(row)
    await waitFor(() => {
      expect(gitCheckout).toHaveBeenCalledWith(mockConfig, 'proj-1', 'feature-a')
    })
    await waitFor(() => {
      expect(onBranchChange).toHaveBeenCalled()
    })
  })

  it('dismisses without checkout on Escape or outside click, and shows scoped checkout failure', async () => {
    const onBranchChange = vi.fn()
    const user = userEvent.setup()
    render(<><BranchBar {...defaultProps} onBranchChange={onBranchChange} /><button>Outside branch menu</button></>)

    await user.click(screen.getByTestId('branch-trigger'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('feature-a')).toBeNull()
    expect(gitCheckout).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('branch-trigger'))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside branch menu' }))
    expect(screen.queryByText('feature-a')).toBeNull()
    expect(gitCheckout).not.toHaveBeenCalled()

    vi.mocked(gitCheckout).mockRejectedValueOnce(new Error('branch belongs to another worktree'))
    await user.click(screen.getByTestId('branch-trigger'))
    await user.click(screen.getByTestId('branch-row-feature-a'))
    await waitFor(() => expect(screen.getByText('branch belongs to another worktree')).toBeInTheDocument())
    expect(gitCheckout).toHaveBeenCalledExactlyOnceWith(mockConfig, 'proj-1', 'feature-a')
    expect(onBranchChange).not.toHaveBeenCalled()
  })

  it('opens the stash panel, restores focus on Escape, and scopes stash creation to the current project', async () => {
    const user = userEvent.setup()
    const onBranchChange = vi.fn()
    render(<BranchBar {...defaultProps} onBranchChange={onBranchChange} />)

    const trigger = screen.getByRole('button', { name: 'Open stashes' })
    await user.click(trigger)
    expect(screen.getByText('No stashes')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('No stashes')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(gitStash).not.toHaveBeenCalled()

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Stash changes' }))
    await waitFor(() => expect(gitStash).toHaveBeenCalledExactlyOnceWith(mockConfig, 'proj-1'))
    await waitFor(() => expect(onBranchChange).toHaveBeenCalledOnce())
    expect(screen.queryByText('No stashes')).not.toBeInTheDocument()
  })

  it('applies and closes the matching stash entry without triggering unrelated branch actions', async () => {
    const user = userEvent.setup()
    const onStashApply = vi.fn()
    const onBranchChange = vi.fn()
    render(<BranchBar {...defaultProps} stashes={[{ ref: 'stash@{0}', message: 'fixture change' }]} onStashApply={onStashApply} onBranchChange={onBranchChange} />)

    await user.click(screen.getByRole('button', { name: 'Open stashes' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onStashApply).toHaveBeenCalledExactlyOnceWith('stash@{0}')
    expect(onBranchChange).not.toHaveBeenCalled()
    expect(screen.queryByText('fixture change')).not.toBeInTheDocument()
  })

  it('shows create branch input when "+ New branch" clicked', async () => {
    const user = userEvent.setup()
    render(<BranchBar {...defaultProps} />)
    const trigger = screen.getByTestId('branch-trigger')
    await user.click(trigger)
    const newBranchBtn = screen.getByText('New branch')
    await user.click(newBranchBtn)
    const input = screen.getByPlaceholderText('branch-name')
    expect(input).toBeTruthy()
  })

  it('shows Fetch button when onFetch provided', () => {
    render(<BranchBar {...defaultProps} onFetch={vi.fn()} />)
    const fetchBtn = screen.getByRole('button', { name: /fetch/i })
    expect(fetchBtn).toBeTruthy()
  })

  it('shows Pull/Push with counts', () => {
    render(
      <BranchBar
        {...defaultProps}
        onPull={vi.fn()}
        onPush={vi.fn()}
        aheadBehind={{ ahead: 3, behind: 2 }}
      />
    )
    const pullBtn = screen.getByRole('button', { name: /pull/i })
    const pushBtn = screen.getByRole('button', { name: /push/i })
    expect(pullBtn.textContent).toContain('2')
    expect(pushBtn.textContent).toContain('3')
  })

  it('does not show Fetch when onFetch not provided', () => {
    render(<BranchBar {...defaultProps} />)
    expect(screen.queryByRole('button', { name: /fetch/i })).toBeFalsy()
  })
})
