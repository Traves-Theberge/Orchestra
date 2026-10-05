import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilterMenu } from './FilterMenu'

afterEach(cleanup)

describe('usage filter menu walkthrough', () => {
  it('opens and applies only the selected scope, then closes', () => {
    const onScopeChange = vi.fn()
    const onRangeChange = vi.fn()
    render(<FilterMenu scope="all" range="30d" onScopeChange={onScopeChange} onRangeChange={onRangeChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Usage filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Orchestra worktrees only' }))

    expect(onScopeChange).toHaveBeenCalledExactlyOnceWith('orchestra')
    expect(onRangeChange).not.toHaveBeenCalled()
    expect(screen.queryByText('Scope')).not.toBeInTheDocument()
  })

  it('applies an exact range and dismisses without dispatch on Escape or outside click', () => {
    const onScopeChange = vi.fn()
    const onRangeChange = vi.fn()
    render(<><FilterMenu scope="all" range="30d" onScopeChange={onScopeChange} onRangeChange={onRangeChange} /><button>Outside</button></>)

    fireEvent.click(screen.getByRole('button', { name: 'Usage filters' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Range')).not.toBeInTheDocument()
    expect(onScopeChange).not.toHaveBeenCalled()
    expect(onRangeChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Usage filters' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByText('Range')).not.toBeInTheDocument()
    expect(onScopeChange).not.toHaveBeenCalled()
    expect(onRangeChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Usage filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    expect(onRangeChange).toHaveBeenCalledExactlyOnceWith('7d')
    expect(onScopeChange).not.toHaveBeenCalled()
    expect(screen.queryByText('Range')).not.toBeInTheDocument()
  })
})
