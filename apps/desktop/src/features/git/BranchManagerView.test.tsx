import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import { BranchManagerView } from './BranchManagerView'
import { gitCheckout, gitCreateBranch } from '@core/api/client'

vi.mock('@core/api/client', () => ({
  fetchProjectGitBranchesDetail: vi.fn().mockResolvedValue({ current: 'feature', branches: [{ name: 'feature', is_current: true }, { name: 'main', is_default: true }] }),
  gitCreateBranch: vi.fn().mockRejectedValue(new Error('Start point unavailable')),
  gitCheckout: vi.fn(), gitDeleteBranch: vi.fn(), gitMerge: vi.fn(), gitFetch: vi.fn(),
}))
vi.mock('@/hooks', () => ({ useNow: () => 0 }))

it('sends the selected base in one branch mutation and never checks it out first', async () => {
  const config = { baseUrl: 'http://localhost:4010', apiToken: 'test' }
  render(<BranchManagerView config={config} projectId="p" />)
  await waitFor(() => expect(screen.getByText('feature')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /New Branch/i }))
  fireEvent.change(screen.getByPlaceholderText('branch-name'), { target: { value: 'new-feature' } })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'main' } })
  fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
  await waitFor(() => expect(gitCreateBranch).toHaveBeenCalledWith(config, 'p', 'new-feature', 'main'))
  expect(gitCheckout).not.toHaveBeenCalled()
  expect(await screen.findByText('Start point unavailable')).toBeTruthy()
})
