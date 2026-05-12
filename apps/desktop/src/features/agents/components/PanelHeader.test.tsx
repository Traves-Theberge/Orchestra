import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PanelHeader } from './PanelHeader'

describe('PanelHeader', () => {
  it('renders title and sub', () => {
    render(<PanelHeader eyebrow="Claude / Instructions" title="CLAUDE.md" sub="42 lines" />)
    expect(screen.getByText('CLAUDE.md')).toBeInTheDocument()
    expect(screen.getByText('42 lines')).toBeInTheDocument()
  })

  it('omits sub when not provided', () => {
    render(<PanelHeader eyebrow="x" title="y" />)
    expect(screen.queryByTestId('panel-header-sub')).toBeNull()
  })

  it('shows Unsaved pill when dirty', () => {
    render(<PanelHeader eyebrow="x" title="y" dirty />)
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
  })

  it('hides Unsaved pill when not dirty', () => {
    render(<PanelHeader eyebrow="x" title="y" />)
    expect(screen.queryByText('Unsaved')).toBeNull()
  })
})
