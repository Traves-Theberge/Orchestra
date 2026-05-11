import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InheritedField } from './InheritedField'

describe('InheritedField', () => {
  it('renders inherited placeholder when state is inherited', () => {
    render(
      <InheritedField inherited inheritedValue="sonnet" onSetHere={() => {}}>
        <input data-testid="local-input" />
      </InheritedField>
    )
    expect(screen.getByText(/inherits from global/i)).toBeInTheDocument()
    expect(screen.getByText('sonnet')).toBeInTheDocument()
  })

  it('renders children when not inherited', () => {
    render(
      <InheritedField inherited={false} inheritedValue="sonnet" onSetHere={() => {}}>
        <input data-testid="local-input" />
      </InheritedField>
    )
    expect(screen.getByTestId('local-input')).toBeInTheDocument()
    expect(screen.queryByText(/inherits from global/i)).toBeNull()
  })

  it('calls onSetHere when Set here clicked', () => {
    const onSetHere = vi.fn()
    render(
      <InheritedField inherited inheritedValue="sonnet" onSetHere={onSetHere}>
        <input />
      </InheritedField>
    )
    fireEvent.click(screen.getByRole('button', { name: /set here/i }))
    expect(onSetHere).toHaveBeenCalledOnce()
  })
})
