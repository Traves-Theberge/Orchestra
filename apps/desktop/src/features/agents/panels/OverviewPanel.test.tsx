import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OverviewPanel } from './OverviewPanel'

const baseProps = {
  provider: 'claude' as const,
  projectName: 'Nautilus',
  globalSummary: {
    model: 'claude-sonnet-4-6',
    instructionsLines: 42,
    skillsCount: 2,
    mcpCount: 1,
    hooksCount: 0,
    subAgentsCount: 2,
  },
  projectSummary: {
    model: 'claude-opus-4-7',
    instructionsLines: null,
    skillsCount: 1,
    skillsAddedNames: ['deploy-checklist'],
    mcpCount: 1,
    hooksCount: null,
    subAgentsCount: null,
  },
  onNavigate: vi.fn(),
}

describe('OverviewPanel', () => {
  it('renders global column with model', () => {
    render(<OverviewPanel {...baseProps} />)
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
  })

  it('renders project column with override pill', () => {
    render(<OverviewPanel {...baseProps} />)
    expect(screen.getByText('claude-opus-4-7')).toBeInTheDocument()
    expect(screen.getAllByText(/override/i).length).toBeGreaterThan(0)
  })

  it('hides project column when projectName is null', () => {
    render(<OverviewPanel {...baseProps} projectName={null} />)
    expect(screen.queryByText('claude-opus-4-7')).toBeNull()
  })

  it('navigates when row clicked', () => {
    const onNavigate = vi.fn()
    render(<OverviewPanel {...baseProps} onNavigate={onNavigate} />)
    fireEvent.click(screen.getAllByRole('button', { name: /model/i })[0])
    expect(onNavigate).toHaveBeenCalledWith('models', 'GLOBAL')
  })
})
