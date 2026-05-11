import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScopeToggle } from './ScopeToggle'

describe('ScopeToggle', () => {
  it('renders Global and project label', () => {
    render(<ScopeToggle scope="GLOBAL" projectName="Nautilus" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /global/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /nautilus/i })).toBeInTheDocument()
  })

  it('marks active scope', () => {
    render(<ScopeToggle scope="PROJECT" projectName="Nautilus" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /nautilus/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /global/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onChange when clicking inactive', () => {
    const onChange = vi.fn()
    render(<ScopeToggle scope="GLOBAL" projectName="Nautilus" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /nautilus/i }))
    expect(onChange).toHaveBeenCalledWith('PROJECT')
  })

  it('hides project side when projectName is null', () => {
    render(<ScopeToggle scope="GLOBAL" projectName={null} onChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /nautilus/i })).toBeNull()
    expect(screen.getByText(/global only/i)).toBeInTheDocument()
  })
})
