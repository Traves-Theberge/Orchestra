import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CodexEnvironmentPanel } from './CodexEnvironmentPanel'

afterEach(cleanup)

it('resets an unsaved draft when switching files with identical contents', () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const props = { scope: 'GLOBAL' as const, projectName: null, saving: null, onSave }
  const content = 'history.persistence = "save-all"\n'
  const { rerender } = render(<CodexEnvironmentPanel {...props} items={[{ path: '/fixture/a.toml', name: 'a.toml', content }]} />)
  fireEvent.change(screen.getByDisplayValue('save-all'), { target: { value: 'none' } })
  rerender(<CodexEnvironmentPanel {...props} items={[{ path: '/fixture/b.toml', name: 'b.toml', content }]} />)
  expect(screen.getByDisplayValue('save-all')).toBeTruthy()
  expect(screen.queryByDisplayValue('none')).toBeNull()
  expect(onSave).not.toHaveBeenCalled()
})
