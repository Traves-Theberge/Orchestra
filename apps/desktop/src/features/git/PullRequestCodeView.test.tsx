import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, it, expect, vi } from 'vitest'
import { PullRequestCodeView } from './PullRequestCodeView'

vi.mock('./DiffViewer', () => ({ DiffViewer: () => <div>Text hunks</div> }))
const diff = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+added'
beforeEach(() => localStorage.clear())

it('restores viewed marks only for the same immutable review scope', () => {
  const props = { diff, mode: 'unified' as const, onModeChange: vi.fn() }
  const first = render(<PullRequestCodeView {...props} storageKey="backend:project:pr:base:head-a" />)
  fireEvent.click(screen.getByRole('checkbox'))
  first.unmount()
  const restored = render(<PullRequestCodeView {...props} storageKey="backend:project:pr:base:head-a" />)
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  restored.unmount()
  render(<PullRequestCodeView {...props} storageKey="backend:project:pr:base:head-b" />)
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
})

it('shows binary file boundaries without presenting an empty text diff', () => {
  render(<PullRequestCodeView diff={'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ'} storageKey="binary" mode="unified" onModeChange={vi.fn()} />)
  expect(screen.getByText('logo.png')).toBeTruthy()
  expect(screen.getByText('Binary file changed. Text diff unavailable.')).toBeTruthy()
  expect(screen.queryByText('Text hunks')).toBeNull()
})
