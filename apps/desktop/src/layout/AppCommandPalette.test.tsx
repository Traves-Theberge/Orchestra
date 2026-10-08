import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { AppCommandPalette } from './AppCommandPalette'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  cleanup()
  resetAppStore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('finds Diagnostics in search and opens it without invoking a task action', async () => {
  useAppStore.setState({ paletteOpen: true, activeSection: 'ORCHESTRATOR', projects: [] })
  const onCreateIssue = vi.fn()
  render(<AppCommandPalette onCreateIssue={onCreateIssue} onTogglePolling={vi.fn()} />)

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'diagnostics' } })
  fireEvent.click(await screen.findByText('Go to Diagnostics'))

  expect(useAppStore.getState().activeSection).toBe('DIAGNOSTICS')
  expect(useAppStore.getState().paletteOpen).toBe(false)
  expect(onCreateIssue).not.toHaveBeenCalled()
})
