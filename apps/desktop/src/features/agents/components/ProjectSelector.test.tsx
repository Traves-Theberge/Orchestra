import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectSelector } from './ProjectSelector'

const projects = [
  { id: 'p1', name: 'Nautilus' },
  { id: 'p2', name: 'Orchestra' },
]

describe('ProjectSelector', () => {
  it('renders selected project name', () => {
    render(<ProjectSelector projects={projects} selectedId="p1" onChange={() => {}} />)
    expect(screen.getByRole('button')).toHaveTextContent(/nautilus/i)
  })

  it('renders Global only label when selectedId is null', () => {
    render(<ProjectSelector projects={projects} selectedId={null} onChange={() => {}} />)
    expect(screen.getByRole('button')).toHaveTextContent(/global only/i)
  })

  it('shows Global only option in dropdown', () => {
    render(<ProjectSelector projects={projects} selectedId="p1" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/global only — hide project column/i)).toBeInTheDocument()
  })

  it('lists projects in dropdown', () => {
    render(<ProjectSelector projects={projects} selectedId="p1" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('menuitem', { name: /orchestra/i })).toBeInTheDocument()
  })

  it('calls onChange(null) when Global only selected', () => {
    const onChange = vi.fn()
    render(<ProjectSelector projects={projects} selectedId="p1" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText(/global only — hide project column/i))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('calls onChange with project id when project selected', () => {
    const onChange = vi.fn()
    render(<ProjectSelector projects={projects} selectedId="p1" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: /orchestra/i }))
    expect(onChange).toHaveBeenCalledWith('p2')
  })
})
