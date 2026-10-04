import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { JsonRenderBlock } from './JsonRenderBlock'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('contains malformed tool output and recovers when the next spec arrives', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { rerender } = render(<JsonRenderBlock spec={{ root: 'list', elements: {
    list: { type: 'List', props: { items: 'invalid' } },
  } }} />)
  expect(screen.getByRole('alert').textContent).toContain('Render error')
  rerender(<JsonRenderBlock spec={{ root: 'list', elements: {
    list: { type: 'List', props: { items: [{ label: 'Recovered output' }] } },
  } }} />)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('Recovered output')).toBeTruthy()
})
