import type React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { Project } from '@core/api/types'

const autoConnect = vi.fn()
vi.mock('@ui/tooltip-wrapper', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@core/api/client', () => ({ autoConnectProjectGitHub: (...args: unknown[]) => autoConnect(...args) }))

import { GitHubConnectBadge } from './GitHubConnectBadge'

const config = { baseUrl: 'http://127.0.0.1:4010', apiToken: '' }
const base = { id: 'p1', name: 'P', github_owner: 'acme', github_repo: 'app' } as unknown as Project

describe('GitHubConnectBadge', () => {
  beforeEach(() => autoConnect.mockReset())

  it('shows the connected repo without trying to connect', () => {
    render(<GitHubConnectBadge config={config} project={{ ...base, id: 'p-connected', github_token: 'x' } as Project} />)
    expect(screen.getByText('acme/app')).toBeTruthy()
    expect(autoConnect).not.toHaveBeenCalled()
  })

  it('tries the CLI login once, then offers Connect GitHub', async () => {
    autoConnect.mockResolvedValue({ connected: false, reason: 'not logged in' })
    const project = { ...base, id: 'p-auto' } as Project
    const { rerender } = render(<GitHubConnectBadge config={config} project={project} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Connect GitHub/ })).toBeTruthy())
    rerender(<GitHubConnectBadge config={config} project={{ ...project }} />)
    expect(autoConnect).toHaveBeenCalledTimes(1)
  })

  it('renders nothing for projects without a GitHub remote', () => {
    const { container } = render(<GitHubConnectBadge config={config} project={{ ...base, github_owner: '' } as Project} />)
    expect(container.innerHTML).toBe('')
  })
})
