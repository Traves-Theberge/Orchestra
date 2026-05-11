import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OverviewRow } from './OverviewRow'

describe('OverviewRow', () => {
  it('renders name and value', () => {
    render(<OverviewRow name="Model" value="claude-sonnet-4-6" status="set" onClick={() => {}} />)
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
  })

  it('renders override pill when status is override', () => {
    render(<OverviewRow name="Model" value="opus" status="override" pillText="override" onClick={() => {}} />)
    expect(screen.getByText('override')).toBeInTheDocument()
  })

  it('renders inherited styling when status is inherited', () => {
    render(<OverviewRow name="Hooks" value="inherited" status="inherited" onClick={() => {}} />)
    const value = screen.getByText('inherited')
    expect(value.className).toMatch(/italic/)
  })

  it('calls onClick when row clicked', () => {
    const onClick = vi.fn()
    render(<OverviewRow name="Model" value="x" status="set" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
