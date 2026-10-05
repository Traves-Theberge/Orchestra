import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

vi.mock('@layout/AppSidebar', () => ({ AppSidebar: () => <nav>Sidebar</nav> }))

function shellProps() {
  return {
    items: [],
    activeSection: 'CONSOLE',
    onSectionChange: vi.fn(),
    projects: [],
    selectedProjectID: null,
    onSelectProject: vi.fn(),
    onCreateProject: vi.fn(),
  }
}

describe('AppShell', () => {
  it('shows page content and the bottom bar without a global connection status strip', () => {
    render(
      <AppShell {...shellProps()} statusMessage="SSE Live" bottomBar={<div>Usage footer</div>}>
        <div>Workspace content</div>
      </AppShell>,
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('SSE Live')).toBeNull()
    expect(screen.getByText('Workspace content')).toBeTruthy()
    expect(screen.getByText('Usage footer')).toBeTruthy()
    expect(screen.getByRole('navigation')).toBeTruthy()
  })

  it('continues presenting actionable errors', () => {
    render(
      <AppShell {...shellProps()} statusMessage="SSE disconnected" errorMessage="Backend unavailable">
        <div>Workspace content</div>
      </AppShell>,
    )
    expect(screen.getByRole('alert').textContent).toBe('Backend unavailable')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('Workspace content')).toBeTruthy()
  })
})
